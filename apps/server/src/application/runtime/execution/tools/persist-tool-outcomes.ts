import { withTransaction } from '../../../../db/transaction'
import { createItemRepository } from '../../../persistence/repositories'
import { createRunDependencyRepository } from '../../../persistence/repositories'
import type { RunRecord } from '../../../../domain/runtime/run-repository'
import { createToolExecutionRepository } from '../../../persistence/repositories'
import { type DomainError, DomainErrorException } from '../../../../shared/errors'
import { asItemId } from '../../../../shared/ids'
import { ok, type Result } from '../../../../shared/result'
import type { CommandContext } from '../../../commands/command-context'
import { createEventStore } from '../../../commands/event-store'
import { assertRunSnapshotCurrent } from '../../run-concurrency'
import { appendDomainEvent, unwrapOrThrow } from '../../run-events'
import { getToolAppsMetaPayload } from '../../tool-apps-meta'
import {
  appendToolCompletedEvent,
  appendToolFailedEvent,
  persistCompletedToolExecutionWithOutput,
  persistFailedToolExecutionWithOutput,
  toToolArgs,
  toToolErrorOutput,
  toToolExecutionEventPayload,
} from '../../tool-execution-persistence'
import { requiresConfirmationForToolWait } from '../../waits/tool-confirmation'
import type { PendingRunWaitSummary, ToolExecutionResult } from './tool-execution-types'

const toDurationMs = (startedAt: string, completedAt: string): number | null => {
  const start = Date.parse(startedAt)
  const end = Date.parse(completedAt)

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null
  }

  return Math.max(0, end - start)
}

export const persistToolCalledEvents = (
  context: CommandContext,
  run: RunRecord,
  toolCalls: ToolExecutionResult[],
  turn: number,
): Result<null, DomainError> => {
  try {
    return withTransaction(context.db, (tx) => {
      unwrapOrThrow(assertRunSnapshotCurrent(tx, context.tenantScope, run))

      const eventStore = createEventStore(tx)
      const toolExecutionRepository = createToolExecutionRepository(tx)

      for (const toolCall of toolCalls) {
        const toolAppsMetaPayload = getToolAppsMetaPayload(context, toolCall.toolName)

        unwrapOrThrow(
          toolExecutionRepository.create(context.tenantScope, {
            argsJson: toolCall.call.arguments ?? null,
            createdAt: toolCall.startedAt,
            domain: toolCall.domain,
            id: toolCall.call.callId,
            runId: run.id,
            startedAt: toolCall.startedAt,
            tool: toolCall.toolName,
          }),
        )

        appendDomainEvent(context, eventStore, {
          aggregateId: toolCall.call.callId,
          aggregateType: 'tool_execution',
          payload: toToolExecutionEventPayload(
            run,
            {
              callId: toolCall.call.callId,
              tool: toolCall.toolName,
            },
            {
              ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
              args: toToolArgs(toolCall.call.arguments),
              turn,
            },
          ),
          type: 'tool.called',
        })
      }

      return ok(null)
    })
  } catch (error) {
    if (error instanceof DomainErrorException) {
      return {
        error: error.domainError,
        ok: false,
      }
    }

    return {
      error: {
        message: error instanceof Error ? error.message : 'failed to persist tool call events',
        type: 'conflict',
      },
      ok: false,
    }
  }
}

