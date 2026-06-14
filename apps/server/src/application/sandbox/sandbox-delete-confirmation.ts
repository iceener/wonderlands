export const SANDBOX_DELETE_WRITEBACK_CONFIRMATION_TARGET_REF = 'sandbox_execute:delete_writeback'

interface DeleteWritebackLike {
  mode: string
  requiresApproval?: boolean
  targetVaultPath?: string
  toVaultPath?: string
}

const readDeleteWritebackTargetPath = (writeback: DeleteWritebackLike): string =>
  typeof writeback.toVaultPath === 'string' && writeback.toVaultPath.length > 0
    ? writeback.toVaultPath
    : typeof writeback.targetVaultPath === 'string' && writeback.targetVaultPath.length > 0
      ? writeback.targetVaultPath
      : '/vault/...'

export const requiresSandboxDeleteWritebackConfirmation = (
  writebacks: DeleteWritebackLike[],
): boolean =>
  writebacks.some((writeback) => writeback.mode === 'delete' && writeback.requiresApproval === true)

export const getSandboxDeleteWritebackTargets = (writebacks: DeleteWritebackLike[]): string[] =>
  writebacks
    .filter((writeback) => writeback.mode === 'delete' && writeback.requiresApproval === true)
    .map(readDeleteWritebackTargetPath)

export const formatSandboxDeleteWritebackConfirmationDescription = (targets: string[]): string => {
  if (targets.length === 1) {
    return `Approve execute before launching a sandbox that may delete ${targets[0] ?? '/vault/...'}`
  }

  return `Approve execute before launching a sandbox that may delete ${targets.length} vault paths`
}

export const isSandboxDeleteWritebackConfirmationTargetRef = (
  value: string | null | undefined,
): boolean => value === SANDBOX_DELETE_WRITEBACK_CONFIRMATION_TARGET_REF
