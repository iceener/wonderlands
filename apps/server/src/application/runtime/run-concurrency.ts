import type { RepositoryDatabase } from '../../domain/database-port'
import { createRunRepository, type RunRecord } from '../../domain/runtime/run-repository'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export const assertRunSnapshotCurrent = (
  db: RepositoryDatabase,
  scope: TenantScope,
  run: RunRecord,
): Result<RunRecord, DomainError> => {
  const currentRun = createRunRepository(db).getById(scope, run.id)

  if (!currentRun.ok) {
    return currentRun
  }

  if (currentRun.value.version !== run.version || currentRun.value.status !== run.status) {
    return err({
      message: `run ${run.id} changed from ${run.status}@${run.version} to ${currentRun.value.status}@${currentRun.value.version}`,
      type: 'conflict',
    })
  }

  return ok(currentRun.value)
}
