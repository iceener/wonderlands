import { getMcpRuntimeNameAliasesFromRuntimeName } from '../../../../adapters/mcp/normalize-tool'
import { withTransaction } from '../../../../db/transaction'
import { createMcpToolAssignmentRepository } from '../../../../domain/mcp/mcp-tool-assignment-repository'
import { createItemRepository } from '../../../../domain/runtime/item-repository'
import { createRunDependencyRepository } from '../../../../domain/runtime/run-dependency-repository'
import { createToolExecutionRepository } from '../../../../domain/runtime/tool-execution-repository'
import { asItemId } from '../../../../shared/ids'
import { err, ok } from '../../../../shared/result'
import { isToolAllowedForRun } from '../../../agents/agent-runtime-policy'
import type { CommandResult } from '../../../commands/command-context'
import { createEventStore } from '../../../commands/event-store'
import {
  buildMcpCodeModeCatalog,
  collectLoadedMcpCodeModeLookups,
  filterMcpCodeModeCatalogToLoadedTools,
  findReferencedNonExecutableMcpCodeModeTools,
} from '../../../mcp/code-mode'
import { type ExecuteArgs, validateExecuteArgs } from '../../../sandbox/sandbox-policy'
import { executeOneToolCall, toToolContext } from '../../execution/run-tool-execution'
import { appendDomainEvent } from '../../run-events'
import { getToolAppsMetaPayload } from '../../tool-apps-meta'
import {
  appendToolCompletedEvent,
  appendToolConfirmationGrantedEvent,
  appendToolConfirmationRejectedEvent,
  appendToolFailedEvent,
  persistCompletedToolExecutionWithOutput,
  persistFailedToolExecutionWithOutput,
  toToolArgs,
  toToolErrorOutput,
  toToolExecutionEventPayload,
} from '../../tool-execution-persistence'
import { requiresConfirmationForToolWait } from '../tool-confirmation'
import {
  type LoadedWaitResolution,
  type RunWaitResolutionState,
  resumeOrStayWaiting,
  unwrapOrThrow,
} from './wait-resolution-support'

interface ExecuteMcpConfirmationTarget {
  binding: string
  fingerprint: string | null
  runtimeName: string
}

const rejectionMessage = 'Execute script rejected because MCP tool confirmation was denied'

const loadExecuteMcpConfirmationTargets = (
  loaded: LoadedWaitResolution,
): CommandResult<{
  approvalTargets: ExecuteMcpConfirmationTarget[]
  args: ExecuteArgs
}> => {
  const { context, currentRun, runDependency, toolExecution } = loaded
  const parsedArgs = validateExecuteArgs(toolExecution.argsJson ?? {})

  if (!parsedArgs.ok) {
    return parsedArgs
  }

  const source = parsedArgs.value.source

  if ((parsedArgs.value.mode ?? 'bash') !== 'script' || !source) {
    return err({
      message: `execute confirmation wait ${runDependency.id} no longer references a script-mode execute call`,
      type: 'conflict',
    })
  }

  if (source.kind === 'workspace' || source.kind === 'workspace_script') {
    return err({
      message: `execute confirmation wait ${runDependency.id} no longer targets an inline MCP code-mode script`,
      type: 'conflict',
    })
  }

  const toolContext = toToolContext(context, currentRun, runDependency.callId)
  const toolSpecs = context.services.tools
    .list(toolContext)
    .filter((tool) => isToolAllowedForRun(context.db, context.tenantScope, currentRun, tool))
  const activeCatalog = buildMcpCodeModeCatalog(toolContext, toolSpecs)
  const previousExecutions = createToolExecutionRepository(context.db).listByRunId(
    context.tenantScope,
    currentRun.id,
  )

  if (!previousExecutions.ok) {
    return previousExecutions
  }

  const loadedLookups = collectLoadedMcpCodeModeLookups(previousExecutions.value)
  const catalog = filterMcpCodeModeCatalogToLoadedTools(activeCatalog, loadedLookups)
  const referencedTools = findReferencedNonExecutableMcpCodeModeTools(catalog, source.script)
  const approvalTargets: ExecuteMcpConfirmationTarget[] = []

  for (const tool of referencedTools) {
    const descriptor = context.services.mcp.getTool(tool.runtimeName)

    if (!descriptor) {
      return err({
        message: `MCP tool ${tool.runtimeName} is no longer available for execute confirmation`,
        type: 'conflict',
      })
    }

    approvalTargets.push({
      binding: tool.binding,
      fingerprint: descriptor.fingerprint,
      runtimeName: descriptor.runtimeName,
    })
  }

  return ok({
    approvalTargets,
    args: parsedArgs.value,
  })
}

