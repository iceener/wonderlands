import { and, eq } from 'drizzle-orm'

import { runDependencies, runs } from '../../../../db/schema'
import type {
  PendingWaitReadinessRepository,
  PendingWaitReadinessSnapshotRecord,
} from '../../../../domain/runtime/pending-wait-readiness-repository'
import type { DomainError } from '../../../../shared/errors'
import { err, ok, type Result } from '../../../../shared/result'
import type { RepositoryDatabase } from '../repository-database'

export const createPendingWaitReadinessRepository = (
  db: RepositoryDatabase,
): PendingWaitReadinessRepository => ({
  listPendingRunDependencySnapshots: (): Result<
    PendingWaitReadinessSnapshotRecord[],
    DomainError
  > => {
    try {
      const rows = db
        .select({
          ownerRunId: runs.id,
          ownerRunStatus: runs.status,
          sessionId: runs.sessionId,
          targetRunId: runDependencies.targetRunId,
          tenantId: runs.tenantId,
          timeoutAt: runDependencies.timeoutAt,
          waitCreatedAt: runDependencies.createdAt,
          waitId: runDependencies.id,
          waitTargetKind: runDependencies.targetKind,
          waitType: runDependencies.type,
        })
        .from(runDependencies)
        .innerJoin(
          runs,
          and(eq(runDependencies.runId, runs.id), eq(runDependencies.tenantId, runs.tenantId)),
        )
        .where(eq(runDependencies.status, 'pending'))
        .all()

      return ok(rows)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown pending run dependency snapshot failure'

      return err({
        message: `failed to list pending run dependency snapshots: ${message}`,
        type: 'conflict',
      })
    }
  },
})
