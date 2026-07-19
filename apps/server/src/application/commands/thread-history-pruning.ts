import type { AppTransaction } from '../../db/transaction'
import type { DomainError } from '../../shared/errors'
import type { Result } from '../../shared/result'
import { createThreadHistoryPruningRepository } from '../persistence/repositories'

export type {
  PruneThreadHistoryInput,
  PruneThreadHistoryOutput,
} from '../../domain/sessions/thread-history-pruning-repository'

import type {
  PruneThreadHistoryInput,
  PruneThreadHistoryOutput,
} from '../../domain/sessions/thread-history-pruning-repository'

/**
 * Cascading, transaction-scoped deletion of thread/run/job history. The
 * actual raw persistence procedure lives behind `ThreadHistoryPruningRepository`
 * (see `domain/sessions/thread-history-pruning-repository.ts` and the
 * SQLite adapter under `adapters/persistence/sqlite/sessions/`); this
 * application-layer wrapper must not import drizzle/db/schema/concrete
 * adapters directly -- see `test/architecture-guardrails.test.ts`.
 */
export const pruneThreadHistoryInTransaction = (
  tx: AppTransaction,
  input: PruneThreadHistoryInput,
): Result<PruneThreadHistoryOutput, DomainError> =>
  createThreadHistoryPruningRepository(tx).prune(input)
