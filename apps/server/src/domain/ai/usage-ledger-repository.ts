import { and, desc, eq, isNull } from 'drizzle-orm'

import { runs, usageLedger } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import type { RunId, SessionThreadId, WorkSessionId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

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

export const createUsageLedgerRepository = (db: RepositoryDatabase) => ({
  createInteractionEntry: (
    scope: TenantScope,
    input: CreateInteractionUsageInput,
  ): Result<{ id: string }, DomainError> => {
    try {
      db.insert(usageLedger)
        .values({
          cachedTokens: input.cachedTokens ?? 0,
          costMicros: null,
          createdAt: input.createdAt,
          estimatedInputTokens: input.estimatedInputTokens,
          estimatedOutputTokens: input.estimatedOutputTokens,
          id: input.id,
          inputTokens: input.inputTokens ?? 0,
          model: input.model,
          operation: 'interaction',
          outputTokens: input.outputTokens ?? 0,
          provider: input.provider,
          runId: input.runId,
          sessionId: input.sessionId,
          stablePrefixTokens: input.stablePrefixTokens,
          summaryId: null,
          tenantId: scope.tenantId,
          threadId: input.threadId,
          toolExecutionId: null,
          turn: input.turn,
          volatileSuffixTokens: input.volatileSuffixTokens,
        })
        .run()

      return ok({ id: input.id })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown usage ledger write failure'

      return err({
        message: `failed to append usage ledger entry ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  getLatestThreadInteractionBudget: (
    scope: TenantScope,
    threadId: SessionThreadId,
  ): Result<ThreadInteractionBudgetSnapshot | null, DomainError> => {
    try {
      const row = db
        .select({
          cachedTokens: usageLedger.cachedTokens,
          createdAt: usageLedger.createdAt,
          estimatedInputTokens: usageLedger.estimatedInputTokens,
          estimatedOutputTokens: usageLedger.estimatedOutputTokens,
          inputTokens: usageLedger.inputTokens,
          model: usageLedger.model,
          outputTokens: usageLedger.outputTokens,
          provider: usageLedger.provider,
          stablePrefixTokens: usageLedger.stablePrefixTokens,
          turn: usageLedger.turn,
          volatileSuffixTokens: usageLedger.volatileSuffixTokens,
        })
        .from(usageLedger)
        .innerJoin(runs, and(eq(runs.id, usageLedger.runId), eq(runs.tenantId, scope.tenantId)))
        .where(
          and(
            eq(usageLedger.tenantId, scope.tenantId),
            eq(usageLedger.threadId, threadId),
            eq(usageLedger.operation, 'interaction'),
            isNull(runs.parentRunId),
          ),
        )
        .orderBy(desc(usageLedger.createdAt), desc(usageLedger.id))
        .get()

      return ok(row ?? null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown thread usage budget lookup failure'

      return err({
        message: `failed to read latest interaction budget for thread ${threadId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
