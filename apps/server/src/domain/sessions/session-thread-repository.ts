import type { DomainError } from '../../shared/errors'
import type {
  AccountId,
  SessionMessageId,
  SessionThreadId,
  TenantId,
  WorkSessionId,
} from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export interface SessionThreadRecord {
  branchFromMessageId: SessionMessageId | null
  branchFromSequence: number | null
  createdAt: string
  createdByAccountId: AccountId | null
  id: SessionThreadId
  parentThreadId: SessionThreadId | null
  sessionId: WorkSessionId
  status: 'active' | 'merged' | 'archived' | 'deleted'
  tenantId: TenantId
  title: string | null
  titleSource: 'manual' | 'auto_first_message' | 'manual_regenerate' | null
  updatedAt: string
}

export interface CreateSessionThreadInput {
  branchFromMessageId?: SessionMessageId | null
  branchFromSequence?: number | null
  createdAt: string
  createdByAccountId: AccountId | null
  id: SessionThreadId
  parentThreadId?: SessionThreadId | null
  sessionId: WorkSessionId
  title: string | null
  titleSource?: SessionThreadRecord['titleSource']
  updatedAt: string
}

export interface UpdateSessionThreadInput {
  status?: SessionThreadRecord['status']
  title?: string | null
  titleSource?: SessionThreadRecord['titleSource']
  updatedAt?: string
}

export interface ListVisibleThreadsByAccountOptions {
  limit?: number
  query?: string
}

/**
 * Persistence-neutral port for session thread storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface SessionThreadRepository {
  create: (
    scope: TenantScope,
    input: CreateSessionThreadInput,
  ) => Result<SessionThreadRecord, DomainError>
  getById: (
    scope: TenantScope,
    threadId: SessionThreadId,
  ) => Result<SessionThreadRecord, DomainError>
  listBySessionId: (
    scope: TenantScope,
    sessionId: WorkSessionId,
  ) => Result<SessionThreadRecord[], DomainError>
  listRootVisibleByAccount: (scope: TenantScope) => Result<SessionThreadRecord[], DomainError>
  listVisibleByAccount: (
    scope: TenantScope,
    options?: ListVisibleThreadsByAccountOptions,
  ) => Result<SessionThreadRecord[], DomainError>
  update: (
    scope: TenantScope,
    threadId: SessionThreadId,
    input: UpdateSessionThreadInput,
  ) => Result<SessionThreadRecord, DomainError>
}
