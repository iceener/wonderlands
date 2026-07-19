import type { RunRecord, RunRepository } from '../../../../../domain/runtime/run-repository'
import type { DomainError } from '../../../../../shared/errors'
import { ok, type Result } from '../../../../../shared/result'
import type { TenantScope } from '../../../../../shared/scope'

export const buildRunTree = (
  runRepository: RunRepository,
  scope: TenantScope,
  run: RunRecord,
): Result<RunRecord[], DomainError> => {
  const children = runRepository.listByParentRunId(scope, run.id)

  if (!children.ok) {
    return children
  }

  const descendants: RunRecord[] = [run]

  for (const child of children.value) {
    const childTree = buildRunTree(runRepository, scope, child)

    if (!childTree.ok) {
      return childTree
    }

    descendants.push(...childTree.value)
  }

  return ok(descendants)
}
