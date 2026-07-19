import type { DomainError } from '../../shared/errors'
import type { Result } from '../../shared/result'
import type { WaitTargetKind, WaitType } from '../tooling/tool-vocabulary'
import type { RunRecord } from './run-repository'

export interface PendingWaitReadinessSnapshotRecord {
  ownerRunId: string
  ownerRunStatus: RunRecord['status']
  sessionId: string
  targetRunId: string | null
  tenantId: string
  timeoutAt: string | null
  waitCreatedAt: string
  waitId: string
  waitTargetKind: WaitTargetKind
  waitType: WaitType
}

/**
 * Persistence-neutral read-model port for the scheduler's pending-wait
 * readiness scan. This spans the run-dependency (wait) and run aggregates
 * and is intentionally not tenant-scoped: the scheduler evaluates readiness
 * across every tenant in a single pass. Concrete implementations (e.g. the
 * Drizzle/SQLite adapter) live under `adapters/persistence/sqlite/`. This
 * module must not import anything from `db`, `drizzle-orm`, `application`,
 * or `adapters` -- see `test/architecture-guardrails.test.ts`.
 */
export interface PendingWaitReadinessRepository {
  /** Lists every run dependency (wait) that is still pending, joined with its owning run. */
  listPendingRunDependencySnapshots: () => Result<PendingWaitReadinessSnapshotRecord[], DomainError>
}
