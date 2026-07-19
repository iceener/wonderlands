import type { DomainError } from '../../shared/errors'
import type { TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { McpAppsToolMeta } from './mcp-domain-types'

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

/**
 * Protocol-neutral repository contract for cached MCP tool metadata.
 * Concrete persistence lives in
 * `apps/server/src/adapters/persistence/sqlite/mcp/mcp-tool-cache-repository.ts`.
 */
export interface McpToolCacheRepository {
  deleteByServerId: (scope: TenantScope, serverId: string) => Result<number, DomainError>
  listByServerId: (
    scope: TenantScope,
    serverId: string,
  ) => Result<McpToolCacheRecord[], DomainError>
  markInactiveByServerId: (
    tenantId: TenantId,
    serverId: string,
    updatedAt: string,
  ) => Result<number, DomainError>
  upsertForTenant: (
    tenantId: TenantId,
    input: UpsertMcpToolCacheInput,
  ) => Result<McpToolCacheRecord, DomainError>
}
