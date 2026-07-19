import type { DomainError } from '../../shared/errors'
import type {
  AccountId,
  AgentId,
  AgentScheduledTaskId,
  AgentScheduledTaskRunId,
  JobId,
  RunId,
  SessionMessageId,
  SessionThreadId,
  TenantId,
  WorkSessionId,
} from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export type AgentScheduledTaskStatus = 'active' | 'paused' | 'archived' | 'deleted'
export type AgentScheduledTaskOverlapPolicy = 'skip'

export interface AgentScheduledTaskRecord {
  agentId: AgentId
  archivedAt: string | null
  content: string
  createdAt: string
  createdByAccountId: AccountId
  cronExpression: string
  deletedAt: string | null
  description: string | null
  id: AgentScheduledTaskId
  lastAttemptId: AgentScheduledTaskRunId | null
  lastErrorJson: unknown | null
  lastJobId: JobId | null
  lastMessageId: SessionMessageId | null
  lastRunAt: string | null
  lastRunId: RunId | null
  lastSessionId: WorkSessionId | null
  lastThreadId: SessionThreadId | null
  name: string
  nextRunAt: string | null
  overlapPolicy: AgentScheduledTaskOverlapPolicy
  ownerAccountId: AccountId
  pausedAt: string | null
  status: AgentScheduledTaskStatus
  tenantId: TenantId
  timezone: string
  updatedAt: string
  updatedByAccountId: AccountId
  version: number
}

export interface CreateAgentScheduledTaskRecordInput {
  agentId: AgentId
  content: string
  createdAt: string
  cronExpression: string
  description: string | null
  id: AgentScheduledTaskId
  name: string
  nextRunAt: string | null
  overlapPolicy: AgentScheduledTaskOverlapPolicy
  ownerAccountId: AccountId
  status: Extract<AgentScheduledTaskStatus, 'active' | 'paused'>
  timezone: string
}

export interface UpdateAgentScheduledTaskRecordInput {
  agentId?: AgentId
  archivedAt?: string | null
  content?: string
  cronExpression?: string
  deletedAt?: string | null
  description?: string | null
  expectedVersion: number
  lastErrorJson?: unknown | null
  name?: string
  nextRunAt?: string | null
  pausedAt?: string | null
  status?: AgentScheduledTaskStatus
  taskId: AgentScheduledTaskId
  timezone?: string
  updatedAt: string
  updatedByAccountId: AccountId
}

export interface UpdateAgentScheduledTaskPointersInput {
  lastAttemptId: AgentScheduledTaskRunId
  lastErrorJson?: unknown | null
  lastJobId?: JobId | null
  lastMessageId?: SessionMessageId | null
  lastRunAt: string
  lastRunId?: RunId | null
  lastSessionId?: WorkSessionId | null
  lastThreadId?: SessionThreadId | null
  nextRunAt?: string | null
  taskId: AgentScheduledTaskId
  updatedAt: string
}

/**
 * Persistence-neutral port for agent scheduled task storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface AgentScheduledTaskRepository {
  create: (
    scope: TenantScope,
    input: CreateAgentScheduledTaskRecordInput,
  ) => Result<AgentScheduledTaskRecord, DomainError>
  getById: (
    scope: TenantScope,
    taskId: AgentScheduledTaskId,
  ) => Result<AgentScheduledTaskRecord, DomainError>
  getOwnedById: (
    scope: TenantScope,
    taskId: AgentScheduledTaskId,
  ) => Result<AgentScheduledTaskRecord, DomainError>
  listDueTasks: (input: {
    limit: number
    now: string
  }) => Result<AgentScheduledTaskRecord[], DomainError>
  listOwnerTasks: (
    scope: TenantScope,
    filters?: {
      agentId?: AgentId
      status?: AgentScheduledTaskStatus
    },
  ) => Result<AgentScheduledTaskRecord[], DomainError>
  update: (
    scope: TenantScope,
    input: UpdateAgentScheduledTaskRecordInput,
  ) => Result<AgentScheduledTaskRecord, DomainError>
  updateLatestPointers: (
    scope: TenantScope,
    input: UpdateAgentScheduledTaskPointersInput,
  ) => Result<AgentScheduledTaskRecord, DomainError>
}
