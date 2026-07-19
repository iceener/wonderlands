import { and, asc, eq } from 'drizzle-orm'
import type { RepositoryDatabase } from '../../../../db/repository-database'
import { mcpServers } from '../../../../db/schema'
import type {
  CreateMcpServerInput,
  McpServerRecord,
  McpServerRepository,
  McpStoredServerTransportConfig,
  UpdateMcpServerDiscoveryInput,
  UpdateMcpServerInput,
} from '../../../../domain/mcp/mcp-server-repository'
import type { DomainError } from '../../../../shared/errors'
import { asAccountId, asTenantId } from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'

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
  logLevel: (row.logLevel ?? null) as McpServerRecord['logLevel'],
  tenantId: asTenantId(row.tenantId),
  updatedAt: row.updatedAt,
})

export const createMcpServerRepository = (db: RepositoryDatabase): McpServerRepository => {
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
