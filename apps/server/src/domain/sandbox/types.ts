export const sandboxProviderValues = ['deno', 'local_dev'] as const
export type SandboxProvider = (typeof sandboxProviderValues)[number]

export const sandboxRuntimeValues = ['lo', 'node'] as const
export type SandboxRuntime = (typeof sandboxRuntimeValues)[number]

export const sandboxExecutionModeValues = ['script', 'bash'] as const
export type SandboxExecutionMode = (typeof sandboxExecutionModeValues)[number]

export const sandboxExecutionStatusValues = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const
export type SandboxExecutionStatus = (typeof sandboxExecutionStatusValues)[number]

export const sandboxExecutionFileRoleValues = [
  'attachment_input',
  'vault_input',
  'generated_output',
  'writeback_candidate',
  'log',
] as const
export type SandboxExecutionFileRole = (typeof sandboxExecutionFileRoleValues)[number]

export const sandboxPackageStatusValues = ['requested', 'blocked', 'installed', 'failed'] as const
export type SandboxPackageStatus = (typeof sandboxPackageStatusValues)[number]

export const sandboxWritebackOperationValues = ['write', 'copy', 'move', 'delete'] as const
export type SandboxWritebackOperation = (typeof sandboxWritebackOperationValues)[number]

export const sandboxWritebackStatusValues = [
  'pending',
  'approved',
  'applied',
  'rejected',
  'failed',
] as const
export type SandboxWritebackStatus = (typeof sandboxWritebackStatusValues)[number]

export const sandboxNetworkModeValues = ['off', 'allow_list', 'open'] as const
export type SandboxNetworkMode = (typeof sandboxNetworkModeValues)[number]

export const sandboxVaultAccessModeValues = ['none', 'read_only', 'read_write'] as const
export type SandboxVaultAccessMode = (typeof sandboxVaultAccessModeValues)[number]

export interface SandboxPackagePolicy {
  allowedPackages?: Array<{
    allowInstallScripts?: boolean
    name: string
    runtimes?: SandboxRuntime[]
    versionRange: string
  }>
  allowedRegistries?: string[]
  mode: 'disabled' | 'allow_list' | 'open'
}

export interface SandboxNetworkPolicy {
  allowedHosts?: string[]
  mode: SandboxNetworkMode
}

export interface SandboxVaultAccessPolicy {
  allowedRoots?: string[]
  mode: SandboxVaultAccessMode
  requireApprovalForDelete?: boolean
  requireApprovalForMove?: boolean
  requireApprovalForWorkspaceScript?: boolean
  requireApprovalForWrite?: boolean
}

export interface SandboxShellPolicy {
  allowedCommands?: string[]
}

export interface SandboxPolicy {
  enabled: boolean
  network: SandboxNetworkPolicy
  packages: SandboxPackagePolicy
  runtime: {
    allowAutomaticCompatFallback: boolean
    allowedEngines: SandboxRuntime[]
    allowWorkspaceScripts: boolean
    defaultEngine: SandboxRuntime
    maxDurationSec: number
    maxInputBytes: number
    maxMemoryMb: number
    maxOutputBytes: number
    nodeVersion: string
  }
  shell?: SandboxShellPolicy
  vault: SandboxVaultAccessPolicy
}

export type SandboxExecutionSource =
  | {
      filename?: string
      kind: 'inline_script'
      script: string
    }
  | {
      kind: 'workspace_script'
      vaultPath: string
    }

export interface SandboxAttachmentInput {
  fileId: string
  mountPath?: string
}

export interface SandboxVaultInput {
  mountPath?: string
  vaultPath: string
}

export interface SandboxRequestedPackage {
  name: string
  version: string
}

export interface SandboxFileWritebackRequest {
  fromPath: string
  mode: 'write' | 'copy' | 'move'
  toVaultPath: string
}

export interface SandboxDeleteWritebackRequest {
  mode: 'delete'
  toVaultPath: string
}

export type SandboxWritebackRequest = SandboxFileWritebackRequest | SandboxDeleteWritebackRequest

export interface SandboxOutputRequest {
  attachGlobs?: string[]
  writeBack?: SandboxWritebackRequest[]
}

export interface SandboxExecutionRequest {
  args?: string[]
  attachments?: SandboxAttachmentInput[]
  cwdVaultPath?: string
  env?: Record<string, string>
  mcpCodeModeApprovedRuntimeNames?: string[]
  mode: SandboxExecutionMode
  network?: {
    hosts?: string[]
    mode: 'off' | 'on'
  }
  outputs?: SandboxOutputRequest
  packages?: SandboxRequestedPackage[]
  runtime: SandboxRuntime
  source: SandboxExecutionSource
  task: string
  vaultAccess?: Extract<SandboxVaultAccessMode, 'read_only' | 'read_write'>
  vaultInputs?: SandboxVaultInput[]
}
