import { withTransaction } from '../../../db/transaction'
import type { ContextSummaryRecord } from '../../../domain/runtime/context-summary-repository'
import type { RunRecord } from '../../../domain/runtime/run-repository'
import type { CommandContext } from '../../commands/command-context'
import { resolveWritableMemoryScope } from '../../memory/memory-scope'
import { estimateObservationTokenCount, observeSummary } from '../../memory/observe-summary'
import { createMemoryRecordRepository } from '../../persistence/repositories'
import { emitProgressReported, tryAppendRunTelemetryEvent } from '../../runtime/run-telemetry'

/**
 * Attempts the legacy observation lifecycle work. Observer and persistence failures remain
 * best-effort, matching the compatibility loader's existing semantics.
 */
export const ensureLatestSummaryObserved = async (
  context: CommandContext,
  run: RunRecord,
  summary: ContextSummaryRecord | null,
): Promise<void> => {
  if (!summary || !run.threadId) {
    return
  }

  const threadId = run.threadId
  const writableScope = resolveWritableMemoryScope(run)
  const memoryRepository = createMemoryRecordRepository(context.db)
  const hasObservation = memoryRepository.hasObservationForSummary(context.tenantScope, summary.id)

  if (!hasObservation.ok || hasObservation.value) {
    return
  }

  tryAppendRunTelemetryEvent(context, context.db, run, 'memory.observation.started', {
    summaryId: summary.id,
  })
  const observed = await observeSummary(context, run, summary)

  if (!observed.ok || !observed.value) {
    return
  }

  const observationContent = observed.value
  const observationTokenCount = estimateObservationTokenCount(observationContent)

  withTransaction(context.db, (tx) => {
    const txMemoryRepository = createMemoryRecordRepository(tx)
    const recordId = context.services.ids.create('mrec')

    const createdObservation = txMemoryRepository.createObservationForSummary(context.tenantScope, {
      content: observationContent,
      createdAt: context.services.clock.nowIso(),
      fromSequence: summary.fromSequence,
      id: recordId,
      ownerRunId: run.id,
      rootRunId: run.rootRunId,
      scopeKind: writableScope.scopeKind,
      scopeRef: writableScope.scopeRef,
      sessionId: run.sessionId,
      sourceId: context.services.ids.create('msrc'),
      sourceRunId: run.id,
      sourceSummaryId: summary.id,
      threadId,
      throughSequence: summary.throughSequence,
      tokenCount: observationTokenCount,
    })

    if (!createdObservation.ok) {
      return
    }

    tryAppendRunTelemetryEvent(context, tx, run, 'memory.observation.completed', {
      memoryRecordId: recordId,
      observationCount: observationContent.observations.length,
      source: observationContent.source,
      summaryId: summary.id,
      tokenCount: observationTokenCount,
    })
  })
  emitProgressReported(context, context.db, run, {
    detail: `Stored ${observationContent.observations.length} durable observation${observationContent.observations.length === 1 ? '' : 's'}`,
    percent: 8,
    stage: 'memory.observation.completed',
    turn: run.turnCount + 1,
  })
}
