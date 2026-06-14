import type {
  CallToolResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js'

import { apiRequest } from './backend'

type McpAppOrigin = { serverId: string } | { toolName: string }

const buildOriginSearchParams = (params: McpAppOrigin): URLSearchParams => {
  const searchParams = new URLSearchParams()

  if ('serverId' in params) {
    searchParams.set('serverId', params.serverId)
  } else {
    searchParams.set('toolName', params.toolName)
  }

  return searchParams
}

export const fetchAppResourceHtml = async (
  params: McpAppOrigin & { uri: string },
): Promise<string> => {
  const searchParams = buildOriginSearchParams(params)
  searchParams.set('uri', params.uri)
  const result = await apiRequest<{ html: string }>(
    `/mcp/resources/read?${searchParams.toString()}`,
  )
  return result.html
}

export const callMcpAppTool = async (
  params: McpAppOrigin & {
    arguments?: Record<string, unknown> | null
    name: string
  },
): Promise<CallToolResult> =>
  apiRequest<CallToolResult>('/mcp/tools/call', {
    body: JSON.stringify(params),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const readMcpAppResource = async (
  params: McpAppOrigin & { uri: string },
): Promise<ReadResourceResult> => {
  const searchParams = buildOriginSearchParams(params)
  searchParams.set('format', 'raw')
  searchParams.set('uri', params.uri)
  return apiRequest<ReadResourceResult>(`/mcp/resources/read?${searchParams.toString()}`)
}

export const listMcpAppResources = async (
  params: McpAppOrigin & { cursor?: string },
): Promise<ListResourcesResult> => {
  const searchParams = buildOriginSearchParams(params)
  if (params.cursor) {
    searchParams.set('cursor', params.cursor)
  }
  return apiRequest<ListResourcesResult>(`/mcp/resources/list?${searchParams.toString()}`)
}

export const listMcpAppResourceTemplates = async (
  params: McpAppOrigin & { cursor?: string },
): Promise<ListResourceTemplatesResult> => {
  const searchParams = buildOriginSearchParams(params)
  if (params.cursor) {
    searchParams.set('cursor', params.cursor)
  }
  return apiRequest<ListResourceTemplatesResult>(
    `/mcp/resources/templates/list?${searchParams.toString()}`,
  )
}
