import type { DomainError } from '../../shared/errors'
import type { AccountId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type {
  McpLogLevel,
  McpStoredServerTransportConfig,
  McpTransportKind,
} from './mcp-domain-types'

export type { McpStoredHttpAuthConfig, McpStoredServerTransportConfig } from './mcp-domain-types'

export interface McpServerRecord {
  config: McpStoredServerTransportConfig
  createdAt: string
  createdByAccountId: AccountId
  enabled: boolean
  id: string
  kind: McpTransportKind
  label: string
  lastDiscoveredAt: string | null
  lastError: string | null
  logLevel: McpLogLevel | null
  tenantId: TenantId
  updatedAt: string
}

export interface CreateMcpServerInput {
  config: McpStoredServerTransportConfig
  createdAt: string
  enabled?: boolean
  id: string
  kind: McpTransportKind
  label: string
  logLevel?: McpLogLevel | null
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
  kind: McpTransportKind
  label: string
  logLevel?: McpLogLevel | null
  updatedAt: string
}

/**
 * Protocol-neutral repository contract for MCP server records. Concrete
 * persistence (Drizzle/SQLite) lives in
 * `apps/server/src/adapters/persistence/sqlite/mcp/mcp-server-repository.ts`.
 */
export interface McpServerRepository {
  create: (scope: TenantScope, input: CreateMcpServerInput) => Result<McpServerRecord, DomainError>
  delete: (scope: TenantScope, serverId: string) => Result<McpServerRecord, DomainError>
  getById: (scope: TenantScope, serverId: string) => Result<McpServerRecord, DomainError>
  listByAccount: (scope: TenantScope) => Result<McpServerRecord[], DomainError>
  listEnabledForGateway: () => Result<McpServerRecord[], DomainError>
  update: (scope: TenantScope, input: UpdateMcpServerInput) => Result<McpServerRecord, DomainError>
  updateDiscovery: (
    scope: TenantScope,
    input: UpdateMcpServerDiscoveryInput,
  ) => Result<McpServerRecord, DomainError>
}