export const persistToolOutcomes = (
  context: CommandContext,
  run: RunRecord,
  toolCalls: ToolExecutionResult[],
  turn: number,
): Result<{ waitIds: string[]; waits: PendingRunWaitSummary[] }, DomainError> => {
  try {
    return withTransaction(context.db, (tx) => {
      unwrapOrThrow(assertRunSnapshotCurrent(tx, context.tenantScope, run))

      const eventStore = createEventStore(tx)
      const itemRepository = createItemRepository(tx)
      const toolExecutionRepository = createToolExecutionRepository(tx)
      const runDependencyRepository = createRunDependencyRepository(tx)
      let nextSequence = unwrapOrThrow(itemRepository.getNextSequence(context.tenantScope, run.id))
      const waitIds: string[] = []
      const waits: PendingRunWaitSummary[] = []

      for (const result of toolCalls) {
        const completedAt = context.services.clock.nowIso()
        const toolAppsMetaPayload =
          result.error || !result.outcome || result.outcome.kind !== 'immediate'
            ? getToolAppsMetaPayload(context, result.toolName)
            : getToolAppsMetaPayload(context, result.toolName, result.outcome.output)

        if (result.error) {
          const errorOutput = toToolErrorOutput(result.error)

          persistFailedToolExecutionWithOutput({
            callId: result.call.callId,
            completedAt,
            durationMs: toDurationMs(result.startedAt, completedAt),
            errorText: result.error.message,
            itemId: asItemId(context.services.ids.create('itm')),
            itemRepository,
            output: errorOutput,
            runId: run.id,
            scope: context.tenantScope,
            sequence: nextSequence,
            tool: result.toolName,
            toolExecutionRepository,
          })
          nextSequence += 1

          appendToolFailedEvent(context, eventStore, run, {
            ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
            callId: result.call.callId,
            error: errorOutput,
            tool: result.toolName,
            turn,
          })
          continue
        }

        if (!result.outcome) {
          continue
        }

        if (result.outcome.kind === 'waiting') {
          const waitId = context.services.ids.create('wte')
          unwrapOrThrow(
            runDependencyRepository.create(context.tenantScope, {
              callId: result.call.callId,
              createdAt: completedAt,
              description: result.outcome.wait.description ?? null,
              id: waitId,
              runId: run.id,
              targetKind: result.outcome.wait.targetKind,
              targetRef: result.outcome.wait.targetRef ?? result.toolName,
              targetRunId: result.outcome.wait.targetRunId ?? null,
              timeoutAt: result.outcome.wait.timeoutAt ?? null,
              type: result.outcome.wait.type,
            }),
          )
          waitIds.push(waitId)
          waits.push({
            args: toToolArgs(result.call.arguments),
            callId: result.call.callId,
            createdAt: completedAt,
            description: result.outcome.wait.description ?? null,
            requiresApproval: requiresConfirmationForToolWait(result.outcome.wait, {
              domain: result.domain,
              tool: result.toolName,
            }),
            targetKind: result.outcome.wait.targetKind,
            targetRef: result.outcome.wait.targetRef ?? result.toolName,
            tool: result.toolName,
            type: result.outcome.wait.type,
            waitId,
          })

          appendDomainEvent(context, eventStore, {
            aggregateId: result.call.callId,
            aggregateType: 'tool_execution',
            payload: toToolExecutionEventPayload(
              run,
              {
                callId: result.call.callId,
                tool: result.toolName,
              },
              {
                args: toToolArgs(result.call.arguments),
                description: result.outcome.wait.description ?? null,
                turn,
                waitId,
                waitTargetKind: result.outcome.wait.targetKind,
                waitTargetRef: result.outcome.wait.targetRef ?? result.toolName,
                ...(result.outcome.wait.targetRunId
                  ? { waitTargetRunId: result.outcome.wait.targetRunId }
                  : {}),
                waitType: result.outcome.wait.type,
              },
            ),
            type: requiresConfirmationForToolWait(result.outcome.wait, {
              domain: result.domain,
              tool: result.toolName,
            })
              ? 'tool.confirmation_requested'
              : 'tool.waiting',
          })
          continue
        }

        persistCompletedToolExecutionWithOutput({
          callId: result.call.callId,
          completedAt,
          durationMs: toDurationMs(result.startedAt, completedAt),
          itemId: asItemId(context.services.ids.create('itm')),
          itemRepository,
          output: result.outcome.output,
          runId: run.id,
          scope: context.tenantScope,
          sequence: nextSequence,
          tool: result.toolName,
          toolExecutionRepository,
        })
        nextSequence += 1

        appendToolCompletedEvent(context, eventStore, run, {
          ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
          callId: result.call.callId,
          outcome: result.outcome.output,
          tool: result.toolName,
          turn,
        })
      }

      return ok({ waitIds, waits })
    })
  } catch (error) {
    if (error instanceof DomainErrorException) {
      return {
        error: error.domainError,
        ok: false,
      }
    }

    return {
      error: {
        message: error instanceof Error ? error.message : 'failed to persist tool outcomes',
        type: 'conflict',
      },
      ok: false,
    }
  }
}
