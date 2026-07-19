import type { DomainError } from '../../shared/errors'
import type { asEventId, asTenantId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { DomainEventEnvelope } from './domain-event'

export interface EventOutboxRecord {
  attempts: number
  availableAt: string
  createdAt: string
  event: DomainEventEnvelope<unknown> & { eventNo: number }
  eventId: ReturnType<typeof asEventId>
  id: string
  lastError: string | null
  processedAt: string | null
  status: 'pending' | 'processing' | 'delivered' | 'failed' | 'quarantined'
  tenantId: ReturnType<typeof asTenantId> | undefined
  topic: string
}

export interface EventOutboxBacklogTopicStats {
  failedCount: number
  oldestFailedAvailableAt: string | null
  oldestFailedCreatedAt: string | null
  oldestPendingAvailableAt: string | null
  oldestPendingCreatedAt: string | null
  oldestProcessingCreatedAt: string | null
  pendingCount: number
  processingCount: number
  topic: string
}

export interface EventOutboxQuarantineTopicStats {
  oldestQuarantinedAt: string | null
  quarantinedCount: number
  topic: string
}

export interface EventOutboxRetryBucket {
  attempts: number
  count: number
  topic: string
}

export interface EventOutboxBacklogSnapshot {
  retryBuckets: EventOutboxRetryBucket[]
  topics: EventOutboxBacklogTopicStats[]
}

export interface EventOutboxReplayRecord {
  id: string
  status: 'pending' | 'processing'
  topic: string
}

export interface EnqueueReplayInput {
  availableAt: string
  eventId: string
  tenantId?: TenantId
  topic: string
}

export interface ClaimNextEventOutboxFilters {
  excludeTopics?: readonly string[]
  includeTopics?: readonly string[]
}

export interface CompleteEventOutboxInput {
  id: string
  processedAt: string
}

export interface RetryEventOutboxInput {
  availableAt: string
  id: string
  lastError: string
}

export interface RecoverProcessingEventOutboxInput {
  availableAt: string
  lastError: string
}

export interface QuarantineEventOutboxInput {
  id: string
  lastError: string
  processedAt: string
}

export interface GetQuarantinedEventOutboxByIdInput {
  id: string
  tenantId?: TenantId
}

export interface ListQuarantinedEventOutboxInput {
  includeTopics?: readonly string[]
  tenantId?: TenantId
}

export interface ReplayQuarantinedEventOutboxInput {
  availableAt: string
  id: string
  tenantId?: TenantId
}

export interface InspectEventOutboxBacklogInput {
  includeTopics?: readonly string[]
  tenantId?: TenantId
}

export interface InspectEventOutboxQuarantineInput {
  includeTopics?: readonly string[]
  tenantId?: TenantId
}

/**
 * Persistence-neutral port for the event outbox (transactional delivery
 * queue for domain events). Concrete implementations (e.g. the
 * Drizzle/SQLite adapter) live under `adapters/persistence/sqlite/`. This
 * module must not import anything from `db`, `drizzle-orm`, `application`,
 * or `adapters` -- see `test/architecture-guardrails.test.ts`.
 */
export interface EventOutboxRepository {
  enqueueReplay: (input: EnqueueReplayInput) => Result<EventOutboxReplayRecord, DomainError>
  claimNext: (
    now: string,
    filters?: ClaimNextEventOutboxFilters,
  ) => Result<EventOutboxRecord | null, DomainError>
  complete: (input: CompleteEventOutboxInput) => Result<null, DomainError>
  retry: (input: RetryEventOutboxInput) => Result<null, DomainError>
  recoverProcessing: (input: RecoverProcessingEventOutboxInput) => Result<number, DomainError>
  quarantine: (input: QuarantineEventOutboxInput) => Result<null, DomainError>
  getQuarantinedById: (
    input: GetQuarantinedEventOutboxByIdInput,
  ) => Result<EventOutboxRecord | null, DomainError>
  listQuarantined: (
    input?: ListQuarantinedEventOutboxInput,
  ) => Result<EventOutboxRecord[], DomainError>
  replayQuarantined: (input: ReplayQuarantinedEventOutboxInput) => Result<null, DomainError>
  inspectBacklog: (
    input?: InspectEventOutboxBacklogInput,
  ) => Result<EventOutboxBacklogSnapshot, DomainError>
  inspectQuarantine: (
    input?: InspectEventOutboxQuarantineInput,
  ) => Result<EventOutboxQuarantineTopicStats[], DomainError>
}
