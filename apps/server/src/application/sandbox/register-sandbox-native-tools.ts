import type { AppDatabase } from '../../db/client'
import type { SandboxPolicy } from '../../domain/sandbox/types'
import type { DomainError } from '../../shared/errors'
import {
  asJobId,
  asSandboxExecutionId,
  asSandboxExecutionPackageId,
  asSandboxWritebackOperationId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import {
  isNativeToolAllowedForRun,
  isToolAllowedForRun,
  resolveMcpModeForRun,
} from '../agents/agent-runtime-policy'
import {
  buildMcpCodeModeCatalog,
  collectLoadedMcpCodeModeLookups,
  filterMcpCodeModeCatalogToLoadedTools,
  findMcpCodeModeModuleSyntaxMisuse,
  findMcpRuntimeNameCallMisuse,
  findReferencedMcpCodeModeBindings,
  findReferencedNonExecutableMcpCodeModeTools,
  formatMcpCodeModeConfirmationDescription,
  MCP_CODE_MODE_CONFIRMATION_TARGET_REF,
  renderMcpCodeModeWrapperScript,
} from '../mcp/code-mode'
import {
  createAgentRevisionRepository,
  createSandboxExecutionRepository,
  createSandboxWritebackRepository,
  createToolExecutionRepository,
} from '../persistence/repositories'
import type { ToolOutcome, ToolRegistry, ToolSpec } from '../tooling/tool-registry'
import { buildSandboxBashWrapperScript, wrapBashRequestForNodeCompat } from './sandbox-bash-wrapper'
import {
  formatSandboxDeleteWritebackConfirmationDescription,
  getSandboxDeleteWritebackTargets,
  SANDBOX_DELETE_WRITEBACK_CONFIRMATION_TARGET_REF,
} from './sandbox-delete-confirmation'
import { sandboxExecuteToolInputSchema } from './sandbox-execute-tool-schema'
import type { SandboxExecutionService } from './sandbox-execution-service'
import { resolveSandboxJobGardenShortcut } from './sandbox-garden-shortcut'
import {
  type CommitSandboxWritebackArgs,
  type ExecuteArgs,
  parseSandboxPolicyJson,
  type ValidatedSandboxJobRequest,
  validateCommitSandboxWritebackArgs,
  validateExecuteArgs,
  validateSandboxExecutionRequest,
} from './sandbox-policy'
import type { SandboxWritebackService } from './sandbox-writeback'
import { toCommitSandboxWritebackOutput, toSelectedWritebacks } from './sandbox-writeback-mapping'

// Re-exported for call-site stability: consumers previously imported these
// from this module directly (see sandbox-bash-wrapper.ts, sandbox-garden-shortcut.ts,
// and sandbox-writeback-mapping.ts for the implementations).
export {
  buildSandboxBashWrapperScript,
  resolveSandboxJobGardenShortcut,
  toCommitSandboxWritebackOutput,
}

const toMcpCodeModeFilename = (filename: string | undefined): string => {
  const trimmed = filename?.trim()

  if (!trimmed) {
    return 'execute-mcp-code.mjs'
  }

  return trimmed.replace(/\.(c?js|mjs)$/i, '.mjs')
}

export const registerSandboxNativeTools = (
  toolRegistry: ToolRegistry,
  input: {
    db: AppDatabase
    sandbox: SandboxExecutionService
    writeback: SandboxWritebackService
  },
): void => {
  const queueValidatedSandboxExecution = (
    context: Parameters<NonNullable<ToolSpec['execute']>>[0],
    sandboxPolicy: SandboxPolicy,
    validated: ValidatedSandboxJobRequest,
  ) => {
    const queuedAt = context.nowIso()
    const executionId = asSandboxExecutionId(context.createId('sbx'))
    const jobId = asJobId(context.createId('job'))
    const queued = input.sandbox.queueExecution(context.tenantScope, {
      assignedAgentId: context.run.agentId,
      assignedAgentRevisionId: context.run.agentRevisionId,
      createdAt: queuedAt,
      executionId,
      jobId,
      parentJobId: context.run.jobId,
      policySnapshot: sandboxPolicy,
      request: validated.request,
      requestedPackages: validated.packages.map((requestedPackage) => ({
        ...requestedPackage,
        id: asSandboxExecutionPackageId(context.createId('sbp')),
      })),
      rootJobId: context.run.jobId ?? jobId,
      runId: context.run.id,
      sessionId: context.run.sessionId,
      threadId: context.run.threadId,
      title: `Sandbox: ${validated.request.task}`,
      toolExecutionId: context.toolCallId,
      vaultAccessMode: validated.vaultAccessMode,
      writebacks: validated.writebacks.map((writeback) => ({
        ...writeback,
        id: asSandboxWritebackOperationId(context.createId('sbw')),
      })),
      workspaceId: context.run.workspaceId,
      workspaceRef: context.run.workspaceRef,
    })

    if (!queued.ok) {
      return queued
    }

    return ok({
      kind: 'waiting' as const,
      wait: {
        description: `Waiting for sandbox execution ${queued.value.execution.id}`,
        targetKind: 'external' as const,
        targetRef: `sandbox_execution:${queued.value.execution.id}`,
        type: 'tool' as const,
      },
    })
  }

  const isMcpCodeModeAvailable = (
    context: Parameters<NonNullable<ToolSpec['isAvailable']>>[0],
  ): boolean => resolveMcpModeForRun(input.db, context.tenantScope, context.run) === 'code'

  const prepareExecuteArgsForMcpCodeMode = (
    context: Parameters<NonNullable<ToolSpec['execute']>>[0],
    args: ExecuteArgs,
  ): Result<ExecuteArgs | Extract<ToolOutcome, { kind: 'waiting' }>, DomainError> => {
    if (!isMcpCodeModeAvailable(context) || (args.mode ?? 'bash') !== 'script') {
      return ok(args)
    }

    const source = args.source

    if (!source) {
      return ok(args)
    }

    if (source.kind === 'workspace' || source.kind === 'workspace_script') {
      return ok(args)
    }

    const toolSpecs = context.services.tools
      .list(context)
      .filter((tool) => isToolAllowedForRun(context.db, context.tenantScope, context.run, tool))
    const activeCatalog = buildMcpCodeModeCatalog(context, toolSpecs)
    const runtimeNameMisuse = findMcpRuntimeNameCallMisuse(activeCatalog, source.script)

    if (runtimeNameMisuse) {
      return err({
        message:
          `Internal MCP runtime names are not callable in execute script mode. ` +
          `Use ${runtimeNameMisuse.binding}(...) instead of ${runtimeNameMisuse.runtimeName}(...).`,
        type: 'validation',
      })
    }

    const moduleSyntaxMisuse = findMcpCodeModeModuleSyntaxMisuse(source.script)

    if (moduleSyntaxMisuse) {
      const trimmedSnippet =
        moduleSyntaxMisuse.snippet.length <= 120
          ? moduleSyntaxMisuse.snippet
          : `${moduleSyntaxMisuse.snippet.slice(0, 120)}…`
      const example =
        moduleSyntaxMisuse.kind === 'import'
          ? 'Replace it with `await import(...)`, for example `const { default: sharp } = await import("sharp")` or `const { promises: fs } = await import("node:fs")`.'
          : 'Keep helper declarations local in the script body instead of exporting them, then either `return` one final value or log compact JSON.'

      return err({
        message:
          `execute script mode in MCP code mode expects a script body, not a full module. ` +
          `Found a top-level ${moduleSyntaxMisuse.kind} statement on line ${moduleSyntaxMisuse.line}: ` +
          `${trimmedSnippet}. The MCP runtime wraps your code in an awaited async function, so static top-level import/export is invalid there. ` +
          example,
        type: 'validation',
      })
    }

    const previousExecutions = createToolExecutionRepository(input.db).listByRunId(
      context.tenantScope,
      context.run.id,
    )

    if (!previousExecutions.ok) {
      return previousExecutions
    }

    const loadedLookups = collectLoadedMcpCodeModeLookups(previousExecutions.value)
    const catalog = filterMcpCodeModeCatalogToLoadedTools(activeCatalog, loadedLookups)
    const referencedBindings = findReferencedMcpCodeModeBindings(activeCatalog, source.script)
    const loadedBindings = new Set(catalog.tools.map((tool) => tool.binding))
    const missingBindings = referencedBindings.filter((binding) => !loadedBindings.has(binding))

    if (missingBindings.length > 0) {
      const suggestedCall = `get_tools(${JSON.stringify({ names: missingBindings })})`
      return err({
        message:
          `execute script mode referenced MCP bindings that are not loaded in this run: ${missingBindings.join(', ')}. ` +
          `Next step: call ${suggestedCall}, then rerun execute with those bindings exactly as returned.`,
        type: 'conflict',
      })
    }

    const confirmationBindings = findReferencedNonExecutableMcpCodeModeTools(catalog, source.script)

    if (confirmationBindings.length > 0) {
      return ok({
        kind: 'waiting',
        wait: {
          description:
            formatMcpCodeModeConfirmationDescription(confirmationBindings) ??
            'Confirmation required before execute script mode can call MCP tools.',
          targetKind: 'human_response',
          targetRef: MCP_CODE_MODE_CONFIRMATION_TARGET_REF,
          type: 'human',
        },
      })
    }

    return ok({
      ...args,
      source: {
        filename: toMcpCodeModeFilename(source.filename),
        kind: 'inline_script',
        script: renderMcpCodeModeWrapperScript({
          catalog,
          code: source.script,
        }),
      },
    })
  }

  const executeTool: ToolSpec = {
    attachmentRefResolutionPolicy: 'file_id_only',
    attachmentRefTargetKeys: ['fileId'],
    description:
      'Execute a sandbox task. `mode` defaults to `bash`; use `mode: "script"` for JavaScript, requested npm packages, or MCP code-mode scripts after resolving bindings with get_tools. For inline work, prefer the top-level `script` field and do not pass `source` as a bare string. Each execute call runs in a fresh sandbox: mounted inputs, installed packages, and generated files do not persist to the next call unless you attach outputs or request `outputs.writeBack`. Read staged attachments from `/input/...`, read Garden or vault content only after mounting it, and write generated files to `/output/...` or another absolute sandbox path. In regular inline script mode, prefer `await import(...)`, avoid `require(...)` unless you intentionally provide a `.cjs` filename, and do not use top-level `return`; print one final compact JSON result with `console.log(JSON.stringify(result))`. In MCP code mode, write a script body, not a full module: the runtime wraps your code in an awaited async function, so `return` is allowed there but static top-level `import`/`export` is not. Use `await import(...)` inside the script body instead. For Garden work, prefer `garden: "slug-or-gst_id"` over manual `/vault` boilerplate; the server mounts that garden root, starts `pwd` there, and resolves relative `outputs.writeBack.toVaultPath` values under that garden root. `outputs.writeBack` only requests later vault changes; it does not modify `/vault` during the run. Write, copy, and move write-backs require both `fromPath` and `toVaultPath`; delete write-backs are target-only and require execute-time confirmation before sandbox launch. If the tool output includes files, those files are already attached in the conversation UI, so tell the user the file is attached by filename instead of pasting raw `/v1/files` or `/vault` paths unless they explicitly ask for them. Provider note: the current local_dev Node runner installs requested npm packages with `--ignore-scripts`, so packages that need native addons or install-time setup, such as `sharp`, may fail; prefer pure-JS packages when possible.',
    domain: 'native',
    execute: async (context, rawArgs) => {
      const args = rawArgs as ExecuteArgs

      if (!context.run.agentRevisionId) {
        return err({
          message: 'sandbox execution requires a bound agent revision',
          type: 'conflict',
        })
      }

      const revision = createAgentRevisionRepository(input.db).getById(
        context.tenantScope,
        context.run.agentRevisionId,
      )

      if (!revision.ok) {
        return revision
      }

      const sandboxPolicy = parseSandboxPolicyJson(revision.value.sandboxPolicyJson)

      if (!sandboxPolicy.ok) {
        return sandboxPolicy
      }

      const mcpPreparedArgs = prepareExecuteArgsForMcpCodeMode(context, args)

      if (!mcpPreparedArgs.ok) {
        return mcpPreparedArgs
      }

      if ('kind' in mcpPreparedArgs.value) {
        return ok(mcpPreparedArgs.value)
      }

      const expandedArgs = resolveSandboxJobGardenShortcut(input.db, {
        agentRevisionId: context.run.agentRevisionId,
        args: mcpPreparedArgs.value,
        tenantScope: context.tenantScope,
      })

      if (!expandedArgs.ok) {
        return expandedArgs
      }

      const validated = validateSandboxExecutionRequest(sandboxPolicy.value, expandedArgs.value, {
        defaultMode: 'bash',
        supportedRuntimes: input.sandbox.supportedRuntimes,
      })

      if (!validated.ok) {
        return validated
      }

      const destructiveDeleteTargets = getSandboxDeleteWritebackTargets(validated.value.writebacks)

      if (destructiveDeleteTargets.length > 0 && !context.sandboxDeleteWritebackApproved) {
        return ok({
          kind: 'waiting' as const,
          wait: {
            description:
              formatSandboxDeleteWritebackConfirmationDescription(destructiveDeleteTargets),
            targetKind: 'human_response' as const,
            targetRef: SANDBOX_DELETE_WRITEBACK_CONFIRMATION_TARGET_REF,
            type: 'human' as const,
          },
        })
      }

      const queueableWritebacks = context.sandboxDeleteWritebackApproved
        ? validated.value.writebacks.map((writeback) =>
            writeback.mode === 'delete' ? { ...writeback, requiresApproval: false } : writeback,
          )
        : validated.value.writebacks

      const request =
        validated.value.request.mode === 'bash' && validated.value.request.runtime === 'node'
          ? wrapBashRequestForNodeCompat({
              request: validated.value.request,
              vaultWritable: validated.value.vaultAccessMode === 'read_write',
            })
          : validated.value.request

      return queueValidatedSandboxExecution(context, sandboxPolicy.value, {
        ...validated.value,
        writebacks: queueableWritebacks,
        request:
          context.mcpCodeModeApprovedRuntimeNames?.length &&
          !request.mcpCodeModeApprovedRuntimeNames?.length
            ? {
                ...request,
                mcpCodeModeApprovedRuntimeNames: [...context.mcpCodeModeApprovedRuntimeNames],
              }
            : request,
      })
    },
    inputSchema: sandboxExecuteToolInputSchema,
    isAvailable: (context) =>
      isNativeToolAllowedForRun(input.db, context.tenantScope, context.run, 'execute'),
    name: 'execute',
    strict: false,
    validateArgs: (args) => validateExecuteArgs(args),
  }
  toolRegistry.register(executeTool)

  const commitSandboxWritebackTool: ToolSpec = {
    description:
      'Apply approved sandbox write-back operations from a completed sandbox execution into /vault. This is the second step after execute; it does not run code. Pending write-backs are not applied here and will be skipped until they are reviewed and approved.',
    domain: 'native',
    execute: async (context, rawArgs) => {
      const args = rawArgs as CommitSandboxWritebackArgs
      const execution = createSandboxExecutionRepository(input.db).getById(
        context.tenantScope,
        asSandboxExecutionId(args.sandboxExecutionId),
      )

      if (!execution.ok) {
        return execution
      }

      if (execution.value.runId !== context.run.id) {
        return err({
          message: `sandbox execution ${execution.value.id} does not belong to run ${context.run.id}`,
          type: 'permission',
        })
      }

      const writebacks = createSandboxWritebackRepository(input.db).listBySandboxExecutionId(
        context.tenantScope,
        execution.value.id,
      )

      if (!writebacks.ok) {
        return writebacks
      }

      const applicableWritebacks = toSelectedWritebacks(writebacks.value, args.operations)
      const pendingApprovalWritebacks = applicableWritebacks.filter(
        (operation) => operation.requiresApproval && operation.status === 'pending',
      )

      if (pendingApprovalWritebacks.length > 0) {
        return ok({
          kind: 'waiting' as const,
          wait: {
            description:
              pendingApprovalWritebacks.length === 1
                ? `Approve applying sandbox write-back into ${pendingApprovalWritebacks[0]?.targetVaultPath ?? '/vault/...'}`
                : `Approve applying ${pendingApprovalWritebacks.length} sandbox write-backs into /vault`,
            targetKind: 'human_response' as const,
            targetRef: `sandbox_writeback:${execution.value.id}`,
            type: 'human' as const,
          },
        })
      }

      const committed = await input.writeback.commitApprovedWritebacks(context.tenantScope, {
        committedAt: context.nowIso(),
        operationIds: args.operations?.map(asSandboxWritebackOperationId),
        sandboxExecutionId: execution.value.id,
      })

      if (!committed.ok) {
        return committed
      }

      return ok({
        kind: 'immediate' as const,
        output: toCommitSandboxWritebackOutput({
          applied: committed.value.applied,
          executionId: committed.value.executionId,
          skipped: committed.value.skipped,
        }),
      })
    },
    inputSchema: {
      additionalProperties: false,
      properties: {
        operations: {
          description:
            'Optional subset of approved write-back operation ids to apply. Omit to apply every approved pending operation for the sandbox execution.',
          items: {
            type: 'string',
          },
          type: 'array',
        },
        sandboxExecutionId: {
          description: 'The sandbox execution id returned by a completed execute call.',
          type: 'string',
        },
      },
      required: ['sandboxExecutionId'],
      type: 'object',
    },
    isAvailable: (context) =>
      isNativeToolAllowedForRun(
        input.db,
        context.tenantScope,
        context.run,
        'commit_sandbox_writeback',
      ),
    name: 'commit_sandbox_writeback',
    strict: false,
    validateArgs: (args) => validateCommitSandboxWritebackArgs(args),
  }

  toolRegistry.register(commitSandboxWritebackTool)
}
