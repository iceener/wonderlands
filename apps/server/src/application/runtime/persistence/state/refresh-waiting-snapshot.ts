import { withTransaction } from '../../../../db/transaction'
import { createRunDependencyRepository } from '../../../persistence/repositories'
import type { RunRecord } from '../../../../domain/runtime/run-repository'
import { createRunRepository } from '../../../persistence/repositories'
import type { DomainError } from '../../../../shared/errors'
import { ok, type Result } from '../../../../shared/result'
import type { CommandContext } from '../../../commands/command-context'
import { createEventStore } from '../../../commands/event-store'
import { appendRunEvent, unwrapOrThrow } from '../../run-events'
import { markLinkedJobWaiting } from '../../scheduling/job-sync'
import type { WaitingRunExecutionOutput, WaitingRunPendingWait } from '../run-persistence'
import {
  buildAssistantTranscriptMetadata,
  isAiProviderName,
  isRecord,
  readRunOutputText,
  toPersistenceFailure,
} from './run-state-support'

export const refreshWaitingRunSnapshot = (
  context: CommandContext,
  run: RunRecord,
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
        buildAssistantTranscriptMetadata(context, tx, run, null, now),
      )
      const currentSnapshot = isRecord(run.resultJson) ? run.resultJson : {}
      const refreshedRun = unwrapOrThrow(
        runRepository.refreshWaiting(context.tenantScope, {
          expectedStatus: 'waiting',
          expectedVersion: run.version,
          lastProgressAt: now,
          resultJson: {
            ...currentSnapshot,
            outputText: readRunOutputText(run),
            pendingWaits,
            ...(transcript ? { transcript } : {}),
            waitIds,
          },
          runId: run.id,
          updatedAt: now,
        }),
      )
      const pendingWaitEntries = unwrapOrThrow(
        runDependencyRepository.listPendingByRunId(context.tenantScope, refreshedRun.id),
      )
      const nextSchedulerCheckAt =
        pendingWaitEntries
          .map((wait) => wait.timeoutAt)
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .sort()[0] ?? null

      appendRunEvent(context, eventStore, refreshedRun, 'run.waiting', {
        model:
          typeof currentSnapshot.model === 'string' && currentSnapshot.model.length > 0
            ? currentSnapshot.model
            : null,
        pendingWaits,
        outputText: readRunOutputText(refreshedRun),
        provider: isAiProviderName(currentSnapshot.provider) ? currentSnapshot.provider : null,
        responseId:
          typeof currentSnapshot.responseId === 'string' ? currentSnapshot.responseId : null,
        usage: currentSnapshot.usage ?? null,
        waitIds,
      })
      unwrapOrThrow(
        markLinkedJobWaiting(tx, context.tenantScope, refreshedRun, {
          nextSchedulerCheckAt,
          updatedAt: now,
          waitIds,
        }),
      )

      return ok({
        assistantItemId: null,
        assistantMessageId: null,
        model:
          typeof currentSnapshot.model === 'string' && currentSnapshot.model.length > 0
            ? currentSnapshot.model
            : context.config.ai.defaults.model,
        outputText: readRunOutputText(refreshedRun),
        pendingWaits,
        provider: isAiProviderName(currentSnapshot.provider)
          ? currentSnapshot.provider
          : context.config.ai.defaults.provider,
        responseId:
          typeof currentSnapshot.responseId === 'string' ? currentSnapshot.responseId : null,
        runId: refreshedRun.id,
        status: 'waiting',
        usage: null,
        waitIds,
      })
    })
  } catch (error) {
    return toPersistenceFailure(error, 'failed to refresh waiting run snapshot')
  }
}
