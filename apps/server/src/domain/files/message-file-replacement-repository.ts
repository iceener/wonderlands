import type { FileId, SessionMessageId, TenantId, WorkSessionId } from '../../shared/ids'
import type { FileDeletionPlan } from './file-deletion-plan-repository'

export interface ApplyMessageFileReplacementInput {
  desiredFileIds: FileId[]
  messageId: SessionMessageId
  sessionId: WorkSessionId
  tenantId: TenantId
}

/**
 * Persistence-neutral port that, given the set of file ids a message should
 * end up linked to, removes any now-orphaned direct message file links (and
 * the files/uploads/domain-events that become unreachable as a result).
 * Concrete implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface MessageFileReplacementRepository {
  applyReplacement: (input: ApplyMessageFileReplacementInput) => FileDeletionPlan
}
