import type { DomainError } from '../../shared/errors'
import type {
  JobId,
  RunId,
  SandboxExecutionId,
  SessionThreadId,
  TenantId,
  WorkSessionId,
  WorkspaceId,
} from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type {
  SandboxExecutionStatus,
  SandboxNetworkMode,
  SandboxProvider,
  SandboxRuntime,
  SandboxVaultAccessMode,
} from './types'

export interface SandboxExecutionRecord {
  completedAt: string | null
  createdAt: string
  durationMs: number | null
  errorText: string | null
  externalSandboxId: string | null
  id: SandboxExecutionId
  jobId: JobId | null
  networkMode: SandboxNetworkMode
  policySnapshotJson: Record<string, unknown>
  provider: SandboxProvider
  queuedAt: string | null
  requestJson: Record<string, unknown>
  runId: RunId
  runtime: SandboxRuntime
  sessionId: WorkSessionId
  startedAt: string | null
  status: SandboxExecutionStatus
  stderrText: string | null
  stdoutText: string | null
  tenantId: TenantId
  threadId: SessionThreadId | null
  toolExecutionId: string | null
  vaultAccessMode: SandboxVaultAccessMode
  workspaceId: WorkspaceId | null
  workspaceRef: string | null
}

export interface CreateSandboxExecutionInput {
  createdAt: string
  id: SandboxExecutionId
  jobId?: JobId | null
  networkMode: SandboxNetworkMode
  policySnapshotJson: Record<string, unknown>
  provider: SandboxProvider
  queuedAt?: string | null
  requestJson: Record<string, unknown>
  runId: RunId
  runtime: SandboxRuntime
  sessionId: WorkSessionId
  status: SandboxExecutionStatus
  threadId?: SessionThreadId | null
  toolExecutionId?: string | null
  vaultAccessMode: SandboxVaultAccessMode
  workspaceId?: WorkspaceId | null
  workspaceRef?: string | null
}

export interface UpdateSandboxExecutionInput {
  completedAt?: string | null
  durationMs?: number | null
  errorText?: string | null
  externalSandboxId?: string | null
  id: SandboxExecutionId
  queuedAt?: string | null
  startedAt?: string | null
  status?: SandboxExecutionStatus
  stderrText?: string | null
  stdoutText?: string | null
}

export interface ClaimSandboxExecutionInput {
  id: SandboxExecutionId
  startedAt: string
}

/**
 * Persistence-neutral port for sandbox execution storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface SandboxExecutionRepository {
  claimQueued: (
    scope: TenantScope,
    input: ClaimSandboxExecutionInput,
  ) => Result<SandboxExecutionRecord, DomainError>
  create: (
    scope: TenantScope,
    input: CreateSandboxExecutionInput,
  ) => Result<SandboxExecutionRecord, DomainError>
  getById: (scope: TenantScope, id: SandboxExecutionId) => Result<SandboxExecutionRecord, DomainError>
  listByRunId: (scope: TenantScope, runId: RunId) => Result<SandboxExecutionRecord[], DomainError>
  listQueued: (scope: TenantScope, limit?: number) => Result<SandboxExecutionRecord[], DomainError>
  listQueuedGlobal: (limit?: number) => Result<SandboxExecutionRecord[], DomainError>
  update: (
    scope: TenantScope,
    input: UpdateSandboxExecutionInput,
  ) => Result<SandboxExecutionRecord, DomainError>
}
