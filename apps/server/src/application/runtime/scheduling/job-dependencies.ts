import { and, eq } from 'drizzle-orm'

import { jobDependencies, jobs } from '../../../db/schema'
import type { RepositoryDatabase } from '../../../db/repository-database'
import { createRunDependencyRepository } from '../../../adapters/persistence/sqlite/runtime/run-dependency-repository'
import { createRunRepository } from '../../../adapters/persistence/sqlite/runtime/run-repository'
import type { DomainError } from '../../../shared/errors'
import type { JobId } from '../../../shared/ids'
import { asRunId } from '../../../shared/ids'
import { err, ok, type Result } from '../../../shared/result'
import type { TenantScope } from '../../../shared/scope'
import { isParentDeliverableChildWait } from '../waits/delegated-child-waits'

const isTerminalDependencyStatus = (status: typeof jobs.$inferSelect.status): boolean =>
  status === 'completed' ||
  status === 'cancelled' ||
  status === 'blocked' ||
  status === 'superseded'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isDelegatedChildSuspended = (
  db: RepositoryDatabase,
  scope: TenantScope,
  metadataJson: unknown,
): Result<boolean, DomainError> => {
  if (!isRecord(metadataJson) || typeof metadataJson.childRunId !== 'string') {
    return ok(false)
  }

  const childRun = createRunRepository(db).getById(scope, asRunId(metadataJson.childRunId))

  if (!childRun.ok) {
    return childRun
  }

  if (childRun.value.status !== 'waiting') {
    return ok(false)
  }

  const pendingWaits = createRunDependencyRepository(db).listPendingByRunId(
    scope,
    childRun.value.id,
  )

  if (!pendingWaits.ok) {
    return pendingWaits
  }

  return ok(pendingWaits.value.some(isParentDeliverableChildWait))
}

export const dependenciesSatisfiedForJob = (
  db: RepositoryDatabase,
  scope: TenantScope,
  jobId: JobId,
): Result<boolean, DomainError> => {
  try {
    const rows = db
      .select({
        metadataJson: jobDependencies.metadataJson,
        status: jobs.status,
      })
      .from(jobDependencies)
      .innerJoin(
        jobs,
        and(eq(jobDependencies.toJobId, jobs.id), eq(jobDependencies.tenantId, jobs.tenantId)),
      )
      .where(
        and(
          eq(jobDependencies.fromJobId, jobId),
          eq(jobDependencies.tenantId, scope.tenantId),
          eq(jobDependencies.type, 'depends_on'),
        ),
      )
      .all()

    for (const row of rows) {
      if (isTerminalDependencyStatus(row.status)) {
        continue
      }

      const suspended = isDelegatedChildSuspended(db, scope, row.metadataJson)

      if (!suspended.ok) {
        return suspended
      }

      if (!suspended.value) {
        return ok(false)
      }
    }

    return ok(true)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown work-item dependency readiness failure'

    return err({
      message: `failed to evaluate dependencies for work item ${jobId}: ${message}`,
      type: 'conflict',
    })
  }
}
