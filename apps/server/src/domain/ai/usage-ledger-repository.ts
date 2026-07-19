import type { DomainError } from '../../shared/errors'
import type { RunId, SessionThreadId, WorkSessionId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export interface CreateInteractionUsageInput {
  cachedTokens: number | null
  createdAt: string
  estimatedInputTokens: number | null
  estimatedOutputTokens: number | null
  id: string
  inputTokens: number | null
  model: string
  outputTokens: number | null
  provider: string
  runId: RunId
  sessionId: WorkSessionId
  stablePrefixTokens: number | null
  threadId: SessionThreadId | null
  turn: number | null
  volatileSuffixTokens: number | null
}

export interface ThreadInteractionBudgetSnapshot {
  cachedTokens: number | null
  createdAt: string
  estimatedInputTokens: number | null
  estimatedOutputTokens: number | null
  inputTokens: number | null
  model: string
  outputTokens: number | null
  provider: string
  stablePrefixTokens: number | null
  turn: number | null
  volatileSuffixTokens: number | null
}

/**
 * Persistence-neutral port for AI usage ledger storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface UsageLedgerRepository {
  createInteractionEntry: (
    scope: TenantScope,
    input: CreateInteractionUsageInput,
  ) => Result<{ id: string }, DomainError>
  getLatestThreadInteractionBudget: (
    scope: TenantScope,
    threadId: SessionThreadId,
  ) => Result<ThreadInteractionBudgetSnapshot | null, DomainError>
}
