import { RESOURCE_URI_META_KEY } from '@modelcontextprotocol/ext-apps'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

import type { McpAppsToolMeta, McpAppToolVisibility } from './types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toVisibility = (value: unknown): McpAppToolVisibility[] => {
  if (!Array.isArray(value)) {
    return ['model', 'app']
  }

  const visibility = value.filter(
    (entry): entry is McpAppToolVisibility => entry === 'app' || entry === 'model',
  )

  return visibility.length > 0 ? [...new Set(visibility)] : ['model', 'app']
}

export const parseMcpAppsToolMeta = (tool: Pick<Tool, '_meta'>): McpAppsToolMeta | null => {
  const meta = isRecord(tool._meta) ? tool._meta : null
  const ui = isRecord(meta?.ui) ? meta.ui : null
  const resourceUri =
    typeof ui?.resourceUri === 'string'
      ? ui.resourceUri
      : typeof meta?.[RESOURCE_URI_META_KEY] === 'string'
        ? meta[RESOURCE_URI_META_KEY]
        : null
  const visibility = toVisibility(ui?.visibility)
  const domain = typeof ui?.domain === 'string' ? ui.domain : null
  const permissions = isRecord(ui?.permissions) ? ui.permissions : null
  const csp = isRecord(ui?.csp) ? ui.csp : null

  if (!resourceUri && !ui && !permissions && !csp && !domain) {
    return null
  }

  return {
    csp,
    domain,
    permissions,
    resourceUri,
    visibility,
  }
}

export const isMcpToolModelVisible = (apps: McpAppsToolMeta | null): boolean =>
  apps?.visibility.includes('model') ?? true
