import type { DomainError } from '../../shared/errors'
import type {
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

export type AgentScheduledTaskRunTrigger = 'scheduled' | 'manual'
export type AgentScheduledTaskRunStatus =
  | 'claimed'
  | 'bootstrapping'
  | 'queued'
  | 'failed'
  | 'skipped'

export interface AgentScheduledTaskRunRecord {
  bootstrapCompletedAt: string | null
  bootstrapStartedAt: string | null
  claimedAt: string
  createdAt: string
  errorJson: unknown | null
  id: AgentScheduledTaskRunId
  idempotencyKey: string
  jobId: JobId | null
  messageId: SessionMessageId | null
  runId: RunId | null
  scheduledFor: string
  sessionId: WorkSessionId | null
  status: AgentScheduledTaskRunStatus
  taskId: AgentScheduledTaskId
  tenantId: TenantId
  terminalAt: string | null
  threadId: SessionThreadId | null
  trigger: AgentScheduledTaskRunTrigger
  updatedAt: string
}

export interface ClaimAgentScheduledTaskRunInput {
  claimedAt: string
  id: AgentScheduledTaskRunId
  idempotencyKey: string
  scheduledFor: string
  taskId: AgentScheduledTaskId
  trigger: AgentScheduledTaskRunTrigger
}

/**
 * Persistence-neutral port for agent scheduled task run storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface AgentScheduledTaskRunRepository {
  claim: (
    scope: TenantScope,
    input: ClaimAgentScheduledTaskRunInput,
  ) => Result<AgentScheduledTaskRunRecord | null, DomainError>
  findByIdempotencyKey: (
    scope: TenantScope,
    input: { idempotencyKey: string; taskId: AgentScheduledTaskId },
  ) => Result<AgentScheduledTaskRunRecord | null, DomainError>
  findLatestByTaskId: (
    scope: TenantScope,
    input: { excludeTaskRunId?: AgentScheduledTaskRunId; taskId: AgentScheduledTaskId },
  ) => Result<AgentScheduledTaskRunRecord | null, DomainError>
  getById: (
    scope: TenantScope,
    taskRunId: AgentScheduledTaskRunId,
  ) => Result<AgentScheduledTaskRunRecord, DomainError>
  listByTaskId: (
    scope: TenantScope,
    input: { limit?: number; taskId: AgentScheduledTaskId },
  ) => Result<AgentScheduledTaskRunRecord[], DomainError>
  markBootstrapping: (
    scope: TenantScope,
    input: { bootstrapStartedAt: string; taskRunId: AgentScheduledTaskRunId },
  ) => Result<AgentScheduledTaskRunRecord, DomainError>
  markFailed: (
    scope: TenantScope,
    input: { errorJson: unknown; failedAt: string; taskRunId: AgentScheduledTaskRunId },
  ) => Result<AgentScheduledTaskRunRecord, DomainError>
  markQueued: (
    scope: TenantScope,
    input: {
      bootstrapCompletedAt: string
      jobId: JobId
      messageId: SessionMessageId
      runId: RunId
      sessionId: WorkSessionId
      taskRunId: AgentScheduledTaskRunId
      threadId: SessionThreadId
    },
  ) => Result<AgentScheduledTaskRunRecord, DomainError>
  markSkipped: (
    scope: TenantScope,
    input: { errorJson?: unknown; skippedAt: string; taskRunId: AgentScheduledTaskRunId },
  ) => Result<AgentScheduledTaskRunRecord, DomainError>
}
