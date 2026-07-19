import { createDomainEventRepository } from '../../../../persistence/sqlite/events/domain-event-repository'
import { createRunRepository } from '../../../../persistence/sqlite/runtime/run-repository'
import type { RepositoryDatabase } from '../../../../persistence/sqlite/repository-database'
import type { EventOutboxRecord } from '../../../../../domain/events/event-outbox-repository'
import type { RunRecord } from '../../../../../domain/runtime/run-repository'
import type { DomainError } from '../../../../../shared/errors'
import { asRunId } from '../../../../../shared/ids'
import type { AppLogger } from '../../../../../shared/logger'
import { err, ok, type Result } from '../../../../../shared/result'
import { toRootTraceMetadata, toRootTraceName, toRootTraceTags } from '../metadata/trace-metadata'
import { asString, toEventPayload } from '../normalization'
import type { ExportTrace } from '../types'
import {
  findRunLifecycleEvent,
  pickLatestEvent,
  toRelevantRunEvents,
  toRunScope,
} from './run-events'
import { buildRunSnapshot } from './run-snapshot'
import { buildRunTree } from './run-tree'

export const loadTraceSnapshot = (
  db: RepositoryDatabase,
  entry: EventOutboxRecord,
  logger: AppLogger,
): Result<ExportTrace, DomainError> => {
  const scope = toRunScope(entry)

  if (!scope) {
    return err({
      message: 'Langfuse export requires an outbox entry with tenant scope',
      type: 'validation',
    })
  }

  const payload = toEventPayload(entry.event)
  const rootRunId = asString(payload?.rootRunId) ?? asString(payload?.runId)

  if (!rootRunId) {
    return err({
      message: 'Langfuse export requires a root run id',
      type: 'validation',
    })
  }

  const runRepository = createRunRepository(db)
  const rootRun = runRepository.getById(scope, asRunId(rootRunId))

  if (!rootRun.ok) {
    return rootRun
  }

  const runTree = buildRunTree(runRepository, scope, rootRun.value)

  if (!runTree.ok) {
    return runTree
  }

  const runIds = new Set(runTree.value.map((run) => String(run.id)))
  const childRunsByParentId = new Map<string, RunRecord[]>()

  for (const run of runTree.value) {
    if (!run.parentRunId) {
      continue
    }

    const parentRunId = String(run.parentRunId)
    const current = childRunsByParentId.get(parentRunId) ?? []
    current.push(run)
    childRunsByParentId.set(parentRunId, current)
  }

  const eventRepository = createDomainEventRepository(db)
  const sessionEvents = eventRepository.listAfterCursor(scope, {
    category: 'all',
    sessionId: rootRun.value.sessionId,
  })

  if (!sessionEvents.ok) {
    return sessionEvents
  }

  const relevantEvents = sessionEvents.value.filter((event) => {
    const eventPayload = toEventPayload(event)
    const payloadRootRunId = asString(eventPayload?.rootRunId)
    const payloadRunId = asString(eventPayload?.runId)

    return (
      payloadRootRunId === rootRun.value.id ||
      (payloadRunId !== null && runIds.has(payloadRunId)) ||
      (event.aggregateType === 'run' && runIds.has(event.aggregateId))
    )
  })

  if (relevantEvents.length === 0) {
    logger.warn('No persisted run events were found for Langfuse export', {
      rootRunId: rootRun.value.id,
    })
  }

  const rootRunEvents = toRelevantRunEvents(relevantEvents, rootRun.value.id)
  const rootRunCreated = findRunLifecycleEvent(rootRunEvents, 'run.created')
  const rootTerminalEvent =
    pickLatestEvent(rootRunEvents, 'run.completed') ??
    pickLatestEvent(rootRunEvents, 'run.failed') ??
    pickLatestEvent(rootRunEvents, 'run.waiting')
  const rootCreatedPayload = rootRunCreated ? toEventPayload(rootRunCreated) : null
  const rootTerminalPayload = rootTerminalEvent ? toEventPayload(rootTerminalEvent) : null
  const rootRunSnapshot = buildRunSnapshot({
    childRunsByParentId,
    events: relevantEvents,
    run: rootRun.value,
  })

  return ok({
    metadata: toRootTraceMetadata({
      createdPayload: rootCreatedPayload,
      run: rootRun.value,
      terminalPayload: rootTerminalPayload,
    }),
    name: toRootTraceName({
      createdPayload: rootCreatedPayload,
      rootRun: rootRun.value,
      rootRunName: rootRunSnapshot.name,
    }),
    rootRun: rootRunSnapshot,
    sessionId: rootRun.value.threadId ?? rootRun.value.sessionId,
    tags: toRootTraceTags({
      createdPayload: rootCreatedPayload,
      rootRun: rootRun.value,
      terminalPayload: rootTerminalPayload,
    }),
    traceKey: rootRun.value.id,
    userId: rootRun.value.actorAccountId ?? undefined,
  })
}
