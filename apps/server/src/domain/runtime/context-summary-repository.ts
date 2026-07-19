import type { DomainError } from '../../shared/errors'
import type { RunId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export interface ContextSummaryRecord {
  content: string
  createdAt: string
  fromSequence: number
  id: string
  modelKey: string
  previousSummaryId: string | null
  runId: RunId
  tenantId: TenantId
  throughSequence: number
  tokensAfter: number | null
  tokensBefore: number | null
  turnNumber: number | null
}

export interface CreateContextSummaryInput {
  content: string
  createdAt: string
  fromSequence: number
  id: string
  modelKey: string
  previousSummaryId?: string | null
  runId: RunId
  throughSequence: number
  tokensAfter?: number | null
  tokensBefore?: number | null
  turnNumber?: number | null
}

/**
 * Persistence-neutral port for context summary storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface ContextSummaryRepository {
  create: (
    scope: TenantScope,
    input: CreateContextSummaryInput,
  ) => Result<ContextSummaryRecord, DomainError>
  getLatestByRunId: (
    scope: TenantScope,
    runId: RunId,
  ) => Result<ContextSummaryRecord | null, DomainError>
  listByRunId: (scope: TenantScope, runId: RunId) => Result<ContextSummaryRecord[], DomainError>
}
