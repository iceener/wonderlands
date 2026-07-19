import { createUsageLedgerRepository } from '../../../persistence/repositories'
import { withTransaction } from '../../../../db/transaction'
import type { AiProviderName, AiUsage } from '../../../../domain/ai/types'
import type { RepositoryDatabase } from '../../../../db/repository-database'
import type { RunRecord } from '../../../../domain/runtime/run-repository'
import type { DomainError } from '../../../../shared/errors'
import { ok, type Result } from '../../../../shared/result'
import type { CommandContext } from '../../../commands/command-context'
import type { ContextBudgetReport } from '../../../interactions/context-bundle'
import { assertRunSnapshotCurrent } from '../../run-concurrency'
import { unwrapOrThrow } from '../../run-events'
import { toPersistenceFailure } from '../state/run-state-support'

export const persistUsageEntry = (
  context: CommandContext,
  run: RunRecord,
  usage: AiUsage | null,
  model: string,
  provider: AiProviderName,
  createdAt: string,
  budget: ContextBudgetReport,
): Result<null, DomainError> => {
  try {
    return withTransaction(context.db, (tx) =>
      persistUsageEntryInTransaction(context, tx, run, usage, model, provider, createdAt, budget),
    )
  } catch (error) {
    return toPersistenceFailure(error, 'failed to persist usage entry')
  }
}

export const persistUsageEntryInTransaction = (
  context: CommandContext,
  db: RepositoryDatabase,
  run: RunRecord,
  usage: AiUsage | null,
  model: string,
  provider: AiProviderName,
  createdAt: string,
  budget: ContextBudgetReport,
): Result<null, DomainError> => {
  unwrapOrThrow(assertRunSnapshotCurrent(db, context.tenantScope, run))

  const usageLedgerRepository = createUsageLedgerRepository(db)
  unwrapOrThrow(
    usageLedgerRepository.createInteractionEntry(context.tenantScope, {
      cachedTokens: usage?.cachedTokens ?? null,
      createdAt,
      estimatedInputTokens: budget.rawEstimatedInputTokens,
      estimatedOutputTokens: budget.reservedOutputTokens,
      id: context.services.ids.create('usg'),
      inputTokens: usage?.inputTokens ?? null,
      model,
      outputTokens: usage?.outputTokens ?? null,
      provider,
      runId: run.id,
      sessionId: run.sessionId,
      stablePrefixTokens: budget.stablePrefixTokens,
      threadId: run.threadId,
      turn: run.turnCount + 1,
      volatileSuffixTokens: budget.volatileSuffixTokens,
    }),
  )

  return ok(null)
}
