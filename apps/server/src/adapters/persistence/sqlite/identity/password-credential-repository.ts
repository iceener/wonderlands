import { eq } from 'drizzle-orm'

import { accounts, passwordCredentials } from '../../../../db/schema'
import type {
  PasswordCredentialAuthRecord,
  PasswordCredentialRepository,
  UpsertPasswordCredentialInput,
} from '../../../../domain/identity/password-credential-repository'
import type { DomainError } from '../../../../shared/errors'
import { asAccountId } from '../../../../shared/ids'
import { normalizeAuthEmail } from '../../../../shared/password'
import { err, ok, type Result } from '../../../../shared/result'
import type { RepositoryDatabase } from '../repository-database'

export const createPasswordCredentialRepository = (
  db: RepositoryDatabase,
): PasswordCredentialRepository => ({
  findAuthRecordByEmail: (
    email: string,
  ): Result<PasswordCredentialAuthRecord | null, DomainError> => {
    try {
      const normalizedEmail = normalizeAuthEmail(email)
      const row = db
        .select({
          accountEmail: accounts.email,
          accountId: accounts.id,
          accountName: accounts.name,
          passwordHash: passwordCredentials.passwordHash,
        })
        .from(accounts)
        .innerJoin(passwordCredentials, eq(passwordCredentials.accountId, accounts.id))
        .where(eq(accounts.email, normalizedEmail))
        .get()

      return ok(
        row
          ? {
              account: {
                email: row.accountEmail,
                id: asAccountId(row.accountId),
                name: row.accountName,
              },
              passwordHash: row.passwordHash,
            }
          : null,
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown password credential lookup failure'

      return err({
        message: `failed to resolve password credential by email: ${message}`,
        type: 'conflict',
      })
    }
  },

  upsert: (input: UpsertPasswordCredentialInput): Result<void, DomainError> => {
    try {
      db.insert(passwordCredentials)
        .values({
          accountId: input.accountId,
          createdAt: input.createdAt,
          passwordHash: input.passwordHash,
          updatedAt: input.updatedAt,
        })
        .onConflictDoUpdate({
          set: {
            passwordHash: input.passwordHash,
            updatedAt: input.updatedAt,
          },
          target: passwordCredentials.accountId,
        })
        .run()

      return ok(undefined)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown password credential upsert failure'

      return err({
        message: `failed to upsert password credential for account ${input.accountId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
