import { createAgentRevisionRepository } from '../persistence/repositories'
import type { ToolOutcome, ToolRegistry, ToolSpec } from '../../application/tooling/tool-registry'
import type { AppDatabase } from '../../db/client'
import { createToolExecutionRepository } from '../persistence/repositories'
import { createSandboxExecutionRepository } from '../persistence/repositories'
import type { SandboxWritebackOperationRecord } from '../../domain/sandbox/sandbox-writeback-repository'
import { createSandboxWritebackRepository } from '../persistence/repositories'
import type { SandboxPolicy } from '../../domain/sandbox/types'
import type { DomainError } from '../../shared/errors'
import {
  type AgentRevisionId,
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
import { loadGardenAgentContext } from '../garden/garden-agent-context'
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
  formatSandboxDeleteWritebackConfirmationDescription,
  getSandboxDeleteWritebackTargets,
  SANDBOX_DELETE_WRITEBACK_CONFIRMATION_TARGET_REF,
} from './sandbox-delete-confirmation'
import type { SandboxExecutionService } from './sandbox-execution-service'
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

const toSelectedWritebacks = (
  writebacks: SandboxWritebackOperationRecord[],
  operationIds?: string[],
): SandboxWritebackOperationRecord[] => {
  const selectedIds = operationIds ? new Set(operationIds) : null

  return writebacks.filter((operation) => (selectedIds ? selectedIds.has(operation.id) : true))
}

const normalizeGardenSelector = (value: string): string => value.trim()

const toMcpCodeModeFilename = (filename: string | undefined): string => {
  const trimmed = filename?.trim()

  if (!trimmed) {
    return 'execute-mcp-code.mjs'
  }

  return trimmed.replace(/\.(c?js|mjs)$/i, '.mjs')
}

const resolveGardenVaultPath = (gardenRoot: string, value: string): string => {
  const trimmed = value.trim()

  if (trimmed.startsWith('/')) {
    return trimmed
  }

  if (trimmed.length === 0 || trimmed === '.') {
    return gardenRoot
  }

  const withoutCurrentDir = trimmed.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '')

  return withoutCurrentDir.length > 0 ? `${gardenRoot}/${withoutCurrentDir}` : gardenRoot
}

const ensureGardenVaultInput = (
  existingVaultInputs: NonNullable<ExecuteArgs['vaultInputs']>,
  gardenRoot: string,
): NonNullable<ExecuteArgs['vaultInputs']> => {
  const alreadyMountsGarden = existingVaultInputs.some(
    (entry) =>
      entry.vaultPath.trim() === gardenRoot &&
      (entry.mountPath?.trim() ?? entry.vaultPath.trim()) === gardenRoot,
  )

  return alreadyMountsGarden
    ? existingVaultInputs
    : [
        ...existingVaultInputs,
        {
          mountPath: gardenRoot,
          vaultPath: gardenRoot,
        },
      ]
}

const resolveGardenSource = (
  gardenRoot: string,
  source: ExecuteArgs['source'],
): ExecuteArgs['source'] => {
  if (source.kind !== 'workspace_script' && source.kind !== 'workspace') {
    return source
  }

  return {
    ...source,
    vaultPath: resolveGardenVaultPath(gardenRoot, source.vaultPath),
  }
}

const resolveGardenOutputs = (
  gardenRoot: string,
  outputs: ExecuteArgs['outputs'],
): ExecuteArgs['outputs'] => {
  if (!outputs?.writeBack) {
    return outputs
  }

  return {
    ...outputs,
    writeBack: outputs.writeBack.map((writeback) => ({
      ...writeback,
      toVaultPath: resolveGardenVaultPath(gardenRoot, writeback.toVaultPath),
    })),
  }
}

const toSandboxBashNetworkConfig = (
  network: ValidatedSandboxJobRequest['request']['network'],
): Record<string, unknown> | undefined => {
  if (network.mode === 'off') {
    return undefined
  }

  if (network.mode === 'open') {
    return {
      dangerouslyAllowFullInternetAccess: true,
    }
  }

  const allowedHosts = network.allowedHosts ?? []

  return allowedHosts.length > 0
    ? {
        allowedUrlPrefixes: allowedHosts.flatMap((host) => [`https://${host}`, `http://${host}`]),
      }
    : undefined
}

