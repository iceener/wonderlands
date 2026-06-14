import { and, asc, eq } from 'drizzle-orm'
import type { McpAppsToolMeta } from '../../adapters/mcp/types'
import { mcpToolCache } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import { asTenantId, type TenantId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

export interface McpToolCacheRecord {
  appsMetaJson: McpAppsToolMeta | null
  createdAt: string
  description: string | null
  executionJson: Record<string, unknown> | null
  fingerprint: string
  id: string
  inputSchemaJson: Record<string, unknown>
  isActive: boolean
  modelVisible: boolean
  outputSchemaJson: Record<string, unknown> | null
  remoteName: string
  runtimeName: string
  serverId: string
  tenantId: TenantId
  title: string | null
  updatedAt: string
}

export interface UpsertMcpToolCacheInput {
  appsMetaJson?: McpAppsToolMeta | null
  description?: string | null
  executionJson?: Record<string, unknown> | null
  fingerprint: string
  id: string
  inputSchemaJson: Record<string, unknown>
  isActive?: boolean
  modelVisible: boolean
  outputSchemaJson?: Record<string, unknown> | null
  remoteName: string
  runtimeName: string
  serverId: string
  title?: string | null
  updatedAt: string
}

const toMcpToolCacheRecord = (row: typeof mcpToolCache.$inferSelect): McpToolCacheRecord => ({
  appsMetaJson: row.appsMetaJson as McpAppsToolMeta | null,
  createdAt: row.createdAt,
  description: row.description,
  executionJson: row.executionJson as Record<string, unknown> | null,
  fingerprint: row.fingerprint,
  id: row.id,
  inputSchemaJson: row.inputSchemaJson as Record<string, unknown>,
  isActive: row.isActive,
  modelVisible: row.modelVisible,
  outputSchemaJson: row.outputSchemaJson as Record<string, unknown> | null,
  remoteName: row.remoteName,
  runtimeName: row.runtimeName,
  serverId: row.serverId,
  tenantId: asTenantId(row.tenantId),
  title: row.title,
  updatedAt: row.updatedAt,
})

export const createMcpToolCacheRepository = (db: RepositoryDatabase) => ({
  deleteByServerId: (scope: TenantScope, serverId: string): Result<number, DomainError> => {
    try {
      const result = db
        .delete(mcpToolCache)
        .where(and(eq(mcpToolCache.tenantId, scope.tenantId), eq(mcpToolCache.serverId, serverId)))
        .run()

      return ok(result.changes)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown MCP tool cache delete failure'

      return err({
        message: `failed to delete cached MCP tools for server ${serverId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listByServerId: (
    scope: TenantScope,
    serverId: string,
  ): Result<McpToolCacheRecord[], DomainError> => {
    try {
      const rows = db
        .select()
        .from(mcpToolCache)
        .where(
          and(
            eq(mcpToolCache.tenantId, scope.tenantId),
            eq(mcpToolCache.serverId, serverId),
            eq(mcpToolCache.isActive, true),
          ),
        )
        .orderBy(asc(mcpToolCache.runtimeName), asc(mcpToolCache.id))
        .all()

      return ok(rows.map(toMcpToolCacheRecord))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown MCP tool cache list failure'

      return err({
        message: `failed to list cached MCP tools for server ${serverId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  markInactiveByServerId: (
    tenantId: TenantId,
    serverId: string,
    updatedAt: string,
  ): Result<number, DomainError> => {
    try {
      const result = db
        .update(mcpToolCache)
        .set({
          isActive: false,
          updatedAt,
        })
        .where(and(eq(mcpToolCache.tenantId, tenantId), eq(mcpToolCache.serverId, serverId)))
        .run()

      return ok(result.changes)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown MCP cache inactivation failure'

      return err({
        message: `failed to mark cached MCP tools inactive for server ${serverId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  upsertForTenant: (
    tenantId: TenantId,
    input: UpsertMcpToolCacheInput,
  ): Result<McpToolCacheRecord, DomainError> => {
    try {
      const existing = db
        .select()
        .from(mcpToolCache)
        .where(
          and(
            eq(mcpToolCache.tenantId, tenantId),
            eq(mcpToolCache.serverId, input.serverId),
            eq(mcpToolCache.remoteName, input.remoteName),
          ),
        )
        .get()

      if (existing) {
        db.update(mcpToolCache)
          .set({
            appsMetaJson: input.appsMetaJson ?? null,
            description: input.description ?? null,
            executionJson: input.executionJson ?? null,
            fingerprint: input.fingerprint,
            inputSchemaJson: input.inputSchemaJson,
            isActive: input.isActive ?? true,
            modelVisible: input.modelVisible,
            outputSchemaJson: input.outputSchemaJson ?? null,
            runtimeName: input.runtimeName,
            title: input.title ?? null,
            updatedAt: input.updatedAt,
          })
          .where(and(eq(mcpToolCache.id, existing.id), eq(mcpToolCache.tenantId, tenantId)))
          .run()

        return ok(
          toMcpToolCacheRecord({
            ...existing,
            appsMetaJson: input.appsMetaJson ?? null,
            description: input.description ?? null,
            executionJson: input.executionJson ?? null,
            fingerprint: input.fingerprint,
            inputSchemaJson: input.inputSchemaJson,
            isActive: input.isActive ?? true,
            modelVisible: input.modelVisible,
            outputSchemaJson: input.outputSchemaJson ?? null,
            runtimeName: input.runtimeName,
            title: input.title ?? null,
            updatedAt: input.updatedAt,
          }),
        )
      }

      const record: McpToolCacheRecord = {
        appsMetaJson: input.appsMetaJson ?? null,
        createdAt: input.updatedAt,
        description: input.description ?? null,
        executionJson: input.executionJson ?? null,
        fingerprint: input.fingerprint,
        id: input.id,
        inputSchemaJson: input.inputSchemaJson,
        isActive: input.isActive ?? true,
        modelVisible: input.modelVisible,
        outputSchemaJson: input.outputSchemaJson ?? null,
        remoteName: input.remoteName,
        runtimeName: input.runtimeName,
        serverId: input.serverId,
        tenantId,
        title: input.title ?? null,
        updatedAt: input.updatedAt,
      }

      db.insert(mcpToolCache)
        .values({
          ...record,
        })
        .run()

      return ok(record)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown MCP tool cache upsert failure'

      return err({
        message: `failed to upsert cached MCP tool ${input.runtimeName}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
