import type { DomainError } from '../../shared/errors'
import type { RunId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { WaitTargetKind, WaitType } from '../tooling/tool-vocabulary'

export type RunDependencyStatus = 'pending' | 'resolved' | 'cancelled' | 'timed_out'

export interface RunDependencyRecord {
  callId: string
  createdAt: string
  description: string | null
  id: string
  resolutionJson: unknown | null
  resolvedAt: string | null
  runId: RunId
  status: RunDependencyStatus
  targetKind: WaitTargetKind
  targetRef: string | null
  targetRunId: RunId | null
  tenantId: TenantId
  timeoutAt: string | null
  type: WaitType
}

export interface CreateRunDependencyInput {
  callId: string
  createdAt: string
  description?: string | null
  id: string
  runId: RunId
  targetKind: WaitTargetKind
  targetRef?: string | null
  targetRunId?: RunId | null
  timeoutAt?: string | null
  type: WaitType
}

export interface ResolveRunDependencyInput {
  id: string
  resolutionJson: unknown
  resolvedAt: string
  status: Extract<RunDependencyStatus, 'resolved' | 'cancelled' | 'timed_out'>
}

export interface ResolveManyRunDependenciesForRunInput {
  ids: string[]
  resolutionJson: unknown
  resolvedAt: string
  runId: RunId
  status: Extract<RunDependencyStatus, 'cancelled' | 'timed_out'>
}

/**
 * Persistence-neutral port for run dependency (wait) storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface RunDependencyRepository {
  create: (
    scope: TenantScope,
    input: CreateRunDependencyInput,
  ) => Result<RunDependencyRecord, DomainError>
  getById: (scope: TenantScope, dependencyId: string) => Result<RunDependencyRecord, DomainError>
  listByRunId: (scope: TenantScope, runId: RunId) => Result<RunDependencyRecord[], DomainError>
  listPendingByRunId: (
    scope: TenantScope,
    runId: RunId,
  ) => Result<RunDependencyRecord[], DomainError>
  listPendingAgentByTargetRunId: (
    scope: TenantScope,
    targetRunId: RunId,
  ) => Result<RunDependencyRecord[], DomainError>
  resolve: (
    scope: TenantScope,
    input: ResolveRunDependencyInput,
  ) => Result<RunDependencyRecord, DomainError>
  resolveManyForRun: (
    scope: TenantScope,
    input: ResolveManyRunDependenciesForRunInput,
  ) => Result<number, DomainError>
}