const toApprovalResolution = (
  approvalTargets: ExecuteMcpConfirmationTarget[],
  remembered: boolean,
): Record<string, unknown> => {
  if (approvalTargets.length === 1) {
    const target = approvalTargets[0]

    return {
      approved: true,
      ...(target?.fingerprint ? { fingerprint: target.fingerprint } : {}),
      remembered,
      ...(target ? { runtimeName: target.runtimeName } : {}),
    }
  }

  return {
    approved: true,
    ...(approvalTargets.length > 0
      ? {
          approvals: approvalTargets.map((target) => ({
            ...(target.fingerprint ? { fingerprint: target.fingerprint } : {}),
            runtimeName: target.runtimeName,
          })),
        }
      : {}),
    remembered,
  }
}

export const resolveExecuteMcpConfirmationWait = async (
  loaded: LoadedWaitResolution,
): Promise<CommandResult<RunWaitResolutionState>> => {
  const { context, currentRun, input, resolvedAt, runDependency, runId, toolExecution } = loaded

  if (!input.approve) {
    const rejected = withTransaction(context.db, (tx) => {
      const txItemRepository = createItemRepository(tx)
      const txToolExecutionRepository = createToolExecutionRepository(tx)
      const txRunDependencyRepository = createRunDependencyRepository(tx)
      const eventStore = createEventStore(tx)
      const nextSequence = unwrapOrThrow(
        txItemRepository.getNextSequence(context.tenantScope, runId),
      )
      const errorEnvelope = toToolErrorOutput(rejectionMessage)

      persistFailedToolExecutionWithOutput({
        callId: runDependency.callId,
        completedAt: resolvedAt,
        durationMs: null,
        errorText: rejectionMessage,
        itemId: asItemId(context.services.ids.create('itm')),
        itemRepository: txItemRepository,
        output: errorEnvelope,
        runId,
        scope: context.tenantScope,
        sequence: nextSequence,
        tool: toolExecution.tool,
        toolExecutionRepository: txToolExecutionRepository,
      })

      unwrapOrThrow(
        txRunDependencyRepository.resolve(context.tenantScope, {
          id: input.waitId,
          resolutionJson: {
            approved: false,
            error: rejectionMessage,
          },
          resolvedAt,
          status: 'resolved',
        }),
      )

      appendToolConfirmationRejectedEvent(context, eventStore, currentRun, {
        callId: runDependency.callId,
        tool: toolExecution.tool,
        waitId: input.waitId,
      })

      appendToolFailedEvent(context, eventStore, currentRun, {
        callId: runDependency.callId,
        error: errorEnvelope,
        tool: toolExecution.tool,
      })

      return ok(null)
    })

    if (!rejected.ok) {
      return rejected
    }

    return resumeOrStayWaiting(context, currentRun, runId)
  }

  const loadedTargets = loadExecuteMcpConfirmationTargets(loaded)

  if (!loadedTargets.ok) {
    return loadedTargets
  }

  const { approvalTargets, args } = loadedTargets.value
  const rememberApprovalRequested = input.rememberApproval ?? false
  const toolProfileId = currentRun.toolProfileId
  const rememberApproval =
    rememberApprovalRequested && toolProfileId !== null && approvalTargets.length > 0

  if (rememberApproval && approvalTargets.some((target) => !target.fingerprint)) {
    return err({
      message:
        'One or more MCP tools referenced by execute cannot be trusted because no fingerprint is available',
      type: 'conflict',
    })
  }

  const approvalAppliedAt = context.services.clock.nowIso()
  const approvalApplied = withTransaction(context.db, (tx) => {
    if (!rememberApproval || !toolProfileId) {
      return ok(null)
    }

    const assignmentRepository = createMcpToolAssignmentRepository(tx)

    for (const approvalTarget of approvalTargets) {
      unwrapOrThrow(
        assignmentRepository.approveFingerprintByAnyRuntimeName(context.tenantScope, {
          approvedAt: approvalAppliedAt,
          fingerprint: approvalTarget.fingerprint ?? '',
          toolProfileId,
          runtimeNames: getMcpRuntimeNameAliasesFromRuntimeName(approvalTarget.runtimeName),
        }),
      )
    }

    return ok(null)
  })

  if (!approvalApplied.ok) {
    return approvalApplied
  }

  const rerun = await executeOneToolCall(
    context,
    currentRun,
    {
      call: {
        arguments: args,
        argumentsJson: JSON.stringify(args ?? null),
        callId: runDependency.callId,
        name: toolExecution.tool,
      },
      domain: toolExecution.domain,
      startedAt: toolExecution.startedAt ?? toolExecution.createdAt,
      tool: context.services.tools.get(toolExecution.tool),
      toolName: toolExecution.tool,
    },
    undefined,
    {
      mcpCodeModeApprovedRuntimeNames: approvalTargets.map((target) => target.runtimeName),
    },
  )

  if (!rerun.error && !rerun.outcome) {
    return err({
      message: `execute confirmation rerun produced no outcome for tool call ${runDependency.callId}`,
      type: 'conflict',
    })
  }

  const rerunOutcome = rerun.outcome
  const approvalResolution = toApprovalResolution(approvalTargets, rememberApproval)
  const persisted = withTransaction(context.db, (tx) => {
    const txItemRepository = createItemRepository(tx)
    const txToolExecutionRepository = createToolExecutionRepository(tx)
    const txRunDependencyRepository = createRunDependencyRepository(tx)
    const eventStore = createEventStore(tx)
    const completedAt = context.services.clock.nowIso()
    const rememberedFingerprint =
      rememberApproval && approvalTargets.length === 1 ? approvalTargets[0]?.fingerprint : null

    appendToolConfirmationGrantedEvent(context, eventStore, currentRun, {
      callId: runDependency.callId,
      ...(rememberedFingerprint ? { fingerprint: rememberedFingerprint } : {}),
      remembered: rememberApproval,
      tool: toolExecution.tool,
      waitId: input.waitId,
    })

    unwrapOrThrow(
      txRunDependencyRepository.resolve(context.tenantScope, {
        id: input.waitId,
        resolutionJson: approvalResolution,
        resolvedAt: completedAt,
        status: 'resolved',
      }),
    )

    if (rerun.error) {
      const nextSequence = unwrapOrThrow(
        txItemRepository.getNextSequence(context.tenantScope, runId),
      )
      const errorEnvelope = toToolErrorOutput(rerun.error)
      const toolAppsMetaPayload = getToolAppsMetaPayload(context, toolExecution.tool)

      persistFailedToolExecutionWithOutput({
        callId: runDependency.callId,
        completedAt,
        durationMs: null,
        errorText: rerun.error.message,
        itemId: asItemId(context.services.ids.create('itm')),
        itemRepository: txItemRepository,
        output: errorEnvelope,
        runId,
        scope: context.tenantScope,
        sequence: nextSequence,
        tool: toolExecution.tool,
        toolExecutionRepository: txToolExecutionRepository,
      })

      appendToolFailedEvent(context, eventStore, currentRun, {
        ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
        callId: runDependency.callId,
        error: errorEnvelope,
        tool: toolExecution.tool,
      })

      return ok(null)
    }

    if (rerunOutcome?.kind === 'immediate') {
      const nextSequence = unwrapOrThrow(
        txItemRepository.getNextSequence(context.tenantScope, runId),
      )
      const toolAppsMetaPayload = getToolAppsMetaPayload(
        context,
        toolExecution.tool,
        rerunOutcome.output,
      )

      persistCompletedToolExecutionWithOutput({
        callId: runDependency.callId,
        completedAt,
        durationMs: null,
        itemId: asItemId(context.services.ids.create('itm')),
        itemRepository: txItemRepository,
        output: rerunOutcome.output,
        runId,
        scope: context.tenantScope,
        sequence: nextSequence,
        tool: toolExecution.tool,
        toolExecutionRepository: txToolExecutionRepository,
      })

      appendToolCompletedEvent(context, eventStore, currentRun, {
        ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
        callId: runDependency.callId,
        outcome: rerunOutcome.output,
        tool: toolExecution.tool,
      })

      return ok(null)
    }

    if (!rerunOutcome || rerunOutcome.kind !== 'waiting') {
      throw new Error(
        `execute confirmation rerun produced an unsupported outcome for tool call ${runDependency.callId}`,
      )
    }

    const newWaitId = context.services.ids.create('wte')

    unwrapOrThrow(
      txRunDependencyRepository.create(context.tenantScope, {
        callId: runDependency.callId,
        createdAt: completedAt,
        description: rerunOutcome.wait.description ?? null,
        id: newWaitId,
        runId,
        targetKind: rerunOutcome.wait.targetKind,
        targetRef: rerunOutcome.wait.targetRef ?? toolExecution.tool,
        targetRunId: rerunOutcome.wait.targetRunId ?? null,
        timeoutAt: rerunOutcome.wait.timeoutAt ?? null,
        type: rerunOutcome.wait.type,
      }),
    )

    appendDomainEvent(context, eventStore, {
      aggregateId: runDependency.callId,
      aggregateType: 'tool_execution',
      payload: toToolExecutionEventPayload(
        currentRun,
        {
          callId: runDependency.callId,
          tool: toolExecution.tool,
        },
        {
          args: toToolArgs(args),
          description: rerunOutcome.wait.description ?? null,
          waitId: newWaitId,
          waitTargetKind: rerunOutcome.wait.targetKind,
          waitTargetRef: rerunOutcome.wait.targetRef ?? toolExecution.tool,
          ...(rerunOutcome.wait.targetRunId
            ? { waitTargetRunId: rerunOutcome.wait.targetRunId }
            : {}),
          waitType: rerunOutcome.wait.type,
        },
      ),
      type: requiresConfirmationForToolWait(rerunOutcome.wait, {
        domain: rerun.domain,
        tool: rerun.toolName,
      })
        ? 'tool.confirmation_requested'
        : 'tool.waiting',
    })

    return ok(null)
  })

  if (!persisted.ok) {
    return persisted
  }

  return resumeOrStayWaiting(context, currentRun, runId)
}
