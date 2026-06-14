import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js'
import { and, asc, eq } from 'drizzle-orm'
import { revealStoredHttpAuthConfig } from '../../adapters/mcp/stored-auth'
import type { McpServerConfig, McpWorkspaceScope } from '../../adapters/mcp/types'
import { mcpServers } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import { type AccountId, asAccountId, asTenantId, type TenantId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { EncryptedSecret } from '../../shared/secret-box'
import type { RepositoryDatabase } from '../database-port'

type McpStoredSecretValue = EncryptedSecret | string | null

export type McpStoredHttpAuthConfig =
  | {
      kind: 'none'
    }
  | {
      kind: 'bearer'
      token: McpStoredSecretValue
    }
  | {
      clientId: string | null
      clientName: string | null
      clientSecret: McpStoredSecretValue
      kind: 'oauth_authorization_code'
      resource: string | null
      resourceMetadataUrl: string | null
      scope: string | null
      tokenEndpointAuthMethod: string | null
    }
  | {
      clientId: string
      clientSecret: McpStoredSecretValue
      kind: 'oauth_client_credentials'
      resource: string | null
      resourceMetadataUrl: string | null
      scope: string | null
    }
  | {
      algorithm: string
      clientId: string
      kind: 'oauth_private_key_jwt'
      privateKey: McpStoredSecretValue
      resource: string | null
      resourceMetadataUrl: string | null
      scope: string | null
    }
  | {
      assertion: McpStoredSecretValue
      clientId: string
      kind: 'oauth_static_private_key_jwt'
      resource: string | null
      resourceMetadataUrl: string | null
      scope: string | null
    }

export type McpStoredServerTransportConfig =
  | {
      args?: string[]
      command: string
      cwd?: string
      env?: Record<string, string>
      stderr?: 'inherit' | 'pipe'
      workspaceScoped?: McpWorkspaceScope
    }
  | {
      auth: McpStoredHttpAuthConfig
      headers?: Record<string, string>
      url: string
    }

export interface McpServerRecord {
  config: McpStoredServerTransportConfig
  createdAt: string
  createdByAccountId: AccountId
  enabled: boolean
  id: string
  kind: McpServerConfig['kind']
  label: string
  lastDiscoveredAt: string | null
  lastError: string | null
  logLevel: LoggingLevel | null
  tenantId: TenantId
  updatedAt: string
}

export interface CreateMcpServerInput {
  config: McpStoredServerTransportConfig
  createdAt: string
  enabled?: boolean
  id: string
  kind: McpServerConfig['kind']
  label: string
  logLevel?: LoggingLevel | null
  updatedAt: string
}

export interface UpdateMcpServerDiscoveryInput {
  id: string
  lastDiscoveredAt?: string | null
  lastError?: string | null
  updatedAt: string
}

export interface UpdateMcpServerInput {
  config: McpStoredServerTransportConfig
  enabled?: boolean
  id: string
  kind: McpServerConfig['kind']
  label: string
  logLevel?: LoggingLevel | null
  updatedAt: string
}

const toMcpServerRecord = (row: typeof mcpServers.$inferSelect): McpServerRecord => ({
  config: row.configJson as McpStoredServerTransportConfig,
  createdAt: row.createdAt,
  createdByAccountId: asAccountId(row.createdByAccountId),
  enabled: row.enabled,
  id: row.id,
  kind: row.kind,
  label: row.label,
  lastDiscoveredAt: row.lastDiscoveredAt,
  lastError: row.lastError,
  logLevel: (row.logLevel ?? null) as LoggingLevel | null,
  tenantId: asTenantId(row.tenantId),
  updatedAt: row.updatedAt,
})

export const toMcpServerConfig = (
  record: McpServerRecord,
  encryptionKey: string | null = null,
): McpServerConfig => {
  if (record.kind === 'stdio') {
    const config = record.config as Extract<McpStoredServerTransportConfig, { command: string }>

    return {
      args: config.args,
      command: config.command,
      cwd: config.cwd,
      enabled: record.enabled,
      env: config.env,
      id: record.id,
      kind: 'stdio',
      logLevel: record.logLevel ?? undefined,
      stderr: config.stderr,
      toolPrefix: record.label,
      workspaceScoped: config.workspaceScoped,
    }
  }

  const config = record.config as Extract<McpStoredServerTransportConfig, { url: string }>

  return {
    auth: revealStoredHttpAuthConfig(config.auth, encryptionKey),
    enabled: record.enabled,
    headers: config.headers,
    id: record.id,
    kind: 'streamable_http',
    logLevel: record.logLevel ?? undefined,
    toolPrefix: record.label,
    url: config.url,
  }
}

export const createMcpServerRepository = (db: RepositoryDatabase) => {
  const getById = (scope: TenantScope, serverId: string): Result<McpServerRecord, DomainError> => {
    const row = db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.tenantId, scope.tenantId)))
      .get()

    if (!row) {
      return err({
        message: `MCP server ${serverId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    if (row.createdByAccountId !== scope.accountId) {
      return err({
        message: `MCP server ${serverId} is not available for account ${scope.accountId}`,
        type: 'permission',
      })
    }

    return ok(toMcpServerRecord(row))
  }

  return {
    create: (
      scope: TenantScope,
      input: CreateMcpServerInput,
    ): Result<McpServerRecord, DomainError> => {
      try {
        const record: McpServerRecord = {
          config: input.config,
          createdAt: input.createdAt,
          createdByAccountId: scope.accountId,
          enabled: input.enabled ?? true,
          id: input.id,
          kind: input.kind,
          label: input.label,
          lastDiscoveredAt: null,
          lastError: null,
          logLevel: input.logLevel ?? null,
          tenantId: scope.tenantId,
          updatedAt: input.updatedAt,
        }

        db.insert(mcpServers)
          .values({
            configJson: record.config,
            createdAt: record.createdAt,
            createdByAccountId: record.createdByAccountId,
            enabled: record.enabled,
            id: record.id,
            kind: record.kind,
            label: record.label,
            lastDiscoveredAt: record.lastDiscoveredAt,
            lastError: record.lastError,
            logLevel: record.logLevel,
            tenantId: record.tenantId,
            updatedAt: record.updatedAt,
          })
          .run()

        return ok(record)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown MCP server create failure'

        return err({
          message: `failed to create MCP server ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    delete: (scope: TenantScope, serverId: string): Result<McpServerRecord, DomainError> => {
      try {
        const existing = getById(scope, serverId)

        if (!existing.ok) {
          return existing
        }

        const result = db
          .delete(mcpServers)
          .where(
            and(
              eq(mcpServers.id, serverId),
              eq(mcpServers.tenantId, scope.tenantId),
              eq(mcpServers.createdByAccountId, scope.accountId),
            ),
          )
          .run()

        if (result.changes === 0) {
          return err({
            message: `MCP server ${serverId} could not be deleted`,
            type: 'conflict',
          })
        }

        return ok(existing.value)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown MCP server delete failure'

        return err({
          message: `failed to delete MCP server ${serverId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getById,
    listByAccount: (scope: TenantScope): Result<McpServerRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(mcpServers)
          .where(
            and(
              eq(mcpServers.tenantId, scope.tenantId),
              eq(mcpServers.createdByAccountId, scope.accountId),
            ),
          )
          .orderBy(asc(mcpServers.label), asc(mcpServers.id))
          .all()

        return ok(rows.map(toMcpServerRecord))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown MCP server list failure'

        return err({
          message: `failed to list MCP servers for account ${scope.accountId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    listEnabledForGateway: (): Result<McpServerRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(mcpServers)
          .where(eq(mcpServers.enabled, true))
          .orderBy(asc(mcpServers.createdAt), asc(mcpServers.id))
          .all()

        return ok(rows.map(toMcpServerRecord))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown gateway MCP list failure'

        return err({
          message: `failed to list enabled MCP servers: ${message}`,
          type: 'conflict',
        })
      }
    },
    update: (
      scope: TenantScope,
      input: UpdateMcpServerInput,
    ): Result<McpServerRecord, DomainError> => {
      try {
        const existing = getById(scope, input.id)

        if (!existing.ok) {
          return existing
        }

        const result = db
          .update(mcpServers)
          .set({
            configJson: input.config,
            enabled: input.enabled ?? existing.value.enabled,
            kind: input.kind,
            label: input.label,
            logLevel: input.logLevel ?? null,
            updatedAt: input.updatedAt,
          })
          .where(
            and(
              eq(mcpServers.id, input.id),
              eq(mcpServers.tenantId, scope.tenantId),
              eq(mcpServers.createdByAccountId, scope.accountId),
            ),
          )
          .run()

        if (result.changes === 0) {
          return err({
            message: `MCP server ${input.id} could not be updated`,
            type: 'conflict',
          })
        }

        return getById(scope, input.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown MCP server update failure'

        return err({
          message: `failed to update MCP server ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    updateDiscovery: (
      scope: TenantScope,
      input: UpdateMcpServerDiscoveryInput,
    ): Result<McpServerRecord, DomainError> => {
      try {
        const result = db
          .update(mcpServers)
          .set({
            lastDiscoveredAt: input.lastDiscoveredAt ?? null,
            lastError: input.lastError ?? null,
            updatedAt: input.updatedAt,
          })
          .where(
            and(
              eq(mcpServers.id, input.id),
              eq(mcpServers.tenantId, scope.tenantId),
              eq(mcpServers.createdByAccountId, scope.accountId),
            ),
          )
          .run()

        if (result.changes === 0) {
          return err({
            message: `MCP server ${input.id} could not be updated`,
            type: 'conflict',
          })
        }

        return getById(scope, input.id)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown MCP discovery update failure'

        return err({
          message: `failed to update MCP server ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
  }
}
