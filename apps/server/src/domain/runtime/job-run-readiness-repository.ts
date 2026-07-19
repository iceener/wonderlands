import type { DomainError } from '../../shared/errors'
import type { Result } from '../../shared/result'
import type { JobStatus } from './job-types'
import type { RunRecord } from './run-repository'

export interface JobRunReadinessSnapshotRecord {
  jobId: string
  jobStatus: JobStatus
  jobUpdatedAt: string
  lastHeartbeatAt: string | null
  lastProgressAt: string | null
  leaseExpiresAt: string | null
  nextSchedulerCheckAt: string | null
  parentRunId: string | null
  priority: number
  queuedAt: string | null
  runCreatedAt: string
  runId: string
  runStatus: RunRecord['status']
  sessionId: string
  statusReasonJson: unknown | null
  tenantId: string
}

/**
 * Persistence-neutral read-model port for the scheduler's job/run readiness
 * scan. This spans the job, run, and run-claim aggregates and is
 * intentionally not tenant-scoped: the scheduler evaluates readiness across
 * every tenant in a single pass. Concrete implementations (e.g. the
 * Drizzle/SQLite adapter) live under `adapters/persistence/sqlite/`. This
 * module must not import anything from `db`, `drizzle-orm`, `application`,
 * or `adapters` -- see `test/architecture-guardrails.test.ts`.
 */
export interface JobRunReadinessRepository {
  /**
   * Lists every job/run pair currently capable of scheduling activity (job
   * status is queued/running/waiting and its current run's status is
   * pending/running/waiting), joined with the run's active claim lease
   * expiry (if any).
   */
  listExecutionCapableJobRunSnapshots: () => Result<JobRunReadinessSnapshotRecord[], DomainError>
}
