import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ToolRegistry } from '../../application/tooling/tool-registry'
import type { AppLogger } from '../../shared/logger'
import type { TenantScope } from '../../shared/scope'
import type { McpClientBundle } from './client-factory'
import type { McpServerConfig, McpServerStatus } from './types'

export interface InFlightCorrelation {
  runId: string
  tenantId: string
  toolCallId: string
}

export interface ServerRegistration {
  accountId: string | null
  config: McpServerConfig
  source: 'db' | 'static'
  tenantId: string | null
}

export interface ConnectedServerState {
  client: McpClientBundle['client'] | null
  connectionKey: string
  discoveredToolCount: number
  inFlight: Map<string, InFlightCorrelation>
  lastError: string | null
  registeredToolCount: number
  registration: ServerRegistration
  scope: TenantScope | null
  status: McpServerStatus
  transport: StdioClientTransport | StreamableHTTPClientTransport | null
}

export interface McpGatewayDependencies {
  clientInfo: {
    name: string
    version: string
  }
  logger: AppLogger
  secretEncryptionKey: string | null
  toolRegistry: ToolRegistry
}
