import { eq } from 'drizzle-orm'

import { accounts, authSessions } from '../../../../db/schema'
import type {
  AuthSessionAuthRecord,
  AuthSessionRepository,
  CreateAuthSessionInput,
} from '../../../../domain/identity/auth-session-repository'
import type { AuthSessionStatus } from '../../../../shared/auth'
import type { DomainError } from '../../../../shared/errors'
import { type AuthSessionId, asAccountId, asAuthSessionId } from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { RepositoryDatabase } from '../repository-database'

interface AuthSessionAuthRow {
  accountEmail: string | null
  accountId: string
  accountName: string
  authSessionCreatedAt: string
  authSessionExpiresAt: string
  authSessionId: string
  authSessionLastUsedAt: string | null
  authSessionMetadataJson: Record<string, unknown> | null
  authSessionRevokedAt: string | null
  authSessionStatus: AuthSessionStatus
  authSessionUpdatedAt: string
}

const toAuthSessionAuthRecord = (row: AuthSessionAuthRow): AuthSessionAuthRecord => ({
  account: {
    email: row.accountEmail,
    id: asAccountId(row.accountId),
    name: row.accountName,
  },
  createdAt: row.authSessionCreatedAt,
  expiresAt: row.authSessionExpiresAt,
  id: asAuthSessionId(row.authSessionId),
  lastUsedAt: row.authSessionLastUsedAt,
  metadataJson: row.authSessionMetadataJson,
  revokedAt: row.authSessionRevokedAt,
  status: row.authSessionStatus,
  updatedAt: row.authSessionUpdatedAt,
})

export const createAuthSessionRepository = (db: RepositoryDatabase): AuthSessionRepository => ({
  create: (input: CreateAuthSessionInput): Result<void, DomainError> => {
    try {
      db.insert(authSessions)
        .values({
          accountId: input.accountId,
          createdAt: input.createdAt,
          expiresAt: input.expiresAt,
          hashedSecret: input.hashedSecret,
          id: input.id,
          lastUsedAt: null,
          metadataJson: input.metadataJson ?? null,
          revokedAt: null,
          status: input.status,
          updatedAt: input.updatedAt,
        })
        .run()

      return ok(undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown auth session create failure'

      return err({
        message: `failed to create auth session ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },

  findAuthRecordByHashedSecret: (
    hashedSecret: string,
  ): Result<AuthSessionAuthRecord | null, DomainError> => {
    try {
      const row = db
        .select({
          accountEmail: accounts.email,
          accountId: accounts.id,
          accountName: accounts.name,
          authSessionCreatedAt: authSessions.createdAt,
          authSessionExpiresAt: authSessions.expiresAt,
          authSessionId: authSessions.id,
          authSessionLastUsedAt: authSessions.lastUsedAt,
          authSessionMetadataJson: authSessions.metadataJson,
          authSessionRevokedAt: authSessions.revokedAt,
          authSessionStatus: authSessions.status,
          authSessionUpdatedAt: authSessions.updatedAt,
        })
        .from(authSessions)
        .innerJoin(accounts, eq(accounts.id, authSessions.accountId))
        .where(eq(authSessions.hashedSecret, hashedSecret))
        .get()

      return ok(
        row
          ? toAuthSessionAuthRecord({
              ...row,
              authSessionMetadataJson: row.authSessionMetadataJson as Record<
                string,
                unknown
              > | null,
            })
          : null,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown auth session lookup failure'

      return err({
        message: `failed to resolve auth session: ${message}`,
        type: 'conflict',
      })
    }
  },

  markUsed: (authSessionId: AuthSessionId, usedAt: string): Result<void, DomainError> => {
    try {
      db.update(authSessions)
        .set({
          lastUsedAt: usedAt,
          updatedAt: usedAt,
        })
        .where(eq(authSessions.id, authSessionId))
        .run()

      return ok(undefined)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown auth session usage update failure'

      return err({
        message: `failed to mark auth session ${authSessionId} as used: ${message}`,
        type: 'conflict',
      })
    }
  },

  revoke: (authSessionId: AuthSessionId, revokedAt: string): Result<void, DomainError> => {
    try {
      db.update(authSessions)
        .set({
          revokedAt,
          status: 'revoked',
          updatedAt: revokedAt,
        })
        .where(eq(authSessions.id, authSessionId))
        .run()

      return ok(undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown auth session revoke failure'

      return err({
        message: `failed to revoke auth session ${authSessionId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
