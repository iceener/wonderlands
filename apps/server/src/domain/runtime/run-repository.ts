import type { DomainError } from '../../shared/errors'
import {
  type AccountId,
  type AgentId,
  type AgentRevisionId,
  type JobId,
  type RunId,
  type SessionThreadId,
  type TenantId,
  type ToolProfileId,
  type WorkSessionId,
  type WorkspaceId,
} from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export interface RunRecord {
  actorAccountId: AccountId | null
  agentId: AgentId | null
  agentRevisionId: AgentRevisionId | null
  completedAt: string | null
  configSnapshot: Record<string, unknown>
  createdAt: string
  errorJson: unknown | null
  id: RunId
  lastProgressAt: string | null
  parentRunId: RunId | null
  resultJson: unknown | null
  rootRunId: RunId
  sessionId: WorkSessionId
  sourceCallId: string | null
  staleRecoveryCount: number
  startedAt: string | null
  status: 'pending' | 'running' | 'cancelling' | 'waiting' | 'completed' | 'failed' | 'cancelled'
  task: string
  tenantId: TenantId
  targetKind: 'assistant' | 'agent'
  threadId: SessionThreadId | null
  toolProfileId: ToolProfileId | null
  turnCount: number
  updatedAt: string
  version: number
  jobId: JobId | null
  workspaceId: WorkspaceId | null
  workspaceRef: string | null
}

export interface CreateRunInput {
  actorAccountId?: AccountId | null
  agentId?: AgentId | null
  agentRevisionId?: AgentRevisionId | null
  configSnapshot: Record<string, unknown>
  createdAt: string
  id: RunId
  parentRunId?: RunId | null
  resultJson?: unknown | null
  rootRunId: RunId
  sessionId: WorkSessionId
  sourceCallId?: string | null
  startedAt: string
  task: string
  targetKind?: RunRecord['targetKind']
  threadId: SessionThreadId | null
  toolProfileId?: ToolProfileId | null
  jobId?: JobId | null
  workspaceId?: WorkspaceId | null
  workspaceRef: string | null
}

export interface UpdateRunStartInput {
  configSnapshot: Record<string, unknown>
  expectedStatus: RunRecord['status']
  expectedVersion: number
  lastProgressAt: string
  runId: RunId
  startedAt: string
  updatedAt: string
}

export interface UpdateRunConfigSnapshotInput {
  configSnapshot: Record<string, unknown>
  expectedStatus: RunRecord['status']
  expectedVersion: number
  runId: RunId
  updatedAt: string
}

export interface CompleteRunInput {
  completedAt: string
  expectedStatus: RunRecord['status']
  expectedVersion: number
  lastProgressAt: string
  resultJson: unknown
  runId: RunId
  turnCount: number
  updatedAt: string
}

export interface WaitRunInput {
  expectedStatus: RunRecord['status']
  expectedVersion: number
  lastProgressAt: string
  resultJson: unknown
  runId: RunId
  updatedAt: string
}

export interface RefreshWaitingRunInput {
  expectedStatus: Extract<RunRecord['status'], 'waiting'>
  expectedVersion: number
  lastProgressAt: string
  resultJson: unknown
  runId: RunId
  updatedAt: string
}

export interface RequeueRunInput {
  expectedStatus: Extract<RunRecord['status'], 'running'>
  expectedVersion: number
  lastProgressAt: string
  resultJson?: unknown
  runId: RunId
  staleRecoveryCount?: number
  updatedAt: string
}

export interface CancelRunInput {
  completedAt: string
  expectedStatus: RunRecord['status']
  expectedVersion: number
  lastProgressAt: string
  resultJson: unknown
  runId: RunId
  updatedAt: string
}

export interface MarkRunCancellingInput {
  expectedStatus: Extract<RunRecord['status'], 'running'>
  expectedVersion: number
  lastProgressAt: string
  resultJson: unknown
  runId: RunId
  updatedAt: string
}

export interface FailRunInput {
  completedAt: string
  errorJson: unknown
  expectedStatus: RunRecord['status']
  expectedVersion: number
  lastProgressAt: string
  resultJson?: unknown
  runId: RunId
  turnCount: number
  updatedAt: string
}

/**
 * Persistence-neutral port for run aggregate storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface RunRepository {
  complete: (scope: TenantScope, input: CompleteRunInput) => Result<RunRecord, DomainError>
  cancel: (scope: TenantScope, input: CancelRunInput) => Result<RunRecord, DomainError>
  create: (scope: TenantScope, input: CreateRunInput) => Result<RunRecord, DomainError>
  fail: (scope: TenantScope, input: FailRunInput) => Result<RunRecord, DomainError>
  getById: (scope: TenantScope, runId: RunId) => Result<RunRecord, DomainError>
  listActiveByThreadId: (
    scope: TenantScope,
    threadId: SessionThreadId,
  ) => Result<RunRecord[], DomainError>
  listByThreadId: (
    scope: TenantScope,
    threadId: SessionThreadId,
  ) => Result<RunRecord[], DomainError>
  listByParentRunId: (scope: TenantScope, parentRunId: RunId) => Result<RunRecord[], DomainError>
  markRunning: (scope: TenantScope, input: UpdateRunStartInput) => Result<RunRecord, DomainError>
  markPending: (scope: TenantScope, input: RequeueRunInput) => Result<RunRecord, DomainError>
  markCancelling: (
    scope: TenantScope,
    input: MarkRunCancellingInput,
  ) => Result<RunRecord, DomainError>
  updateConfigSnapshot: (
    scope: TenantScope,
    input: UpdateRunConfigSnapshotInput,
  ) => Result<RunRecord, DomainError>
  markWaiting: (scope: TenantScope, input: WaitRunInput) => Result<RunRecord, DomainError>
  refreshWaiting: (
    scope: TenantScope,
    input: RefreshWaitingRunInput,
  ) => Result<RunRecord, DomainError>
}
