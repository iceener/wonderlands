import type { DomainError } from '../../shared/errors'
import type { AccountId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { AccountContext } from '../../shared/scope'

export interface PasswordCredentialAuthRecord {
  account: AccountContext
  passwordHash: string
}

export interface UpsertPasswordCredentialInput {
  accountId: AccountId
  createdAt: string
  passwordHash: string
  updatedAt: string
}

/**
 * Persistence-neutral port for password credential storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface PasswordCredentialRepository {
  findAuthRecordByEmail: (email: string) => Result<PasswordCredentialAuthRecord | null, DomainError>
  upsert: (input: UpsertPasswordCredentialInput) => Result<void, DomainError>
}
