import { withTransaction } from '../../../../db/transaction'
import type { AiInteractionResponse } from '../../../../domain/ai/types'
import { createRunDependencyRepository } from '../../../../domain/runtime/run-dependency-repository'
import type { RunRecord } from '../../../../domain/runtime/run-repository'
import { createRunRepository } from '../../../../domain/runtime/run-repository'
import type { DomainError } from '../../../../shared/errors'
import { ok, type Result } from '../../../../shared/result'
import type { CommandContext } from '../../../commands/command-context'
import { createEventStore } from '../../../commands/event-store'
import { appendRunEvent, unwrapOrThrow } from '../../run-events'
import { markLinkedJobWaiting } from '../../scheduling/job-sync'
import type { WaitingRunExecutionOutput, WaitingRunPendingWait } from '../run-persistence'
import {
  buildAssistantTranscriptMetadata,
  compactRunContextAtBoundary,
  toPersistenceFailure,
} from './run-state-support'

export const markRunWaiting = (
  context: CommandContext,
  run: RunRecord,
  response: AiInteractionResponse,
  pendingWaits: WaitingRunPendingWait[],
  waitIds: string[],
): Result<WaitingRunExecutionOutput, DomainError> => {
  const now = context.services.clock.nowIso()

  try {
    return withTransaction(context.db, (tx) => {
      const runRepository = createRunRepository(tx)
      const eventStore = createEventStore(tx)
      const runDependencyRepository = createRunDependencyRepository(tx)
      const transcript = unwrapOrThrow(
        buildAssistantTranscriptMetadata(context, tx, run, response, now),
      )
      const waitingRun = unwrapOrThrow(
        runRepository.markWaiting(context.tenantScope, {
          expectedStatus: 'running',
          expectedVersion: run.version,
          lastProgressAt: now,
          resultJson: {
            model: response.model,
            outputText: response.outputText,
            pendingWaits,
            provider: response.provider,
            responseId: response.responseId,
            ...(transcript ? { transcript } : {}),
            usage: response.usage,
            waitIds,
          },
          runId: run.id,
          updatedAt: now,
        }),
      )
      const pendingWaitEntries = unwrapOrThrow(
        runDependencyRepository.listPendingByRunId(context.tenantScope, waitingRun.id),
      )
      const nextSchedulerCheckAt =
        pendingWaitEntries
          .map((wait) => wait.timeoutAt)
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .sort()[0] ?? null

      appendRunEvent(context, eventStore, waitingRun, 'run.waiting', {
        model: response.model,
        pendingWaits,
        outputText: response.outputText,
        provider: response.provider,
        responseId: response.responseId,
        usage: response.usage,
        waitIds,
      })
      unwrapOrThrow(
        markLinkedJobWaiting(tx, context.tenantScope, waitingRun, {
          eventContext: {
            eventStore,
            traceId: context.traceId,
          },
          nextSchedulerCheckAt,
          updatedAt: now,
          waitIds,
        }),
      )

      unwrapOrThrow(compactRunContextAtBoundary(context, tx, waitingRun))

      return ok({
        assistantItemId: null,
        assistantMessageId: null,
        model: response.model,
        outputText: response.outputText,
        pendingWaits,
        provider: response.provider,
        responseId: response.responseId,
        runId: run.id,
        status: 'waiting',
        usage: response.usage,
        waitIds,
      })
    })
  } catch (error) {
    return toPersistenceFailure(error, 'failed to mark run waiting')
  }
}
