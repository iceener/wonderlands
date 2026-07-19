import type { AuthSessionStatus } from '../../shared/auth'
import type { DomainError } from '../../shared/errors'
import type { AccountId, AuthSessionId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { AccountContext } from '../../shared/scope'

export interface AuthSessionAuthRecord {
  account: AccountContext
  createdAt: string
  expiresAt: string
  id: AuthSessionId
  lastUsedAt: string | null
  metadataJson: Record<string, unknown> | null
  revokedAt: string | null
  status: AuthSessionStatus
  updatedAt: string
}

export interface CreateAuthSessionInput {
  accountId: AccountId
  createdAt: string
  expiresAt: string
  hashedSecret: string
  id: AuthSessionId
  metadataJson?: Record<string, unknown> | null
  status: AuthSessionStatus
  updatedAt: string
}

/**
 * Persistence-neutral port for auth session storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface AuthSessionRepository {
  create: (input: CreateAuthSessionInput) => Result<void, DomainError>
  findAuthRecordByHashedSecret: (
    hashedSecret: string,
  ) => Result<AuthSessionAuthRecord | null, DomainError>
  markUsed: (authSessionId: AuthSessionId, usedAt: string) => Result<void, DomainError>
  revoke: (authSessionId: AuthSessionId, revokedAt: string) => Result<void, DomainError>
}
