import { and, eq, lt } from 'drizzle-orm'
import { mcpOauthAuthorizations } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import { type AccountId, asAccountId, asTenantId, type TenantId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { EncryptedSecret } from '../../shared/secret-box'
import type { RepositoryDatabase } from '../database-port'

export interface McpOauthAuthorizationRecord {
  accountId: AccountId
  codeVerifierSecretJson: EncryptedSecret | null
  createdAt: string
  expiresAt: string
  id: string
  redirectUri: string
  responseOrigin: string | null
  serverId: string
  tenantId: TenantId
  updatedAt: string
}

export interface UpsertMcpOauthAuthorizationInput {
  codeVerifierSecretJson?: EncryptedSecret | null
  expiresAt: string
  id: string
  redirectUri: string
  responseOrigin?: string | null
  serverId: string
  updatedAt: string
}

const toRecord = (
  row: typeof mcpOauthAuthorizations.$inferSelect,
): McpOauthAuthorizationRecord => ({
  accountId: asAccountId(row.accountId),
  codeVerifierSecretJson: row.codeVerifierSecretJson,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  id: row.id,
  redirectUri: row.redirectUri,
  responseOrigin: row.responseOrigin,
  serverId: row.serverId,
  tenantId: asTenantId(row.tenantId),
  updatedAt: row.updatedAt,
})

export const createMcpOauthAuthorizationRepository = (db: RepositoryDatabase) => ({
  deleteExpired: (nowIso: string): Result<number, DomainError> => {
    try {
      const result = db
        .delete(mcpOauthAuthorizations)
        .where(lt(mcpOauthAuthorizations.expiresAt, nowIso))
        .run()

      return ok(result.changes)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown MCP OAuth authorization cleanup failure'

      return err({
        message: `failed to delete expired MCP OAuth authorizations: ${message}`,
        type: 'conflict',
      })
    }
  },
  deleteById: (id: string): Result<{ id: string }, DomainError> => {
    try {
      db.delete(mcpOauthAuthorizations).where(eq(mcpOauthAuthorizations.id, id)).run()

      return ok({ id })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown MCP OAuth authorization delete failure'

      return err({
        message: `failed to delete MCP OAuth authorization ${id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  getById: (id: string): Result<McpOauthAuthorizationRecord, DomainError> => {
    const row = db
      .select()
      .from(mcpOauthAuthorizations)
      .where(eq(mcpOauthAuthorizations.id, id))
      .get()

    if (!row) {
      return err({
        message: `MCP OAuth authorization ${id} was not found`,
        type: 'not_found',
      })
    }

    return ok(toRecord(row))
  },
  getByServerId: (
    scope: TenantScope,
    serverId: string,
  ): Result<McpOauthAuthorizationRecord, DomainError> => {
    const row = db
      .select()
      .from(mcpOauthAuthorizations)
      .where(
        and(
          eq(mcpOauthAuthorizations.tenantId, scope.tenantId),
          eq(mcpOauthAuthorizations.accountId, scope.accountId),
          eq(mcpOauthAuthorizations.serverId, serverId),
        ),
      )
      .get()

    if (!row) {
      return err({
        message: `MCP OAuth authorization for server ${serverId} was not found`,
        type: 'not_found',
      })
    }

    return ok(toRecord(row))
  },
  upsert: (
    scope: TenantScope,
    input: UpsertMcpOauthAuthorizationInput,
  ): Result<McpOauthAuthorizationRecord, DomainError> => {
    try {
      const existing = db
        .select()
        .from(mcpOauthAuthorizations)
        .where(
          and(
            eq(mcpOauthAuthorizations.tenantId, scope.tenantId),
            eq(mcpOauthAuthorizations.accountId, scope.accountId),
            eq(mcpOauthAuthorizations.serverId, input.serverId),
          ),
        )
        .get()

      if (existing) {
        const codeVerifierSecretJson =
          input.codeVerifierSecretJson !== undefined
            ? input.codeVerifierSecretJson
            : existing.codeVerifierSecretJson
        const responseOrigin =
          input.responseOrigin !== undefined ? input.responseOrigin : existing.responseOrigin

        db.update(mcpOauthAuthorizations)
          .set({
            codeVerifierSecretJson,
            expiresAt: input.expiresAt,
            id: input.id,
            redirectUri: input.redirectUri,
            responseOrigin,
            updatedAt: input.updatedAt,
          })
          .where(eq(mcpOauthAuthorizations.id, existing.id))
          .run()

        return ok(
          toRecord({
            ...existing,
            codeVerifierSecretJson,
            expiresAt: input.expiresAt,
            id: input.id,
            redirectUri: input.redirectUri,
            responseOrigin,
            updatedAt: input.updatedAt,
          }),
        )
      }

      const record: McpOauthAuthorizationRecord = {
        accountId: scope.accountId,
        codeVerifierSecretJson: input.codeVerifierSecretJson ?? null,
        createdAt: input.updatedAt,
        expiresAt: input.expiresAt,
        id: input.id,
        redirectUri: input.redirectUri,
        responseOrigin: input.responseOrigin ?? null,
        serverId: input.serverId,
        tenantId: scope.tenantId,
        updatedAt: input.updatedAt,
      }

      db.insert(mcpOauthAuthorizations)
        .values({
          accountId: record.accountId,
          codeVerifierSecretJson: record.codeVerifierSecretJson,
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
          id: record.id,
          redirectUri: record.redirectUri,
          responseOrigin: record.responseOrigin,
          serverId: record.serverId,
          tenantId: record.tenantId,
          updatedAt: record.updatedAt,
        })
        .run()

      return ok(record)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown MCP OAuth authorization upsert failure'

      return err({
        message: `failed to upsert MCP OAuth authorization for server ${input.serverId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
