import type { SandboxWritebackOperationRecord } from '../../domain/sandbox/sandbox-writeback-repository'

export const toSelectedWritebacks = (
  writebacks: SandboxWritebackOperationRecord[],
  operationIds?: string[],
): SandboxWritebackOperationRecord[] => {
  const selectedIds = operationIds ? new Set(operationIds) : null

  return writebacks.filter((operation) => (selectedIds ? selectedIds.has(operation.id) : true))
}

export const toCommitSandboxWritebackOutput = (input: {
  applied: Array<Pick<SandboxWritebackOperationRecord, 'id' | 'operation' | 'targetVaultPath'>>
  executionId: string
  skipped: Array<{
    id: string
    reason: string
  }>
}) => {
  const allSkippedPendingApproval =
    input.applied.length === 0 &&
    input.skipped.length > 0 &&
    input.skipped.every((entry) => entry.reason === 'status_pending')

  return {
    applied: input.applied.map((operation) => ({
      id: operation.id,
      operation: operation.operation,
      targetVaultPath: operation.targetVaultPath,
    })),
    ...(allSkippedPendingApproval
      ? {
          message:
            'No write-backs were applied because they are still pending approval. Review and approve them before committing.',
          status: 'waiting_for_approval' as const,
        }
      : {}),
    sandboxExecutionId: input.executionId,
    skipped: input.skipped,
  }
}
