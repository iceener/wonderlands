import type { DomainError } from '../../shared/errors'
import type { ApiKeyId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { AccountContext } from '../../shared/scope'

export interface ApiKeyAuthRecord {
  account: AccountContext
  apiKeyId: ApiKeyId
  createdAt: string
  expiresAt: string | null
  lastFour: string
  lastUsedAt: string | null
  revokedAt: string | null
  scopeJson: Record<string, unknown> | null
  status: 'active' | 'revoked' | 'expired'
}

/**
 * Persistence-neutral port for API key auth storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface ApiKeyRepository {
  findAuthRecordByHashedSecret: (
    hashedSecret: string,
  ) => Result<ApiKeyAuthRecord | null, DomainError>
  markUsed: (apiKeyId: ApiKeyId, lastUsedAt: string) => Result<void, DomainError>
}
