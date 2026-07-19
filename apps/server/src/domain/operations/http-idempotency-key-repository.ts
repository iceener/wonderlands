import type { DomainError } from '../../shared/errors'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export type HttpIdempotencyStatus = 'in_progress' | 'completed'

export interface HttpIdempotencyKeyRecord {
  completedAt: string | null
  createdAt: string
  expiresAt: string | null
  id: string
  idempotencyKey: string
  requestHash: string
  responseDataJson: unknown | null
  scope: string
  status: HttpIdempotencyStatus
  statusCode: number | null
  tenantId: string
  updatedAt: string
}

export interface BeginIdempotencyRequestInput {
  expiresAt: string
  idempotencyKey: string
  now: string
  requestHash: string
  scope: string
}

export interface CompleteIdempotencyRequestInput {
  completedAt: string
  id: string
  responseDataJson: unknown
  statusCode: number
  updatedAt: string
}

export interface RecordIdempotencyProgressInput {
  id: string
  responseDataJson: unknown
  updatedAt: string
}

export interface GetIdempotencyKeyInput {
  idempotencyKey: string
  scope: string
}

export interface AbandonIdempotencyKeyInput {
  id: string
}

export type BeginIdempotencyRequestResult =
  | {
      kind: 'execute'
      record: HttpIdempotencyKeyRecord
    }
  | {
      kind: 'replay'
      record: HttpIdempotencyKeyRecord
    }

/**
 * Persistence-neutral port for HTTP idempotency key storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface HttpIdempotencyKeyRepository {
  abandon: (scope: TenantScope, input: AbandonIdempotencyKeyInput) => Result<null, DomainError>
  begin: (
    scope: TenantScope,
    input: BeginIdempotencyRequestInput,
  ) => Result<BeginIdempotencyRequestResult, DomainError>
  complete: (
    scope: TenantScope,
    input: CompleteIdempotencyRequestInput,
  ) => Result<HttpIdempotencyKeyRecord, DomainError>
  getByKey: (
    scope: TenantScope,
    input: GetIdempotencyKeyInput,
  ) => Result<HttpIdempotencyKeyRecord | null, DomainError>
  recordProgress: (
    scope: TenantScope,
    input: RecordIdempotencyProgressInput,
  ) => Result<HttpIdempotencyKeyRecord, DomainError>
}
