import type { DomainError } from '../../shared/errors'
import type { RunId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export interface RunClaimRecord {
  acquiredAt: string
  expiresAt: string
  renewedAt: string
  runId: RunId
  tenantId: TenantId
  workerId: string
}

export interface ClaimRunInput {
  acquiredAt: string
  expiresAt: string
  renewedAt: string
  runId: RunId
  workerId: string
}

export interface HeartbeatRunClaimInput {
  expiresAt: string
  renewedAt: string
  runId: RunId
  workerId: string
}

export interface ReleaseRunClaimInput {
  runId: RunId
  workerId: string
}

/**
 * Persistence-neutral port for worker run-claim storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface RunClaimRepository {
  claim: (scope: TenantScope, input: ClaimRunInput) => Result<RunClaimRecord, DomainError>
  heartbeatClaim: (
    scope: TenantScope,
    input: HeartbeatRunClaimInput,
  ) => Result<RunClaimRecord, DomainError>
  releaseClaim: (scope: TenantScope, input: ReleaseRunClaimInput) => Result<null, DomainError>
}
