import { withTransaction } from '../../../../db/transaction'
import { createItemRepository } from '../../../persistence/repositories'
import { createRunDependencyRepository } from '../../../persistence/repositories'
import { createToolExecutionRepository } from '../../../persistence/repositories'
import { asItemId } from '../../../../shared/ids'
import { err, ok } from '../../../../shared/result'
import type { CommandResult } from '../../../commands/command-context'
import { createEventStore } from '../../../commands/event-store'
import { executeOneToolCall } from '../../execution/run-tool-execution'
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

const rejectionMessage = 'Execute rejected because delete write-back confirmation was denied'

export const resolveExecuteSandboxDeleteConfirmationWait = async (
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

  const rerun = await executeOneToolCall(
    context,
    currentRun,
    {
      call: {
        arguments:
          toolExecution.argsJson && typeof toolExecution.argsJson === 'object'
            ? toolExecution.argsJson
            : {},
        argumentsJson: JSON.stringify(toolExecution.argsJson ?? null),
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
      sandboxDeleteWritebackApproved: true,
    },
  )

  if (!rerun.error && !rerun.outcome) {
    return err({
      message: `execute delete confirmation rerun produced no outcome for tool call ${runDependency.callId}`,
      type: 'conflict',
    })
  }

  const rerunOutcome = rerun.outcome
  const persisted = withTransaction(context.db, (tx) => {
    const txItemRepository = createItemRepository(tx)
    const txToolExecutionRepository = createToolExecutionRepository(tx)
    const txRunDependencyRepository = createRunDependencyRepository(tx)
    const eventStore = createEventStore(tx)
    const completedAt = context.services.clock.nowIso()

    appendToolConfirmationGrantedEvent(context, eventStore, currentRun, {
      callId: runDependency.callId,
      tool: toolExecution.tool,
      waitId: input.waitId,
    })

    unwrapOrThrow(
      txRunDependencyRepository.resolve(context.tenantScope, {
        id: input.waitId,
        resolutionJson: {
          approved: true,
        },
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
        `execute delete confirmation rerun produced an unsupported outcome for tool call ${runDependency.callId}`,
      )
    }

    const newWaitId = context.services.ids.create('wte')
    const args =
      toolExecution.argsJson && typeof toolExecution.argsJson === 'object'
        ? toolExecution.argsJson
        : {}

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
