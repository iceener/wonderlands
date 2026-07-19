import { getMcpRuntimeNameAliasesFromRuntimeName } from '../../../../adapters/mcp/normalize-tool'
import { createMcpToolAssignmentRepository } from '../../../../adapters/persistence/sqlite/mcp/mcp-tool-assignment-repository'
import { withTransaction } from '../../../../db/transaction'
import { createItemRepository } from '../../../../domain/runtime/item-repository'
import { createRunDependencyRepository } from '../../../../domain/runtime/run-dependency-repository'
import { createToolExecutionRepository } from '../../../../domain/runtime/tool-execution-repository'
import { asItemId } from '../../../../shared/ids'
import { err, ok } from '../../../../shared/result'
import type { CommandResult } from '../../../commands/command-context'
import { createEventStore } from '../../../commands/event-store'
import { toToolContext } from '../../execution/run-tool-execution'
import { getToolAppsMetaPayload } from '../../tool-apps-meta'
import {
  appendToolCompletedEvent,
  appendToolConfirmationGrantedEvent,
  appendToolConfirmationRejectedEvent,
  appendToolFailedEvent,
  persistCompletedToolExecutionWithOutput,
  persistFailedToolExecutionWithOutput,
} from '../../tool-execution-persistence'
import {
  type LoadedWaitResolution,
  type RunWaitResolutionState,
  resumeOrStayWaiting,
  toToolErrorOutput,
  unwrapOrThrow,
} from './wait-resolution-support'

export const resolveMcpConfirmationWait = async (
  loaded: LoadedWaitResolution,
): Promise<CommandResult<RunWaitResolutionState>> => {
  const { context, currentRun, input, resolvedAt, runDependency, runId, toolExecution } = loaded

  if (!input.approve) {
    const rejectionMessage = 'MCP tool execution rejected during confirmation'
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

  const descriptor = context.services.mcp.getTool(toolExecution.tool)

  if (!descriptor) {
    return err({
      message: `MCP tool ${toolExecution.tool} is no longer available for confirmation`,
      type: 'conflict',
    })
  }

  const rememberApprovalRequested = input.rememberApproval ?? false
  const toolProfileId = currentRun.toolProfileId
  const rememberApproval = rememberApprovalRequested && toolProfileId !== null
  const approvalResolution = {
    approved: true,
    fingerprint: descriptor.fingerprint,
    remembered: rememberApproval,
  }
  const approvalAppliedAt = context.services.clock.nowIso()
  const approvalApplied = withTransaction(context.db, (tx) => {
    if (rememberApproval) {
      const assignmentRepository = createMcpToolAssignmentRepository(tx)

      unwrapOrThrow(
        assignmentRepository.approveFingerprintByAnyRuntimeName(context.tenantScope, {
          approvedAt: approvalAppliedAt,
          fingerprint: descriptor.fingerprint,
          toolProfileId,
          runtimeNames: getMcpRuntimeNameAliasesFromRuntimeName(toolExecution.tool),
        }),
      )
    }

    return ok(null)
  })

  if (!approvalApplied.ok) {
    return approvalApplied
  }

  const remoteResult = await context.services.mcp.callTool({
    args:
      toolExecution.argsJson &&
      typeof toolExecution.argsJson === 'object' &&
      !Array.isArray(toolExecution.argsJson)
        ? toolExecution.argsJson
        : {},
    context: toToolContext(context, currentRun, runDependency.callId),
    runtimeName: toolExecution.tool,
  })

  const persistedRemoteResult = withTransaction(context.db, (tx) => {
    const txItemRepository = createItemRepository(tx)
    const txToolExecutionRepository = createToolExecutionRepository(tx)
    const txRunDependencyRepository = createRunDependencyRepository(tx)
    const eventStore = createEventStore(tx)
    const completedAt = context.services.clock.nowIso()
    const toolAppsMetaPayload = getToolAppsMetaPayload(
      context,
      toolExecution.tool,
      remoteResult.ok ? remoteResult.value : undefined,
    )
    const nextSequence = unwrapOrThrow(txItemRepository.getNextSequence(context.tenantScope, runId))

    if (!remoteResult.ok) {
      const errorEnvelope = toToolErrorOutput(remoteResult.error)

      persistFailedToolExecutionWithOutput({
        callId: runDependency.callId,
        completedAt,
        durationMs: null,
        errorText: remoteResult.error.message,
        itemId: asItemId(context.services.ids.create('itm')),
        itemRepository: txItemRepository,
        output: errorEnvelope,
        runId,
        scope: context.tenantScope,
        sequence: nextSequence,
        tool: toolExecution.tool,
        toolExecutionRepository: txToolExecutionRepository,
      })

      appendToolConfirmationGrantedEvent(context, eventStore, currentRun, {
        callId: runDependency.callId,
        ...(rememberApproval ? { fingerprint: descriptor.fingerprint } : {}),
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

      appendToolFailedEvent(context, eventStore, currentRun, {
        ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
        callId: runDependency.callId,
        error: errorEnvelope,
        tool: toolExecution.tool,
      })

      return ok(null)
    }

    persistCompletedToolExecutionWithOutput({
      callId: runDependency.callId,
      completedAt,
      durationMs: null,
      itemId: asItemId(context.services.ids.create('itm')),
      itemRepository: txItemRepository,
      output: remoteResult.value,
      runId,
      scope: context.tenantScope,
      sequence: nextSequence,
      tool: toolExecution.tool,
      toolExecutionRepository: txToolExecutionRepository,
    })

    appendToolConfirmationGrantedEvent(context, eventStore, currentRun, {
      callId: runDependency.callId,
      ...(rememberApproval ? { fingerprint: descriptor.fingerprint } : {}),
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

    appendToolCompletedEvent(context, eventStore, currentRun, {
      ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
      callId: runDependency.callId,
      outcome: remoteResult.value,
      tool: toolExecution.tool,
    })

    return ok(null)
  })

  if (!persistedRemoteResult.ok) {
    return persistedRemoteResult
  }

  return resumeOrStayWaiting(context, currentRun, runId)
}
