import type { DomainError } from '../../shared/errors'
import type { AccountId, RunId, SessionThreadId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export interface ThreadActivitySeenRecord {
  accountId: AccountId
  seenCompletedAt: string
  seenCompletedRunId: RunId
  tenantId: TenantId
  threadId: SessionThreadId
  updatedAt: string
}

export interface UpsertThreadActivitySeenInput {
  seenCompletedAt: string
  seenCompletedRunId: RunId
  threadId: SessionThreadId
  updatedAt: string
}

/**
 * Persistence-neutral port for thread activity "seen" tracking. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface ThreadActivitySeenRepository {
  listByThreadIds: (
    scope: TenantScope,
    threadIds: SessionThreadId[],
  ) => Result<ThreadActivitySeenRecord[], DomainError>
  upsert: (
    scope: TenantScope,
    input: UpsertThreadActivitySeenInput,
  ) => Result<ThreadActivitySeenRecord, DomainError>
}
