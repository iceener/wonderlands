import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import { and, asc, eq } from 'drizzle-orm'
import type {
  McpStoredOAuthClientInformation,
  McpStoredOAuthTokens,
} from '../../adapters/mcp/stored-oauth'
import { mcpOauthCredentials } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import { type AccountId, asAccountId, asTenantId, type TenantId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

export interface McpOauthCredentialRecord {
  accountId: AccountId
  clientInformationJson: McpStoredOAuthClientInformation | null
  createdAt: string
  discoveryStateJson: OAuthDiscoveryState | null
  id: string
  serverId: string
  tenantId: TenantId
  tokensJson: McpStoredOAuthTokens | null
  updatedAt: string
}

export interface UpsertMcpOauthCredentialInput {
  clientInformationJson?: McpStoredOAuthClientInformation | null
  discoveryStateJson?: OAuthDiscoveryState | null
  id: string
  serverId: string
  tokensJson?: McpStoredOAuthTokens | null
  updatedAt: string
}

const toRecord = (row: typeof mcpOauthCredentials.$inferSelect): McpOauthCredentialRecord => ({
  accountId: asAccountId(row.accountId),
  clientInformationJson: row.clientInformationJson as McpStoredOAuthClientInformation | null,
  createdAt: row.createdAt,
  discoveryStateJson: row.discoveryStateJson as OAuthDiscoveryState | null,
  id: row.id,
  serverId: row.serverId,
  tenantId: asTenantId(row.tenantId),
  tokensJson: row.tokensJson as McpStoredOAuthTokens | null,
  updatedAt: row.updatedAt,
})

export const createMcpOauthCredentialRepository = (db: RepositoryDatabase) => ({
  deleteByServerId: (scope: TenantScope, serverId: string): Result<number, DomainError> => {
    try {
      const result = db
        .delete(mcpOauthCredentials)
        .where(
          and(
            eq(mcpOauthCredentials.tenantId, scope.tenantId),
            eq(mcpOauthCredentials.accountId, scope.accountId),
            eq(mcpOauthCredentials.serverId, serverId),
          ),
        )
        .run()

      return ok(result.changes)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown MCP OAuth credential delete failure'

      return err({
        message: `failed to delete MCP OAuth credentials for server ${serverId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  getByServerId: (
    scope: TenantScope,
    serverId: string,
  ): Result<McpOauthCredentialRecord, DomainError> => {
    const row = db
      .select()
      .from(mcpOauthCredentials)
      .where(
        and(
          eq(mcpOauthCredentials.tenantId, scope.tenantId),
          eq(mcpOauthCredentials.accountId, scope.accountId),
          eq(mcpOauthCredentials.serverId, serverId),
        ),
      )
      .get()

    if (!row) {
      return err({
        message: `MCP OAuth credentials for server ${serverId} were not found`,
        type: 'not_found',
      })
    }

    return ok(toRecord(row))
  },
  listAll: (): Result<McpOauthCredentialRecord[], DomainError> => {
    try {
      const rows = db
        .select()
        .from(mcpOauthCredentials)
        .orderBy(
          asc(mcpOauthCredentials.tenantId),
          asc(mcpOauthCredentials.accountId),
          asc(mcpOauthCredentials.serverId),
          asc(mcpOauthCredentials.id),
        )
        .all()

      return ok(rows.map(toRecord))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown MCP OAuth credential list failure'

      return err({
        message: `failed to list MCP OAuth credentials: ${message}`,
        type: 'conflict',
      })
    }
  },
  upsert: (
    scope: TenantScope,
    input: UpsertMcpOauthCredentialInput,
  ): Result<McpOauthCredentialRecord, DomainError> => {
    try {
      const existing = db
        .select()
        .from(mcpOauthCredentials)
        .where(
          and(
            eq(mcpOauthCredentials.tenantId, scope.tenantId),
            eq(mcpOauthCredentials.accountId, scope.accountId),
            eq(mcpOauthCredentials.serverId, input.serverId),
          ),
        )
        .get()

      if (existing) {
        const clientInformationJson =
          input.clientInformationJson !== undefined
            ? input.clientInformationJson
            : existing.clientInformationJson
        const discoveryStateJson =
          input.discoveryStateJson !== undefined
            ? input.discoveryStateJson
            : existing.discoveryStateJson
        const tokensJson = input.tokensJson !== undefined ? input.tokensJson : existing.tokensJson

        db.update(mcpOauthCredentials)
          .set({
            clientInformationJson,
            discoveryStateJson,
            tokensJson,
            updatedAt: input.updatedAt,
          })
          .where(eq(mcpOauthCredentials.id, existing.id))
          .run()

        return ok(
          toRecord({
            ...existing,
            clientInformationJson,
            discoveryStateJson,
            tokensJson,
            updatedAt: input.updatedAt,
          }),
        )
      }

      const record: McpOauthCredentialRecord = {
        accountId: scope.accountId,
        clientInformationJson: input.clientInformationJson ?? null,
        createdAt: input.updatedAt,
        discoveryStateJson: input.discoveryStateJson ?? null,
        id: input.id,
        serverId: input.serverId,
        tenantId: scope.tenantId,
        tokensJson: input.tokensJson ?? null,
        updatedAt: input.updatedAt,
      }

      db.insert(mcpOauthCredentials)
        .values({
          accountId: record.accountId,
          clientInformationJson: record.clientInformationJson,
          createdAt: record.createdAt,
          discoveryStateJson: record.discoveryStateJson,
          id: record.id,
          serverId: record.serverId,
          tenantId: record.tenantId,
          tokensJson: record.tokensJson,
          updatedAt: record.updatedAt,
        })
        .run()

      return ok(record)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown MCP OAuth credential upsert failure'

      return err({
        message: `failed to upsert MCP OAuth credentials for server ${input.serverId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
