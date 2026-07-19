import type { DomainError } from '../../shared/errors'
import {
  type AgentId,
  type AgentRevisionId,
  type JobId,
  type RunId,
  type SessionThreadId,
  type TenantId,
  type WorkSessionId,
} from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { JobKind, JobStatus } from './job-types'

export interface JobRecord {
  assignedAgentId: AgentId | null
  assignedAgentRevisionId: AgentRevisionId | null
  completedAt: string | null
  createdAt: string
  currentRunId: RunId | null
  id: JobId
  inputJson: unknown | null
  kind: JobKind
  lastHeartbeatAt: string | null
  lastSchedulerSyncAt: string | null
  nextSchedulerCheckAt: string | null
  parentJobId: JobId | null
  priority: number
  queuedAt: string | null
  resultJson: unknown | null
  rootJobId: JobId
  sessionId: WorkSessionId
  statusReasonJson: unknown | null
  status: JobStatus
  tenantId: TenantId
  threadId: SessionThreadId | null
  title: string
  updatedAt: string
  version: number
}

export interface CreateJobInput {
  assignedAgentId?: AgentId | null
  assignedAgentRevisionId?: AgentRevisionId | null
  completedAt?: string | null
  createdAt: string
  currentRunId?: RunId | null
  id: JobId
  inputJson?: unknown | null
  kind: JobKind
  lastHeartbeatAt?: string | null
  lastSchedulerSyncAt?: string | null
  nextSchedulerCheckAt?: string | null
  parentJobId?: JobId | null
  priority?: number
  queuedAt?: string | null
  resultJson?: unknown | null
  rootJobId: JobId
  sessionId: WorkSessionId
  statusReasonJson?: unknown | null
  status: JobStatus
  threadId: SessionThreadId | null
  title: string
  updatedAt: string
}

export interface UpdateJobInput {
  assignedAgentId?: AgentId | null
  assignedAgentRevisionId?: AgentRevisionId | null
  completedAt?: string | null
  currentRunId?: RunId | null
  inputJson?: unknown | null
  lastHeartbeatAt?: string | null
  lastSchedulerSyncAt?: string | null
  nextSchedulerCheckAt?: string | null
  queuedAt?: string | null
  resultJson?: unknown | null
  statusReasonJson?: unknown | null
  status?: JobStatus
  title?: string
  updatedAt: string
  jobId: JobId
}

/**
 * Persistence-neutral port for job aggregate storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface JobRepository {
  create: (scope: TenantScope, input: CreateJobInput) => Result<JobRecord, DomainError>
  getById: (scope: TenantScope, jobId: JobId) => Result<JobRecord, DomainError>
  listBySessionId: (
    scope: TenantScope,
    sessionId: WorkSessionId,
  ) => Result<JobRecord[], DomainError>
  listByThreadId: (
    scope: TenantScope,
    threadId: SessionThreadId,
  ) => Result<JobRecord[], DomainError>
  update: (scope: TenantScope, input: UpdateJobInput) => Result<JobRecord, DomainError>
}