export const buildSandboxBashWrapperScript = (input: {
  cwd: string
  env?: Record<string, string>
  mountVault: boolean
  network: ValidatedSandboxJobRequest['request']['network']
  script?: string
  scriptPath?: string
  stdin?: string
  vaultWritable: boolean
}): string => {
  const networkConfig = toSandboxBashNetworkConfig(input.network)
  const scriptLoader =
    typeof input.scriptPath === 'string'
      ? `const scriptSource = await fs.readFile(${JSON.stringify(input.scriptPath)}, "utf8");`
      : `const scriptSource = ${JSON.stringify(input.script ?? '')};`

  return `
import { Bash, InMemoryFs, MountableFs, OverlayFs, ReadWriteFs } from "just-bash";

const fs = new MountableFs({ base: new InMemoryFs() });
fs.mount("/input", new OverlayFs({ root: "/input", mountPoint: "/", readOnly: true }));
fs.mount("/work", new ReadWriteFs({ root: "/work" }));
fs.mount("/output", new ReadWriteFs({ root: "/output" }));
${input.mountVault ? `fs.mount("/vault", new ${input.vaultWritable ? 'ReadWriteFs' : 'OverlayFs'}({ root: "/vault"${input.vaultWritable ? '' : ', mountPoint: "/", readOnly: true'} }));` : ''}

const bash = new Bash({
  fs,
  cwd: ${JSON.stringify(input.cwd)},
  ${networkConfig ? `network: ${JSON.stringify(networkConfig)},` : ''}
});

try {
  ${scriptLoader}
  const result = await bash.exec(scriptSource, {
    ${input.env ? `env: ${JSON.stringify(input.env)},` : ''}
    ${input.stdin !== undefined ? `stdin: ${JSON.stringify(input.stdin)},` : ''}
    rawScript: true,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
} catch (error) {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(\`\${text}\\n\`);
  process.exitCode = 1;
}
`.trim()
}

const dirnameOfSandboxPath = (value: string): string => {
  const trimmed = value.trim()

  if (trimmed === '/' || trimmed.length === 0) {
    return '/'
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '')
  const lastSlashIndex = withoutTrailingSlash.lastIndexOf('/')

  if (lastSlashIndex <= 0) {
    return '/'
  }

  return withoutTrailingSlash.slice(0, lastSlashIndex)
}

const wrapBashRequestForNodeCompat = (input: {
  request: ValidatedSandboxJobRequest['request']
  stdin?: string
  vaultWritable: boolean
}): ValidatedSandboxJobRequest['request'] => {
  const mountVault =
    (input.request.vaultInputs?.length ?? 0) > 0 || typeof input.request.cwdVaultPath === 'string'
  const cwd =
    input.request.cwdVaultPath ??
    (input.request.source.kind === 'workspace_script'
      ? dirnameOfSandboxPath(input.request.source.vaultPath)
      : '/work')

  return {
    ...input.request,
    source: {
      filename: 'execute-bash.mjs',
      kind: 'inline_script',
      script: buildSandboxBashWrapperScript({
        cwd,
        env: input.request.env,
        mountVault,
        network: input.request.network,
        ...(input.request.source.kind === 'inline_script'
          ? { script: input.request.source.script }
          : { scriptPath: input.request.source.vaultPath }),
        stdin: input.stdin,
        vaultWritable: input.vaultWritable,
      }),
    },
  }
}

export const resolveSandboxJobGardenShortcut = (
  db: AppDatabase,
  input: {
    agentRevisionId: AgentRevisionId
    args: ExecuteArgs
    tenantScope: Parameters<typeof loadGardenAgentContext>[1]
  },
): Result<ExecuteArgs, DomainError> => {
  const selector = normalizeGardenSelector(input.args.garden ?? '')

  if (selector.length === 0) {
    return ok(input.args)
  }

  const gardenContext = loadGardenAgentContext(db, input.tenantScope, input.agentRevisionId)

  if (!gardenContext.ok) {
    return gardenContext
  }

  const site = gardenContext.value.gardens.find(
    (candidate) => candidate.slug === selector || candidate.id === selector,
  )

  if (!site) {
    return err({
      message: `garden ${selector} was not found in the current account workspace`,
      type: 'not_found',
    })
  }

  const existingVaultInputs = [...(input.args.vaultInputs ?? [])]
  const vaultInputs = ensureGardenVaultInput(existingVaultInputs, site.sourceRoot)
  const source = resolveGardenSource(site.sourceRoot, input.args.source)
  const outputs = resolveGardenOutputs(site.sourceRoot, input.args.outputs)

  return ok({
    ...input.args,
    ...(input.args.cwdVaultPath ? {} : { cwdVaultPath: site.sourceRoot }),
    ...(outputs ? { outputs } : {}),
    source,
    vaultInputs,
  } satisfies ExecuteArgs)
}

