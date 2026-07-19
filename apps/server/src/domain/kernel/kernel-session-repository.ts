import type { DomainError } from '../../shared/errors'
import type { KernelSessionId, RunId, SessionThreadId, TenantId, WorkSessionId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { KernelProvider, KernelSessionStatus } from './types'

export interface KernelSessionRecord {
  completedAt: string | null
  createdAt: string
  durationMs: number | null
  endpoint: string | null
  errorText: string | null
  id: KernelSessionId
  policySnapshotJson: Record<string, unknown>
  provider: KernelProvider
  requestJson: Record<string, unknown>
  resultJson: Record<string, unknown> | null
  runId: RunId
  sessionId: WorkSessionId
  startedAt: string | null
  status: KernelSessionStatus
  stderrText: string | null
  stdoutText: string | null
  tenantId: TenantId
  threadId: SessionThreadId | null
  toolExecutionId: string | null
}

export interface CreateKernelSessionInput {
  createdAt: string
  endpoint?: string | null
  id: KernelSessionId
  policySnapshotJson: Record<string, unknown>
  provider: KernelProvider
  requestJson: Record<string, unknown>
  runId: RunId
  sessionId: WorkSessionId
  status: KernelSessionStatus
  threadId?: SessionThreadId | null
  toolExecutionId?: string | null
}

export interface UpdateKernelSessionInput {
  completedAt?: string | null
  durationMs?: number | null
  endpoint?: string | null
  errorText?: string | null
  id: KernelSessionId
  resultJson?: Record<string, unknown> | null
  startedAt?: string | null
  status?: KernelSessionStatus
  stderrText?: string | null
  stdoutText?: string | null
}

/**
 * Persistence-neutral port for kernel session storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface KernelSessionRepository {
  countActive: (scope: TenantScope) => Result<number, DomainError>
  create: (
    scope: TenantScope,
    input: CreateKernelSessionInput,
  ) => Result<KernelSessionRecord, DomainError>
  getById: (scope: TenantScope, id: KernelSessionId) => Result<KernelSessionRecord, DomainError>
  listByRunId: (scope: TenantScope, runId: RunId) => Result<KernelSessionRecord[], DomainError>
  update: (
    scope: TenantScope,
    input: UpdateKernelSessionInput,
  ) => Result<KernelSessionRecord, DomainError>
}
