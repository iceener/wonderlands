import type { DomainError } from '../../shared/errors'
import type { Result } from '../../shared/result'
import type {
  SandboxNetworkMode,
  SandboxPackageStatus,
  SandboxProvider,
  SandboxRuntime,
  SandboxVaultAccessMode,
} from './types'

export interface PreparedSandboxPackage {
  id: string
  installScriptsAllowed: boolean
  name: string
  registryHost: string | null
  requestedVersion: string
}

export interface SandboxRunPackageResult {
  errorText: string | null
  id: string
  name: string
  requestedVersion: string
  resolvedVersion: string | null
  status: Extract<SandboxPackageStatus, 'blocked' | 'failed' | 'installed'>
}

export type SandboxRunFailurePhase = 'package_install' | 'runner_setup' | 'script_execution'

export type SandboxRunFailureOrigin = 'control_plane' | 'guest' | 'policy'

export type SandboxRunFailureCode =
  | 'SANDBOX_EXECUTION_TIMEOUT'
  | 'SANDBOX_GUEST_EXIT_NON_ZERO'
  | 'SANDBOX_OUTPUT_LIMIT_EXCEEDED'
  | 'SANDBOX_PACKAGE_INSTALL_FAILED'
  | 'SANDBOX_PACKAGE_INSTALL_REQUIRES_NETWORK'
  | 'SANDBOX_PATH_NOT_MOUNTED'
  | 'SANDBOX_PERMISSION_DENIED'
  | 'SANDBOX_POLICY_INSTALL_SCRIPTS_BLOCKED'
  | 'SANDBOX_POLICY_RUNTIME_UNSUPPORTED'
  | 'SANDBOX_RUNNER_SETUP_FAILED'
  | 'SANDBOX_SCRIPT_IMPORT_FAILED'
  | 'SANDBOX_VALIDATION_IMPORT_EXPORT_IN_SCRIPT_BODY'
  | 'SANDBOX_VALIDATION_REQUIRE_IN_ESM'
  | 'SANDBOX_VALIDATION_TOP_LEVEL_RETURN'

export interface SandboxRunFailure {
  code: SandboxRunFailureCode
  exitCode: number | null
  hint: string | null
  message: string
  nextAction: string | null
  origin: SandboxRunFailureOrigin
  phase: SandboxRunFailurePhase
  retryable: boolean
  runner: SandboxProvider
  signal: string | null
  stderrPreview: string | null
  stdoutPreview: string | null
  summary: string
}

export interface PreparedSandboxExecution {
  executionId: string
  hostRootRef: string
  inputRootRef: string
  mcpDispatcher?: (input: {
    args: unknown
    runtimeName: string
  }) => Promise<Result<unknown, DomainError>>
  packages: PreparedSandboxPackage[]
  outputRootRef: string
  policySnapshotJson: Record<string, unknown>
  requestJson: Record<string, unknown>
  runtime: SandboxRuntime
  workRootRef: string
}

export interface SandboxRunResult {
  completedAt: string
  durationMs: number | null
  errorText: string | null
  externalSandboxId: string | null
  failure: SandboxRunFailure | null
  networkMode: SandboxNetworkMode
  packages: SandboxRunPackageResult[]
  provider: SandboxProvider
  runtime: SandboxRuntime
  startedAt: string
  status: 'cancelled' | 'completed' | 'failed'
  stderrText: string | null
  stdoutText: string | null
  vaultAccessMode: SandboxVaultAccessMode
}

export interface SandboxRunner {
  provider: SandboxProvider
  supportedRuntimes: SandboxRuntime[]
  runExecution: (input: PreparedSandboxExecution) => Promise<Result<SandboxRunResult, DomainError>>
}
