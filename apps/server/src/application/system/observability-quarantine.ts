import type { RepositoryDatabase } from '../../db/repository-database'
import type { EventOutboxRecord } from '../../domain/events/event-outbox-repository'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { createEventOutboxRepository } from '../persistence/repositories'

interface ObservabilityQuarantinePayloadIdentity {
  rootRunId?: string
  runId?: string
  sessionId?: string
  threadId?: string
}

export interface ObservabilityQuarantineEntry {
  attempts: number
  availableAt: string
  createdAt: string
  event: {
    aggregateId: string
    aggregateType: string
    createdAt: string
    eventNo: number
    id: string
    traceId?: string
    type: string
  }
  lastError: string | null
  outboxId: string
  payloadIdentity: ObservabilityQuarantinePayloadIdentity
  quarantinedAt: string | null
  topic: string
}

export interface ObservabilityQuarantineList {
  entries: ObservabilityQuarantineEntry[]
  total: number
}

export interface ObservabilityQuarantineReplayResult {
  eventId: string
  outboxId: string
  replayedAt: string
  status: 'pending'
  topic: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined

const toPayloadIdentity = (payload: unknown): ObservabilityQuarantinePayloadIdentity => {
  if (!isRecord(payload)) {
    return {}
  }

  const rootRunId = asString(payload.rootRunId)
  const runId = asString(payload.runId)
  const sessionId = asString(payload.sessionId)
  const threadId = asString(payload.threadId)

  return {
    ...(rootRunId ? { rootRunId } : {}),
    ...(runId ? { runId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(threadId ? { threadId } : {}),
  }
}

const toQuarantineEntry = (entry: EventOutboxRecord): ObservabilityQuarantineEntry => ({
  attempts: entry.attempts,
  availableAt: entry.availableAt,
  createdAt: entry.createdAt,
  event: {
    aggregateId: entry.event.aggregateId,
    aggregateType: entry.event.aggregateType,
    createdAt: entry.event.createdAt,
    eventNo: entry.event.eventNo,
    id: entry.event.id,
    ...(entry.event.traceId ? { traceId: entry.event.traceId } : {}),
    type: entry.event.type,
  },
  lastError: entry.lastError,
  outboxId: entry.id,
  payloadIdentity: toPayloadIdentity(entry.event.payload),
  quarantinedAt: entry.processedAt,
  topic: entry.topic,
})

export const listObservabilityQuarantine = (input: {
  db: RepositoryDatabase
  tenantScope: TenantScope
}): Result<ObservabilityQuarantineList, DomainError> => {
  const quarantined = createEventOutboxRepository(input.db).listQuarantined({
    includeTopics: ['observability'],
    tenantId: input.tenantScope.tenantId,
  })

  if (!quarantined.ok) {
    return quarantined
  }

  return ok({
    entries: quarantined.value.map(toQuarantineEntry),
    total: quarantined.value.length,
  })
}

export const replayObservabilityQuarantineEntry = (input: {
  db: RepositoryDatabase
  outboxId: string
  replayedAt: string
  tenantScope: TenantScope
}): Result<ObservabilityQuarantineReplayResult, DomainError> => {
  const repository = createEventOutboxRepository(input.db)
  const current = repository.getQuarantinedById({
    id: input.outboxId,
    tenantId: input.tenantScope.tenantId,
  })

  if (!current.ok) {
    return current
  }

  if (!current.value || current.value.topic !== 'observability') {
    return err({
      message: `quarantined observability outbox entry ${input.outboxId} was not found`,
      type: 'not_found',
    })
  }

  const replayed = repository.replayQuarantined({
    availableAt: input.replayedAt,
    id: input.outboxId,
    tenantId: input.tenantScope.tenantId,
  })

  if (!replayed.ok) {
    return replayed
  }

  return ok({
    eventId: current.value.eventId,
    outboxId: input.outboxId,
    replayedAt: input.replayedAt,
    status: 'pending',
    topic: current.value.topic,
  })
}
