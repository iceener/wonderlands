import { createWorkSessionRepository } from '../persistence/repositories'
import type { RepositoryDatabase } from '../../db/repository-database'
import type { DomainEventEnvelope } from '../../domain/events/domain-event'
import { createDomainEventRepository } from '../persistence/repositories'
import { createEventOutboxRepository } from '../persistence/repositories'
import { createRunRepository } from '../persistence/repositories'
import type { DomainError } from '../../shared/errors'
import { asRunId, asWorkSessionId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export interface ObservabilityReplayEntry {
  eventId: string
  outboxId: string
  rootRunId: string
  status: 'pending' | 'processing'
  topic: 'observability'
}

export interface ObservabilityReplayRunResult extends ObservabilityReplayEntry {
  replayedAt: string
  requestedRunId: string
}

export interface ObservabilityReplaySessionResult {
  entries: ObservabilityReplayEntry[]
  replayedAt: string
  sessionId: string
  total: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null

const findTerminalRootRunId = (
  event: DomainEventEnvelope<unknown> & { eventNo: number },
): string | null => {
  if (event.type !== 'run.completed' && event.type !== 'run.failed') {
    return null
  }

  if (!isRecord(event.payload)) {
    return null
  }

  const runId = asString(event.payload.runId)
  const rootRunId = asString(event.payload.rootRunId) ?? runId

  return runId && rootRunId && runId === rootRunId ? rootRunId : null
}

const collectLatestTerminalRootRunEvents = (
  events: readonly (DomainEventEnvelope<unknown> & { eventNo: number })[],
): Array<{
  event: DomainEventEnvelope<unknown> & { eventNo: number }
  rootRunId: string
}> => {
  const byRootRunId = new Map<string, DomainEventEnvelope<unknown> & { eventNo: number }>()

  for (const event of events) {
    const rootRunId = findTerminalRootRunId(event)

    if (!rootRunId) {
      continue
    }

    const current = byRootRunId.get(rootRunId)

    if (!current || event.eventNo > current.eventNo) {
      byRootRunId.set(rootRunId, event)
    }
  }

  return [...byRootRunId.entries()]
    .map(([rootRunId, event]) => ({ event, rootRunId }))
    .sort((left, right) => left.event.eventNo - right.event.eventNo)
}

const enqueueReplayEntries = (input: {
  db: RepositoryDatabase
  replayedAt: string
  roots: Array<{
    event: DomainEventEnvelope<unknown> & { eventNo: number }
    rootRunId: string
  }>
  tenantScope: TenantScope
}): Result<ObservabilityReplayEntry[], DomainError> => {
  const repository = createEventOutboxRepository(input.db)
  const entries: ObservabilityReplayEntry[] = []

  for (const root of input.roots) {
    const queued = repository.enqueueReplay({
      availableAt: input.replayedAt,
      eventId: root.event.id,
      tenantId: input.tenantScope.tenantId,
      topic: 'observability',
    })

    if (!queued.ok) {
      return queued
    }

    entries.push({
      eventId: root.event.id,
      outboxId: queued.value.id,
      rootRunId: root.rootRunId,
      status: queued.value.status,
      topic: 'observability',
    })
  }

  return ok(entries)
}

export const replayObservabilityRun = (input: {
  db: RepositoryDatabase
  replayedAt: string
  runId: string
  tenantScope: TenantScope
}): Result<ObservabilityReplayRunResult, DomainError> => {
  const runRepository = createRunRepository(input.db)
  const run = runRepository.getById(input.tenantScope, asRunId(input.runId))

  if (!run.ok) {
    return run
  }

  const rootRunId = String(run.value.rootRunId ?? run.value.id)
  const events = createDomainEventRepository(input.db).listAfterCursor(input.tenantScope, {
    category: 'all',
    runId: rootRunId,
  })

  if (!events.ok) {
    return events
  }

  const match = collectLatestTerminalRootRunEvents(events.value).find(
    (entry) => entry.rootRunId === rootRunId,
  )

  if (!match) {
    return err({
      message: `run ${input.runId} has no terminal root-run event available for observability replay`,
      type: 'conflict',
    })
  }

  const replayed = enqueueReplayEntries({
    db: input.db,
    replayedAt: input.replayedAt,
    roots: [match],
    tenantScope: input.tenantScope,
  })

  if (!replayed.ok) {
    return replayed
  }

  return ok({
    ...replayed.value[0]!,
    replayedAt: input.replayedAt,
    requestedRunId: input.runId,
  })
}

export const replayObservabilitySession = (input: {
  db: RepositoryDatabase
  replayedAt: string
  sessionId: string
  tenantScope: TenantScope
}): Result<ObservabilityReplaySessionResult, DomainError> => {
  const sessionRepository = createWorkSessionRepository(input.db)
  const session = sessionRepository.getById(input.tenantScope, asWorkSessionId(input.sessionId))

  if (!session.ok) {
    return session
  }

  const events = createDomainEventRepository(input.db).listAfterCursor(input.tenantScope, {
    category: 'all',
    sessionId: input.sessionId,
  })

  if (!events.ok) {
    return events
  }

  const roots = collectLatestTerminalRootRunEvents(events.value)

  if (roots.length === 0) {
    return err({
      message: `session ${input.sessionId} has no terminal root-run events available for observability replay`,
      type: 'conflict',
    })
  }

  const replayed = enqueueReplayEntries({
    db: input.db,
    replayedAt: input.replayedAt,
    roots,
    tenantScope: input.tenantScope,
  })

  if (!replayed.ok) {
    return replayed
  }

  return ok({
    entries: replayed.value,
    replayedAt: input.replayedAt,
    sessionId: session.value.id,
    total: replayed.value.length,
  })
}
