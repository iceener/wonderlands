import { withTransaction } from '../../../../db/transaction'
import type { RunRecord } from '../../../../domain/runtime/run-repository'
import { createRunRepository } from '../../../../adapters/persistence/sqlite/runtime/run-repository'
import type { DomainError } from '../../../../shared/errors'
import { err, ok, type Result } from '../../../../shared/result'
import type { CommandContext } from '../../../commands/command-context'
import { createEventStore } from '../../../commands/event-store'
import { appendDomainEvent, appendRunEvent, unwrapOrThrow } from '../../run-events'
import { emitProgressReported } from '../../run-telemetry'
import { markRunJobBlocked } from '../../scheduling/job-sync'
import { persistAssistantSnapshotMessageInTransaction } from '../output/assistant-message'
import { buildRunTranscriptSnapshot, toPersistenceFailure } from './run-state-support'

export const failRun = (
  context: CommandContext,
  run: RunRecord,
  error: DomainError,
): Result<never, DomainError> => {
  const failedAt = context.services.clock.nowIso()
  let failedResult: Result<RunRecord, DomainError>

  try {
    failedResult = withTransaction(context.db, (tx) => {
      const runRepository = createRunRepository(tx)
      const eventStore = createEventStore(tx)
      const transcriptSnapshot = unwrapOrThrow(
        buildRunTranscriptSnapshot(context, tx, run, {
          createdAt: failedAt,
        }),
      )
      const snapshotOutputText =
        transcriptSnapshot.outputText.length > 0 ? transcriptSnapshot.outputText : error.message
      const assistantMessage = unwrapOrThrow(
        persistAssistantSnapshotMessageInTransaction(context, tx, run, {
          createdAt: failedAt,
          finishReason: 'error',
          outputText: snapshotOutputText,
          transcript: transcriptSnapshot.transcript,
        }),
      )

      if (assistantMessage.created && assistantMessage.assistantMessageId && run.threadId) {
        appendDomainEvent(context, eventStore, {
          aggregateId: assistantMessage.assistantMessageId,
          aggregateType: 'session_message',
          payload: {
            messageId: assistantMessage.assistantMessageId,
            runId: run.id,
            sessionId: run.sessionId,
            threadId: run.threadId,
          },
          type: 'message.posted',
        })
      }

      const failedRun = unwrapOrThrow(
        runRepository.fail(context.tenantScope, {
          completedAt: failedAt,
          errorJson: {
            ...error,
            ...(transcriptSnapshot.transcript ? { transcript: transcriptSnapshot.transcript } : {}),
            ...(snapshotOutputText.length > 0 ? { outputText: snapshotOutputText } : {}),
          },
          expectedStatus: run.status,
          expectedVersion: run.version,
          lastProgressAt: failedAt,
          resultJson:
            transcriptSnapshot.transcript || snapshotOutputText.length > 0
              ? {
                  assistantMessageId: assistantMessage.assistantMessageId,
                  ...(transcriptSnapshot.transcript
                    ? { transcript: transcriptSnapshot.transcript }
                    : {}),
                  ...(snapshotOutputText.length > 0 ? { outputText: snapshotOutputText } : {}),
                }
              : null,
          runId: run.id,
          turnCount: run.turnCount,
          updatedAt: failedAt,
        }),
      )

      appendRunEvent(context, eventStore, failedRun, 'run.failed', {
        assistantMessageId: assistantMessage.assistantMessageId,
        error,
        ...(snapshotOutputText.length > 0 ? { outputText: snapshotOutputText } : {}),
      })
      unwrapOrThrow(
        markRunJobBlocked(tx, context.tenantScope, failedRun, {
          error,
          eventContext: {
            eventStore,
            traceId: context.traceId,
          },
          updatedAt: failedAt,
        }),
      )
      emitProgressReported(context, tx, failedRun, {
        detail: error.message,
        percent: 100,
        stage: 'run.failed',
        turn: failedRun.turnCount,
      })

      return ok(failedRun)
    })
  } catch (caughtError) {
    return toPersistenceFailure(caughtError, 'failed to mark run failed')
  }

  if (!failedResult.ok) {
    return failedResult
  }

  return err(error)
}
