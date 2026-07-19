import type { DomainError } from '../../shared/errors'
import type {
  AccountId,
  RunId,
  SessionMessageId,
  SessionThreadId,
  TenantId,
  WorkSessionId,
} from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export type SessionMessageContentPart = { text: string; type: 'text' }

export interface SessionMessageRecord {
  authorAccountId: AccountId | null
  authorKind: 'user' | 'assistant' | 'system' | 'tool'
  content: SessionMessageContentPart[]
  createdAt: string
  id: SessionMessageId
  metadata: unknown | null
  runId: RunId | null
  sequence: number
  sessionId: WorkSessionId
  tenantId: TenantId
  threadId: SessionThreadId
}

export interface CreateSessionMessageInput {
  authorAccountId: AccountId | null
  authorKind?: SessionMessageRecord['authorKind']
  content: SessionMessageContentPart[]
  createdAt: string
  id: SessionMessageId
  metadata?: unknown | null
  runId: RunId | null
  sequence: number
  sessionId: WorkSessionId
  threadId: SessionThreadId
}

export interface ListThreadMessagesInput {
  afterSequence?: number
  limit?: number
}

export interface UpdateSessionMessageInput {
  content?: SessionMessageContentPart[]
  messageId: SessionMessageId
  metadata?: unknown | null
  runId?: RunId | null
  sessionId: WorkSessionId
  threadId: SessionThreadId
}

export interface AssignSessionMessageRunInput {
  messageId: SessionMessageId
  runId: RunId
  sessionId: WorkSessionId
  threadId: SessionThreadId
}

/**
 * Persistence-neutral port for session message storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface SessionMessageRepository {
  assignRun: (
    scope: TenantScope,
    input: AssignSessionMessageRunInput,
  ) => Result<SessionMessageRecord, DomainError>
  create: (
    scope: TenantScope,
    input: CreateSessionMessageInput,
  ) => Result<SessionMessageRecord, DomainError>
  createAssistantMessage: (
    scope: TenantScope,
    input: Omit<CreateSessionMessageInput, 'authorAccountId' | 'authorKind'>,
  ) => Result<SessionMessageRecord, DomainError>
  getById: (
    scope: TenantScope,
    messageId: SessionMessageId,
  ) => Result<SessionMessageRecord, DomainError>
  getNextSequence: (scope: TenantScope, threadId: SessionThreadId) => Result<number, DomainError>
  listAfterSequence: (
    scope: TenantScope,
    threadId: SessionThreadId,
    sequence: number,
  ) => Result<SessionMessageRecord[], DomainError>
  listByThreadId: (
    scope: TenantScope,
    threadId: SessionThreadId,
  ) => Result<SessionMessageRecord[], DomainError>
  listWindowByThreadId: (
    scope: TenantScope,
    threadId: SessionThreadId,
    options: ListThreadMessagesInput,
  ) => Result<SessionMessageRecord[], DomainError>
  update: (
    scope: TenantScope,
    input: UpdateSessionMessageInput,
  ) => Result<SessionMessageRecord, DomainError>
}
