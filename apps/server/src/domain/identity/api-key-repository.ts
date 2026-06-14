import { eq } from 'drizzle-orm'

import { accounts, apiKeys } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import { type ApiKeyId, asAccountId, asApiKeyId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { AccountContext } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

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

interface ApiKeyAuthRow {
  accountEmail: string | null
  accountId: string
  accountName: string
  apiKeyCreatedAt: string
  apiKeyExpiresAt: string | null
  apiKeyId: string
  apiKeyLastFour: string
  apiKeyLastUsedAt: string | null
  apiKeyRevokedAt: string | null
  apiKeyScopeJson: Record<string, unknown> | null
  apiKeyStatus: 'active' | 'revoked' | 'expired'
}

const toApiKeyAuthRecord = (authRow: ApiKeyAuthRow): ApiKeyAuthRecord => ({
  account: {
    email: authRow.accountEmail,
    id: asAccountId(authRow.accountId),
    name: authRow.accountName,
  },
  apiKeyId: asApiKeyId(authRow.apiKeyId),
  createdAt: authRow.apiKeyCreatedAt,
  expiresAt: authRow.apiKeyExpiresAt,
  lastFour: authRow.apiKeyLastFour,
  lastUsedAt: authRow.apiKeyLastUsedAt,
  revokedAt: authRow.apiKeyRevokedAt,
  scopeJson: authRow.apiKeyScopeJson,
  status: authRow.apiKeyStatus,
})

export const createApiKeyRepository = (db: RepositoryDatabase) => ({
  findAuthRecordByHashedSecret: (
    hashedSecret: string,
  ): Result<ApiKeyAuthRecord | null, DomainError> => {
    try {
      const authRow = db
        .select({
          accountEmail: accounts.email,
          accountId: accounts.id,
          accountName: accounts.name,
          apiKeyCreatedAt: apiKeys.createdAt,
          apiKeyExpiresAt: apiKeys.expiresAt,
          apiKeyId: apiKeys.id,
          apiKeyLastFour: apiKeys.lastFour,
          apiKeyLastUsedAt: apiKeys.lastUsedAt,
          apiKeyRevokedAt: apiKeys.revokedAt,
          apiKeyScopeJson: apiKeys.scopeJson,
          apiKeyStatus: apiKeys.status,
        })
        .from(apiKeys)
        .innerJoin(accounts, eq(accounts.id, apiKeys.accountId))
        .where(eq(apiKeys.hashedSecret, hashedSecret))
        .get()

      return ok(
        authRow
          ? toApiKeyAuthRecord({
              ...authRow,
              apiKeyScopeJson: authRow.apiKeyScopeJson as Record<string, unknown> | null,
            })
          : null,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown API key lookup failure'

      return err({
        message: `failed to resolve API key auth record: ${message}`,
        type: 'conflict',
      })
    }
  },
  markUsed: (apiKeyId: ApiKeyId, lastUsedAt: string): Result<void, DomainError> => {
    try {
      db.update(apiKeys)
        .set({
          lastUsedAt,
        })
        .where(eq(apiKeys.id, apiKeyId))
        .run()

      return ok(undefined)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown API key usage update failure'

      return err({
        message: `failed to mark API key ${apiKeyId} as used: ${message}`,
        type: 'conflict',
      })
    }
  },
})