export const toCommitSandboxWritebackOutput = (input: {
  applied: Array<Pick<SandboxWritebackOperationRecord, 'id' | 'operation' | 'targetVaultPath'>>
  executionId: string
  skipped: Array<{
    id: string
    reason: string
  }>
}) => {
  const allSkippedPendingApproval =
    input.applied.length === 0 &&
    input.skipped.length > 0 &&
    input.skipped.every((entry) => entry.reason === 'status_pending')

  return {
    applied: input.applied.map((operation) => ({
      id: operation.id,
      operation: operation.operation,
      targetVaultPath: operation.targetVaultPath,
    })),
    ...(allSkippedPendingApproval
      ? {
          message:
            'No write-backs were applied because they are still pending approval. Review and approve them before committing.',
          status: 'waiting_for_approval' as const,
        }
      : {}),
    sandboxExecutionId: input.executionId,
    skipped: input.skipped,
  }
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

  const executeInputSchema = {
    additionalProperties: false,
    properties: {
      args: {
        description: 'Optional argv passed to the sandbox script.',
        items: {
          type: 'string',
        },
        type: 'array',
      },
      attachments: {
        description: 'Optional files to stage into the sandbox, usually mounted under /input/....',
        items: {
          additionalProperties: false,
          properties: {
            fileId: {
              description:
                'Existing file id or full canonical attachment ref to stage into the sandbox. Do not pass shorthand aliases like attachment[1] or image[2] here.',
              type: 'string',
            },
            mountPath: {
              description:
                'Optional absolute sandbox path where the attachment should appear. Prefer /input/... for files used only during the run.',
              type: 'string',
            },
          },
          required: ['fileId'],
          type: 'object',
        },
        type: 'array',
      },
      garden: {
        description:
          'Optional Garden slug or gst_... id. Prefer this for Garden work; the server will mount that garden at its resolved /vault source root, set `pwd` to that root automatically, and resolve relative outputs.writeBack.toVaultPath values under that garden root. After `garden: "overment"`, prefer relative paths like `_garden.yml` over guessed absolute paths. Use `toVaultPath: "."` to target the garden root itself.',
        type: 'string',
      },
      mode: {
        description:
          'Execution mode. execute defaults to bash when omitted. Use bash for shell-style file inspection or manipulation, and script for custom JavaScript or MCP code-mode scripts.',
        enum: ['script', 'bash'],
        type: 'string',
      },
      cwdVaultPath: {
        description:
          'Optional /vault/... path to stage and use as the working directory. This is one way to make /vault content available inside the sandbox. Usually omit this when garden is provided.',
        type: 'string',
      },
      env: {
        description: 'Optional environment variables for the sandbox process.',
        additionalProperties: {
          type: 'string',
        },
        type: 'object',
      },
      filename: {
        description:
          'Optional filename for inline script input. Inline script defaults to an ES module file, so usually omit this or use a stable `.mjs` name. Use a `.cjs` filename only when the script truly needs CommonJS `require(...)` semantics.',
        type: 'string',
      },
      network: {
        description:
          'Optional runtime network request. If omitted, network defaults to off. Use on only when the agent policy allows it; allow-listed agents may still be restricted to approved hosts.',
        additionalProperties: false,
        properties: {
          hosts: {
            description:
              'Optional host allow list for this run when network.mode is on and the agent policy uses an allow list.',
            items: {
              type: 'string',
            },
            type: 'array',
          },
          mode: {
            description: 'Use off for no network or on for network access allowed by policy.',
            enum: ['off', 'on'],
            type: 'string',
          },
        },
        required: ['mode'],
        type: 'object',
      },
      outputs: {
        description:
          'Optional output handling. Matching files can be attached after the run, and writeBack entries can request later vault changes.',
        additionalProperties: false,
        properties: {
          attachGlobs: {
            description:
              'Promote matching sandbox files, usually under /output/..., as attachments after the run completes.',
            items: {
              type: 'string',
            },
            type: 'array',
          },
          writeBack: {
            description:
              'Propose copy, move, write, or delete operations into /vault/.... This requires read_write vault access and still needs commit_sandbox_writeback after the run completes. For write, copy, and move, provide both fromPath and toVaultPath. For delete, provide only toVaultPath. Delete still validates the target as a canonical /vault path, rejects traversal, and asks for execute-time confirmation before the sandbox launches.',
            items: {
              oneOf: [
                {
                  additionalProperties: false,
                  properties: {
                    fromPath: {
                      description:
                        'Absolute sandbox path to copy from, usually /output/... or another absolute path created during the run.',
                      type: 'string',
                    },
                    mode: {
                      description: 'How the sandbox file should later be applied into /vault.',
                      enum: ['write', 'copy', 'move'],
                      type: 'string',
                    },
                    toVaultPath: {
                      description:
                        'Target path under /vault/.... When garden is provided, a relative path resolves under that garden root.',
                      type: 'string',
                    },
                  },
                  required: ['fromPath', 'mode', 'toVaultPath'],
                  type: 'object',
                },
                {
                  additionalProperties: false,
                  properties: {
                    mode: {
                      description: 'Delete an existing path in /vault at commit time.',
                      enum: ['delete'],
                      type: 'string',
                    },
                    toVaultPath: {
                      description:
                        'Target path under /vault/.... When garden is provided, a relative path resolves under that garden root.',
                      type: 'string',
                    },
                  },
                  required: ['mode', 'toVaultPath'],
                  type: 'object',
                },
              ],
            },
            type: 'array',
          },
        },
        type: 'object',
      },
      packages: {
        description:
          'Exact npm packages to install before the script runs, for example { name: "pdf-lib", version: "1.17.1" }. Do not list built-in packages like just-bash here.',
        items: {
          additionalProperties: false,
          properties: {
            name: { description: 'npm package name.', type: 'string' },
            version: { description: 'Exact package version.', type: 'string' },
          },
          required: ['name', 'version'],
          type: 'object',
        },
        type: 'array',
      },
      script: {
        description:
          'Preferred inline input for execute. In bash mode this is the shell-style script body. In script mode this is JavaScript source code. Inline script mode normally runs as an ES module: prefer `await import(...)`, avoid `require(...)` unless you intentionally use a `.cjs` filename, and outside MCP code mode do not use top-level `return`. In MCP code mode, write a script body, not a full module: the runtime wraps your code in an awaited async function, so `return` is allowed there but static top-level `import`/`export` is not. Use `await import(...)` inside the script body instead. Provider note: the current local_dev Node runner installs requested npm packages with `--ignore-scripts`, so packages that need native addons or install-time setup, such as `sharp`, may fail; prefer pure-JS packages when possible. When script is provided, omit source.',
        type: 'string',
      },
      source: {
        description:
          'Advanced source object. Always pass source as an object, never as a bare string. Prefer the top-level script field for inline bash or JavaScript. Use source only when you need an explicit kind or a staged workspace script.',
        additionalProperties: false,
        properties: {
          filename: {
            description:
              'Optional filename to use for inline script input inside /work. Inline script defaults to ES module semantics; use `.cjs` only when CommonJS is required.',
            type: 'string',
          },
          kind: {
            description:
              'Use inline or inline_script for inline content, or workspace or workspace_script for a staged /vault script. When omitted, the server infers inline from script or workspace from vaultPath.',
            enum: ['inline', 'inline_script', 'workspace', 'workspace_script'],
            type: 'string',
          },
          script: {
            description:
              'Inline content. In bash mode this is the shell script string. In script mode this is JavaScript source code.',
            type: 'string',
          },
          vaultPath: {
            description:
              'Path to an existing staged script under /vault/.... When garden is provided, a relative path resolves under that garden root.',
            type: 'string',
          },
        },
        type: 'object',
      },
      task: {
        description: 'Short human-readable task title for the sandbox run.',
        type: 'string',
      },
      vaultAccess: {
        description:
          'Optional vault access override kept for compatibility. Usually omit it; the server infers read_only or read_write from mounted inputs and outputs.writeBack. This grants permission only; it does not mount /vault into the sandbox by itself.',
        enum: ['read_only', 'read_write'],
        type: 'string',
      },
      vaultInputs: {
        description:
          'Optional files or directories to stage from /vault into the sandbox. Use this or cwdVaultPath whenever your script needs to read /vault/... paths. Usually omit this when garden is provided.',
        items: {
          additionalProperties: false,
          properties: {
            mountPath: {
              description:
                'Optional absolute sandbox path where the staged vault entry should appear. /vault/... is the safest default, but any absolute sandbox path is accepted.',
              type: 'string',
            },
            vaultPath: { description: 'Source path under /vault/....', type: 'string' },
          },
          required: ['vaultPath'],
          type: 'object',
        },
        type: 'array',
      },
      vaultPath: {
        description:
          'Preferred alias for a staged workspace script under /vault/.... Use this instead of source for simple workspace script runs. When garden is provided, a relative path resolves under that garden root.',
        type: 'string',
      },
    },
    required: ['task'],
    type: 'object',
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
    inputSchema: executeInputSchema,
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
