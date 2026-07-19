import type { RepositoryDatabase } from '../../../db/repository-database'
import type { JobStatus } from '../../../domain/runtime/job-types'
import type { DomainError } from '../../../shared/errors'
import type { JobId } from '../../../shared/ids'
import { asRunId } from '../../../shared/ids'
import { ok, type Result } from '../../../shared/result'
import type { TenantScope } from '../../../shared/scope'
import {
  createJobDependencyRepository,
  createRunDependencyRepository,
  createRunRepository,
} from '../../persistence/repositories'
import { isParentDeliverableChildWait } from '../waits/delegated-child-waits'

const isTerminalDependencyStatus = (status: JobStatus): boolean =>
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
  const dependencyTargetStatuses = createJobDependencyRepository(db).listDependencyTargetStatuses(
    scope,
    { fromJobId: jobId, type: 'depends_on' },
  )

  if (!dependencyTargetStatuses.ok) {
    return dependencyTargetStatuses
  }

  for (const dependency of dependencyTargetStatuses.value) {
    if (isTerminalDependencyStatus(dependency.toJobStatus)) {
      continue
    }

    const suspended = isDelegatedChildSuspended(db, scope, dependency.metadataJson)

    if (!suspended.ok) {
      return suspended
    }

    if (!suspended.value) {
      return ok(false)
    }
  }

  return ok(true)
}
