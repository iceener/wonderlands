import { getMcpRuntimeNameAliasesFromRuntimeName } from '../../../../adapters/mcp/normalize-tool'
import { toMcpServerConfig } from '../../../../adapters/mcp/server-config'
import type { McpDiscoveredTool, McpServerConfig } from '../../../../adapters/mcp/types'
import type { McpServerRecord } from '../../../../domain/mcp/mcp-server-repository'

export const isStaticServerVisibleToTenant = (
  server: McpServerConfig,
  tenantId: string,
): boolean =>
  !server.allowedTenantIds || server.allowedTenantIds.length === 0
    ? true
    : server.allowedTenantIds.includes(tenantId)

const toApiStaticServerConfig = (server: McpServerConfig): Record<string, unknown> =>
  server.kind === 'stdio'
    ? {
        args: server.args,
        command: server.command,
        cwd: server.cwd,
        env: server.env,
        stderr: server.stderr,
      }
    : {
        auth: server.auth,
        headers: server.headers,
        url: server.url,
      }

export const toApiDbServer = (server: McpServerRecord, encryptionKey: string | null) => ({
  ...server,
  config: toApiStaticServerConfig(toMcpServerConfig(server, encryptionKey)),
  source: 'db' as const,
})

export const toApiStaticServer = (server: McpServerConfig, tenantId: string) => ({
  config: toApiStaticServerConfig(server),
  createdAt: null,
  createdByAccountId: null,
  enabled: server.enabled,
  id: server.id,
  kind: server.kind,
  label: server.toolPrefix ?? server.id,
  lastDiscoveredAt: null,
  lastError: null,
  logLevel: server.logLevel ?? null,
  source: 'static' as const,
  tenantId,
  updatedAt: null,
})

export const toApiStaticTool = (tenantId: string, tool: McpDiscoveredTool) => ({
  appsMetaJson: tool.apps,
  assignment: null,
  createdAt: null,
  description: tool.description ?? null,
  executionJson:
    tool.execution && typeof tool.execution === 'object'
      ? (JSON.parse(JSON.stringify(tool.execution)) as Record<string, unknown>)
      : null,
  fingerprint: tool.fingerprint,
  id: `mct_static_${tool.serverId}_${tool.runtimeName}`,
  inputSchemaJson: tool.inputSchema,
  isActive: true,
  modelVisible: tool.modelVisible,
  outputSchemaJson: tool.outputSchema,
  remoteName: tool.remoteName,
  runtimeName: tool.runtimeName,
  serverId: tool.serverId,
  tenantId,
  title: tool.title,
  updatedAt: null,
})

export const toAssignmentByRuntimeName = <
  TAssignment extends {
    runtimeName: string
  },
>(
  assignments: TAssignment[],
) => new Map(assignments.map((assignment) => [assignment.runtimeName, assignment]))

export const resolveAssignedTool = <
  TAssignment extends {
    runtimeName: string
  },
>(
  assignmentByRuntimeName: Map<string, TAssignment>,
  runtimeName: string,
): TAssignment | null =>
  getMcpRuntimeNameAliasesFromRuntimeName(runtimeName)
    .map((alias) => assignmentByRuntimeName.get(alias) ?? null)
    .find((assignment) => assignment !== null) ?? null

export const resolveRuntimeNameForServerTool = <
  TTool extends {
    runtimeName: string
  },
>(
  tools: TTool[],
  runtimeName: string,
): string | null =>
  tools.find((entry) =>
    getMcpRuntimeNameAliasesFromRuntimeName(entry.runtimeName).includes(runtimeName),
  )?.runtimeName ?? null
