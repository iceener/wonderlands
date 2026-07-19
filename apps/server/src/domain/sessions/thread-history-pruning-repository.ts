import type { DomainError } from '../../shared/errors'
import type { Result } from '../../shared/result'

export interface PruneThreadHistoryInput {
  messageIds?: string[]
  preserveWorkItemIds?: string[]
  rootRunIds?: string[]
  sessionId: string
  tenantId: string
  threadIds?: string[]
}

export interface PruneThreadHistoryOutput {
  blobStorageKeys: string[]
  deletedMessageIds: string[]
  deletedRunIds: string[]
  deletedWorkItemIds: string[]
}

/**
 * Persistence-neutral port for cascading, transaction-scoped deletion of
 * thread/run/job history (and everything that transitively FKs to it --
 * messages, tool executions, waits, summaries, memory records, sandbox and
 * kernel artifacts, domain events/outbox rows, and orphaned files/uploads).
 * Concrete implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface ThreadHistoryPruningRepository {
  prune: (input: PruneThreadHistoryInput) => Result<PruneThreadHistoryOutput, DomainError>
}
