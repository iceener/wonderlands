import type {
  CallToolResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  LoggingLevel,
  ReadResourceResult,
  Tool,
} from '@modelcontextprotocol/sdk/types.js'

import type { ToolContext } from '../../domain/tooling/tool-registry'
import type { DomainError } from '../../shared/errors'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export type McpTransportKind = 'stdio' | 'streamable_http'
export type McpWorkspaceScope = 'account' | 'run'

export type McpResolvedHttpAuthConfig =
  | { kind: 'none' }
  | { kind: 'bearer'; token: string | null }
  | {
      clientId: string | null
      clientName: string | null
      clientSecret: string | null
      kind: 'oauth_authorization_code'
      resource: string | null
      resourceMetadataUrl: string | null
      scope: string | null
      tokenEndpointAuthMethod: string | null
    }
  | {
      kind: 'oauth_client_credentials'
      clientId: string
      clientSecret: string | null
      resource: string | null
      resourceMetadataUrl: string | null
      scope: string | null
    }
  | {
      algorithm: string
      clientId: string
      kind: 'oauth_private_key_jwt'
      privateKey: string | null
      resource: string | null
      resourceMetadataUrl: string | null
      scope: string | null
    }
  | {
      assertion: string | null
      clientId: string
      kind: 'oauth_static_private_key_jwt'
      resource: string | null
      resourceMetadataUrl: string | null
      scope: string | null
    }

interface McpServerConfigBase {
  allowedTenantIds?: string[]
  enabled: boolean
  id: string
  logLevel?: LoggingLevel
  toolPrefix?: string
}

export interface McpStdioServerConfig extends McpServerConfigBase {
  args?: string[]
  command: string
  cwd?: string
  env?: Record<string, string>
  kind: 'stdio'
  stderr?: 'inherit' | 'pipe'
  workspaceScoped?: McpWorkspaceScope
}

export interface McpStreamableHttpServerConfig extends McpServerConfigBase {
  auth: McpResolvedHttpAuthConfig
  headers?: Record<string, string>
  kind: 'streamable_http'
  url: string
}

export type McpServerConfig = McpStdioServerConfig | McpStreamableHttpServerConfig

export type McpAppToolVisibility = 'app' | 'model'

export interface McpAppsToolMeta {
  csp: Record<string, unknown> | null
  domain: string | null
  permissions: Record<string, unknown> | null
  resourceUri: string | null
  visibility: McpAppToolVisibility[]
}

export interface McpDiscoveredTool {
  apps: McpAppsToolMeta | null
  description?: string
  execution: Tool['execution'] | null
  fingerprint: string
  inputSchema: Record<string, unknown>
  modelVisible: boolean
  outputSchema: Record<string, unknown> | null
  registrationSkippedReason: string | null
  remoteName: string
  remoteTool: Tool
  runtimeName: string
  serverId: string
  title: string | null
}

export type McpServerStatus = 'authorization_required' | 'connecting' | 'degraded' | 'ready'

export interface McpServerSnapshot {
  discoveredToolCount: number
  id: string
  kind: McpTransportKind
  lastError: string | null
  registeredToolCount: number
  status: McpServerStatus
}

export interface McpGateway {
  callTool: (input: {
    args: unknown
    context: ToolContext
    runtimeName: string
  }) => Promise<Result<unknown, DomainError>>
  callServerTool: (input: {
    args?: Record<string, unknown> | null
    name: string
    serverId: string
    tenantScope: TenantScope
  }) => Promise<Result<CallToolResult, DomainError>>
  close: () => Promise<void>
  listResourceTemplates: (input: {
    cursor?: string
    serverId: string
    tenantScope: TenantScope
  }) => Promise<Result<ListResourceTemplatesResult, DomainError>>
  listResources: (input: {
    cursor?: string
    serverId: string
    tenantScope: TenantScope
  }) => Promise<Result<ListResourcesResult, DomainError>>
  readResource: (input: {
    serverId: string
    tenantScope: TenantScope
    uri: string
  }) => Promise<Result<{ html: string; mimeType: string }, DomainError>>
  readRawResource: (input: {
    serverId: string
    tenantScope: TenantScope
    uri: string
  }) => Promise<Result<ReadResourceResult, DomainError>>
  getServerSnapshot: (scope: TenantScope | null, serverId: string) => McpServerSnapshot | null
  getServerSnapshots: () => McpServerSnapshot[]
  getTool: (runtimeName: string) => McpDiscoveredTool | null
  initialize: () => Promise<void>
  listTools: () => McpDiscoveredTool[]
  removeRegisteredServer: (
    scope: TenantScope,
    serverId: string,
  ) => Promise<Result<{ id: string }, DomainError>>
  refreshServer: (
    scope: TenantScope,
    serverId: string,
  ) => Promise<Result<McpServerSnapshot, DomainError>>
}
