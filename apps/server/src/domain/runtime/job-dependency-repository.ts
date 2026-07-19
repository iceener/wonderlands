import type { DomainError } from '../../shared/errors'
import type {
  JobDependencyId,
  JobId,
  TenantId,
  WorkSessionId,
} from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { JobDependencyType, JobStatus } from './job-types'

export interface JobDependencyRecord {
  createdAt: string
  fromJobId: JobId
  id: JobDependencyId
  metadataJson: unknown | null
  sessionId: WorkSessionId
  tenantId: TenantId
  toJobId: JobId
  type: JobDependencyType
}

export interface CreateJobDependencyInput {
  createdAt: string
  fromJobId: JobId
  id: JobDependencyId
  metadataJson?: unknown | null
  sessionId: WorkSessionId
  toJobId: JobId
  type: JobDependencyType
}

export interface JobDependencyTargetStatus {
  metadataJson: unknown | null
  toJobStatus: JobStatus
}

/**
 * Persistence-neutral port for job dependency storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface JobDependencyRepository {
  create: (
    scope: TenantScope,
    input: CreateJobDependencyInput,
  ) => Result<JobDependencyRecord, DomainError>
  listByFromJobId: (scope: TenantScope, jobId: JobId) => Result<JobDependencyRecord[], DomainError>
  listByToJobId: (scope: TenantScope, jobId: JobId) => Result<JobDependencyRecord[], DomainError>
  /**
   * Lists the target-job status for every outgoing dependency edge of the
   * given type from `fromJobId`, joined against the target job's current
   * status. Used by scheduling readiness to evaluate whether a job's
   * dependencies are satisfied without pulling every dependency record and
   * re-querying each target job individually.
   */
  listDependencyTargetStatuses: (
    scope: TenantScope,
    input: { fromJobId: JobId; type: JobDependencyType },
  ) => Result<JobDependencyTargetStatus[], DomainError>
}
