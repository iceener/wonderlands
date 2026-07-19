import { withTransaction } from '../../../../db/transaction'
import { asItemId } from '../../../../shared/ids'
import { err } from '../../../../shared/result'
import type { CommandResult } from '../../../commands/command-context'
import { createEventStore } from '../../../commands/event-store'
import {
  createItemRepository,
  createRunDependencyRepository,
  createToolExecutionRepository,
} from '../../../persistence/repositories'
import {
  resolveRunEventThreadId,
  unwrapOrThrow as unwrapRunEventResultOrThrow,
} from '../../run-events'
import { getToolAppsMetaPayload } from '../../tool-apps-meta'
import {
  appendToolCompletedEvent,
  appendToolFailedEvent,
  persistCompletedToolExecutionWithOutput,
  persistFailedToolExecutionWithOutput,
} from '../../tool-execution-persistence'
import { appendChildRunCompletedEvent } from './resolve-child-run-result'
import {
  type LoadedWaitResolution,
  type RunWaitResolutionState,
  resumeOrStayWaiting,
  toPersistedWaitOutput,
  toToolErrorOutput,
  toToolFailure,
} from './wait-resolution-support'

export const resolveToolResultWait = async (
  loaded: LoadedWaitResolution,
): Promise<CommandResult<RunWaitResolutionState>> => {
  const { context, currentRun, input, resolvedAt, runDependency, runId } = loaded
  const toolFailure = toToolFailure(input)

  if (input.output === undefined && !toolFailure) {
    return err({
      message: `wait ${input.waitId} requires output or errorMessage`,
      type: 'validation',
    })
  }

  withTransaction(context.db, (tx) => {
    const txItemRepository = createItemRepository(tx)
    const txToolExecutionRepository = createToolExecutionRepository(tx)
    const txRunDependencyRepository = createRunDependencyRepository(tx)
    const eventStore = createEventStore(tx)
    const toolExecution = unwrapRunEventResultOrThrow(
      txToolExecutionRepository.getById(context.tenantScope, runDependency.callId),
    )
    const toolAppsMetaPayload = getToolAppsMetaPayload(
      context,
      toolExecution.tool,
      toolFailure ? undefined : input.output,
    )
    const nextSequence = unwrapRunEventResultOrThrow(
      txItemRepository.getNextSequence(context.tenantScope, runId),
    )
    const waitResolutionStatus = input.waitResolution?.status ?? 'resolved'
    const waitResolutionJson =
      input.waitResolution?.resolutionJson ??
      (toolFailure ? { error: toolFailure.message } : { output: input.output ?? null })
    const persistedOutput = toolFailure
      ? toToolErrorOutput(toolFailure, input.output)
      : toPersistedWaitOutput(runDependency, input.output ?? null)

    if (toolFailure) {
      persistFailedToolExecutionWithOutput({
        callId: runDependency.callId,
        completedAt: resolvedAt,
        durationMs: null,
        errorText: toolFailure.message,
        itemId: asItemId(context.services.ids.create('itm')),
        itemRepository: txItemRepository,
        output: persistedOutput,
        runId,
        scope: context.tenantScope,
        sequence: nextSequence,
        tool: toolExecution.tool,
        toolExecutionRepository: txToolExecutionRepository,
      })
    } else {
      persistCompletedToolExecutionWithOutput({
        callId: runDependency.callId,
        completedAt: resolvedAt,
        durationMs: null,
        itemId: asItemId(context.services.ids.create('itm')),
        itemRepository: txItemRepository,
        output: persistedOutput,
        runId,
        scope: context.tenantScope,
        sequence: nextSequence,
        tool: toolExecution.tool,
        toolExecutionRepository: txToolExecutionRepository,
      })
    }

    unwrapRunEventResultOrThrow(
      txRunDependencyRepository.resolve(context.tenantScope, {
        id: input.waitId,
        resolutionJson: waitResolutionJson,
        resolvedAt,
        status: waitResolutionStatus,
      }),
    )

    if (waitResolutionStatus === 'timed_out') {
      unwrapRunEventResultOrThrow(
        eventStore.append({
          actorAccountId: context.tenantScope.accountId,
          aggregateId: runDependency.id,
          aggregateType: 'wait_entry',
          payload: {
            callId: runDependency.callId,
            error: toolFailure?.message ?? 'Wait timed out',
            ...(currentRun.parentRunId ? { parentRunId: currentRun.parentRunId } : {}),
            rootRunId: currentRun.rootRunId,
            runId,
            sessionId: currentRun.sessionId,
            threadId: resolveRunEventThreadId(currentRun),
            timeoutAt: runDependency.timeoutAt,
            timedOutAt: resolvedAt,
            tool: toolExecution.tool,
            waitId: input.waitId,
            waitTargetKind: runDependency.targetKind,
            waitTargetRef: runDependency.targetRef,
            ...(runDependency.targetRunId ? { waitTargetRunId: runDependency.targetRunId } : {}),
            waitType: runDependency.type,
          },
          tenantId: context.tenantScope.tenantId,
          traceId: context.traceId,
          type: 'wait.timed_out',
        }),
      )
    }

    if (toolFailure) {
      appendToolFailedEvent(context, eventStore, currentRun, {
        ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
        callId: runDependency.callId,
        error: toToolErrorOutput(toolFailure),
        tool: toolExecution.tool,
      })
    } else {
      appendToolCompletedEvent(context, eventStore, currentRun, {
        ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
        callId: runDependency.callId,
        outcome: input.output ?? null,
        tool: toolExecution.tool,
      })
    }

    if (waitResolutionStatus === 'resolved') {
      appendChildRunCompletedEvent({
        context,
        currentRun,
        eventStore,
        resolutionInput: input,
        runDependency,
      })
    }
  })

  return resumeOrStayWaiting(context, currentRun, runId)
}
