import type { AppDatabase } from '../../db/client'
import { createSandboxExecutionRepository } from '../../adapters/persistence/sqlite/sandbox/sandbox-execution-repository'
import type { SandboxWritebackOperationRecord } from '../../domain/sandbox/sandbox-writeback-repository'
import { createSandboxWritebackRepository } from '../../adapters/persistence/sqlite/sandbox/sandbox-writeback-repository'
import type { DomainError } from '../../shared/errors'
import type { SandboxExecutionId, SandboxWritebackOperationId } from '../../shared/ids'
import { ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export interface SandboxWritebackReviewDecision {
  decision: 'approve' | 'reject'
  id: SandboxWritebackOperationId
}

export interface SandboxWritebackReviewResult {
  executionId: SandboxExecutionId
  skipped: Array<{
    id: SandboxWritebackOperationId
    reason: string
  }>
  updated: SandboxWritebackOperationRecord[]
  writebacks: SandboxWritebackOperationRecord[]
}

export interface SandboxReviewService {
  reviewWritebacks: (
    scope: TenantScope,
    input: {
      reviewedAt: string
      sandboxExecutionId: SandboxExecutionId
      decisions: SandboxWritebackReviewDecision[]
    },
  ) => Result<SandboxWritebackReviewResult, DomainError>
}

export const createSandboxReviewService = (db: AppDatabase): SandboxReviewService => ({
  reviewWritebacks: (scope, input) => {
    const executionRepository = createSandboxExecutionRepository(db)
    const writebackRepository = createSandboxWritebackRepository(db)
    const execution = executionRepository.getById(scope, input.sandboxExecutionId)

    if (!execution.ok) {
      return execution
    }

    const currentWritebacks = writebackRepository.listBySandboxExecutionId(
      scope,
      input.sandboxExecutionId,
    )

    if (!currentWritebacks.ok) {
      return currentWritebacks
    }

    const writebacksById = new Map(
      currentWritebacks.value.map((operation) => [operation.id, operation]),
    )
    const updated: SandboxWritebackOperationRecord[] = []
    const skipped: SandboxWritebackReviewResult['skipped'] = []

    for (const decision of input.decisions) {
      const operation = writebacksById.get(decision.id)

      if (!operation) {
        skipped.push({
          id: decision.id,
          reason: 'not_found',
        })
        continue
      }

      if (!operation.requiresApproval) {
        skipped.push({
          id: operation.id,
          reason: 'approval_not_required',
        })
        continue
      }

      if (operation.status === 'applied') {
        skipped.push({
          id: operation.id,
          reason: 'already_applied',
        })
        continue
      }

      const next =
        decision.decision === 'approve'
          ? writebackRepository.update(scope, {
              approvedAt: input.reviewedAt,
              approvedByAccountId: scope.accountId,
              errorText: null,
              id: operation.id,
              status: 'approved',
            })
          : writebackRepository.update(scope, {
              approvedAt: null,
              approvedByAccountId: null,
              errorText: null,
              id: operation.id,
              status: 'rejected',
            })

      if (!next.ok) {
        return next
      }

      updated.push(next.value)
      writebacksById.set(next.value.id, next.value)
    }

    const writebacks = writebackRepository.listBySandboxExecutionId(scope, input.sandboxExecutionId)

    if (!writebacks.ok) {
      return writebacks
    }

    return ok({
      executionId: execution.value.id,
      skipped,
      updated,
      writebacks: writebacks.value,
    })
  },
})
