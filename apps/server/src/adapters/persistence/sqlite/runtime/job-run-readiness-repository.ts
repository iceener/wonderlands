import { and, eq, inArray } from 'drizzle-orm'

import { jobs, runClaims, runs } from '../../../../db/schema'
import type {
  JobRunReadinessRepository,
  JobRunReadinessSnapshotRecord,
} from '../../../../domain/runtime/job-run-readiness-repository'
import type { DomainError } from '../../../../shared/errors'
import { err, ok, type Result } from '../../../../shared/result'
import type { RepositoryDatabase } from '../repository-database'

export const createJobRunReadinessRepository = (
  db: RepositoryDatabase,
): JobRunReadinessRepository => ({
  listExecutionCapableJobRunSnapshots: (): Result<JobRunReadinessSnapshotRecord[], DomainError> => {
    try {
      const rows = db
        .select({
          lastHeartbeatAt: jobs.lastHeartbeatAt,
          lastProgressAt: runs.lastProgressAt,
          leaseExpiresAt: runClaims.expiresAt,
          nextSchedulerCheckAt: jobs.nextSchedulerCheckAt,
          parentRunId: runs.parentRunId,
          priority: jobs.priority,
          queuedAt: jobs.queuedAt,
          runCreatedAt: runs.createdAt,
          runId: runs.id,
          runStatus: runs.status,
          sessionId: runs.sessionId,
          statusReasonJson: jobs.statusReasonJson,
          tenantId: runs.tenantId,
          jobId: jobs.id,
          jobStatus: jobs.status,
          jobUpdatedAt: jobs.updatedAt,
        })
        .from(jobs)
        .innerJoin(runs, and(eq(jobs.currentRunId, runs.id), eq(jobs.tenantId, runs.tenantId)))
        .leftJoin(
          runClaims,
          and(eq(runClaims.runId, runs.id), eq(runClaims.tenantId, runs.tenantId)),
        )
        .where(
          and(
            inArray(jobs.status, ['queued', 'running', 'waiting']),
            inArray(runs.status, ['pending', 'running', 'waiting']),
          ),
        )
        .all()

      return ok(rows)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown job/run readiness snapshot failure'

      return err({
        message: `failed to list job/run readiness snapshots: ${message}`,
        type: 'conflict',
      })
    }
  },
})
