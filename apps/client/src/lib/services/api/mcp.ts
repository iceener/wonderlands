import type {
  BackendToolProfile,
  CreateToolProfileInput,
  ToolProfileId,
  UpdateToolProfileInput,
} from '@wonderlands/contracts/chat'
import { apiRequest } from '../backend'

export type McpServerKind = 'stdio' | 'streamable_http'
export type McpServerStatus = 'authorization_required' | 'connecting' | 'degraded' | 'ready'

export type CreateMcpHttpAuthInput =
  | { kind: 'none' }
  | { kind: 'bearer'; token: string }
  | {
      clientId?: string
      clientName?: string
      clientSecret?: string
      kind: 'oauth_authorization_code'
      resource?: string
      resourceMetadataUrl?: string
      scope?: string
      tokenEndpointAuthMethod?: string
    }

export type CreateMcpServerInput =
  | {
      config: {
        args?: string[]
        command: string
        cwd?: string
        env?: Record<string, string>
        stderr?: 'inherit' | 'pipe'
      }
      enabled?: boolean
      kind: 'stdio'
      label: string
      logLevel?: string
    }
  | {
      config: {
        auth?: CreateMcpHttpAuthInput
        headers?: Record<string, string>
        url: string
      }
      enabled?: boolean
      kind: 'streamable_http'
      label: string
      logLevel?: string
    }

export interface BackendMcpServer {
  config: Record<string, unknown>
  createdAt: string | null
  createdByAccountId: string | null
  enabled: boolean
  id: string
  kind: McpServerKind
  label: string
  lastDiscoveredAt: string | null
  lastError: string | null
  logLevel: string | null
  source: 'db' | 'static'
  tenantId: string
  updatedAt: string | null
}

export interface BackendMcpServerEntry extends BackendMcpServer {
  snapshot: BackendMcpServerSnapshot | null
}

export interface BackendMcpServerSnapshot {
  discoveredToolCount: number
  id: string
  kind: McpServerKind
  lastError: string | null
  registeredToolCount: number
  status: McpServerStatus
}

export type BeginMcpServerAuthorizationResult =
  | {
      kind: 'authorized'
      snapshot: BackendMcpServerSnapshot
    }
  | {
      authorizationUrl: string
      kind: 'redirect'
    }

export interface BackendMcpToolAssignment {
  approvedAt: string | null
  approvedFingerprint: string | null
  assignedAt: string
  assignedByAccountId: string
  id: string
  requiresConfirmation: boolean
  runtimeName: string
  serverId: string
  tenantId: string
  toolProfileId: ToolProfileId | string
  updatedAt: string
}

export interface BackendMcpToolAppsMeta {
  csp: Record<string, unknown> | null
  domain: string | null
  permissions: Record<string, unknown> | null
  resourceUri: string | null
  visibility: Array<'app' | 'model'>
}

export interface BackendMcpServerTool {
  appsMetaJson: BackendMcpToolAppsMeta | null
  assignment?: BackendMcpToolAssignment | null
  createdAt: string | null
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
  tenantId: string
  title: string | null
  updatedAt: string | null
}

export const listToolProfiles = (): Promise<BackendToolProfile[]> =>
  apiRequest<BackendToolProfile[]>('/tool-profiles')

export const getToolProfile = (
  toolProfileId: ToolProfileId | string,
): Promise<BackendToolProfile> =>
  apiRequest<BackendToolProfile>(`/tool-profiles/${encodeURIComponent(toolProfileId)}`)

export const createToolProfile = (input: CreateToolProfileInput): Promise<BackendToolProfile> =>
  apiRequest<BackendToolProfile>('/tool-profiles', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const updateToolProfile = (
  toolProfileId: ToolProfileId | string,
  input: UpdateToolProfileInput,
): Promise<BackendToolProfile> =>
  apiRequest<BackendToolProfile>(`/tool-profiles/${encodeURIComponent(toolProfileId)}`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })

export const createMcpServer = (
  input: CreateMcpServerInput,
): Promise<{ server: BackendMcpServer; snapshot: BackendMcpServerSnapshot }> =>
  apiRequest<{ server: BackendMcpServer; snapshot: BackendMcpServerSnapshot }>('/mcp/servers', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const listMcpServers = (): Promise<BackendMcpServerEntry[]> =>
  apiRequest<BackendMcpServerEntry[]>('/mcp/servers')

export const updateMcpServer = (
  serverId: string,
  input: CreateMcpServerInput,
): Promise<{ server: BackendMcpServer; snapshot: BackendMcpServerSnapshot }> =>
  apiRequest<{ server: BackendMcpServer; snapshot: BackendMcpServerSnapshot }>(
    `/mcp/servers/${encodeURIComponent(serverId)}`,
    {
      body: JSON.stringify(input),
      headers: {
        'content-type': 'application/json',
      },
      method: 'PATCH',
    },
  )

export const refreshMcpServer = (serverId: string): Promise<BackendMcpServerSnapshot> =>
  apiRequest<BackendMcpServerSnapshot>(`/mcp/servers/${encodeURIComponent(serverId)}/refresh`, {
    method: 'POST',
  })

export const beginMcpServerAuthorization = (
  serverId: string,
  input: {
    responseOrigin?: string
  } = {},
): Promise<BeginMcpServerAuthorizationResult> =>
  apiRequest<BeginMcpServerAuthorizationResult>(
    `/mcp/servers/${encodeURIComponent(serverId)}/oauth/start`,
    {
      body: JSON.stringify(input),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

export const deleteMcpServer = (
  serverId: string,
): Promise<{
  deletedToolAssignments: number
  deletedTools: number
  serverId: string
}> =>
  apiRequest<{
    deletedToolAssignments: number
    deletedTools: number
    serverId: string
  }>(`/mcp/servers/${encodeURIComponent(serverId)}`, {
    method: 'DELETE',
  })

export const getMcpServerTools = (
  serverId: string,
  options: { toolProfileId?: ToolProfileId | string } = {},
): Promise<{
  toolProfileId: ToolProfileId | string | null
  server: BackendMcpServer
  tools: BackendMcpServerTool[]
}> => {
  const searchParams = new URLSearchParams()

  const toolProfileId = options.toolProfileId?.toString().trim()

  if (toolProfileId) {
    searchParams.set('toolProfileId', toolProfileId)
  }

  const path =
    searchParams.size > 0
      ? `/mcp/servers/${encodeURIComponent(serverId)}/tools?${searchParams.toString()}`
      : `/mcp/servers/${encodeURIComponent(serverId)}/tools`

  return apiRequest<{
    toolProfileId: ToolProfileId | string | null
    server: BackendMcpServer
    tools: BackendMcpServerTool[]
  }>(path)
}

export const assignMcpTool = (input: {
  requiresConfirmation?: boolean
  runtimeName: string
  serverId: string
  toolProfileId: ToolProfileId | string
}): Promise<{
  assignment: BackendMcpToolAssignment
  tool: BackendMcpServerTool
}> =>
  apiRequest<{
    assignment: BackendMcpToolAssignment
    tool: BackendMcpServerTool
  }>('/mcp/assignments', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const deleteMcpToolAssignment = (input: {
  runtimeName: string
  toolProfileId: ToolProfileId | string
}): Promise<{
  assignment: BackendMcpToolAssignment
}> => {
  const searchParams = new URLSearchParams({
    toolProfileId: input.toolProfileId.toString(),
  })

  return apiRequest<{
    assignment: BackendMcpToolAssignment
  }>(`/mcp/assignments/${encodeURIComponent(input.runtimeName)}?${searchParams.toString()}`, {
    method: 'DELETE',
  })
}
