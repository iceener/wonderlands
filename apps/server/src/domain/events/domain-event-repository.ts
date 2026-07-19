import type { DomainError } from '../../shared/errors'
import type { AccountId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { EventOutboxTopic } from './committed-event-contract'
import type { DomainEventCategory, DomainEventEnvelope } from './domain-event'

export interface ListDomainEventsInput {
  category?: DomainEventCategory | 'all'
  cursor?: number
  limit?: number
  runId?: string
  sessionId?: string
  threadId?: string
}

export interface AppendDomainEventRecordInput {
  actorAccountId?: AccountId
  aggregateId: string
  aggregateType: string
  category: DomainEventCategory
  causationId?: string
  createdAt: string
  id: string
  outboxTopics: EventOutboxTopic[]
  primaryPayload: unknown
  sidecarPayload: Record<string, unknown> | null
  tenantId?: TenantId
  traceId?: string
  type: string
}

/**
 * Persistence-neutral port for domain event storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface DomainEventRepository {
  append: (
    input: AppendDomainEventRecordInput,
  ) => Result<DomainEventEnvelope<unknown>, DomainError>
  listAfterCursor: (
    scope: TenantScope,
    input: ListDomainEventsInput,
  ) => Result<Array<DomainEventEnvelope<unknown> & { eventNo: number }>, DomainError>
}
