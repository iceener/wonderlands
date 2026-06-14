import { RESOURCE_URI_META_KEY } from '@modelcontextprotocol/ext-apps'

import type { CommandContext } from '../commands/command-context'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const extractOutputAppsMeta = (
  output: unknown,
): {
  csp?: Record<string, unknown>
  permissions?: Record<string, unknown>
  resourceUri: string
} | null => {
  if (!isRecord(output)) {
    return null
  }

  const meta = isRecord(output.meta) ? output.meta : isRecord(output._meta) ? output._meta : null

  if (!meta) {
    return null
  }

  const ui = isRecord(meta.ui) ? meta.ui : null
  const resourceUri =
    typeof ui?.resourceUri === 'string'
      ? ui.resourceUri
      : typeof meta[RESOURCE_URI_META_KEY] === 'string'
        ? meta[RESOURCE_URI_META_KEY]
        : null

  if (!resourceUri) {
    return null
  }

  return {
    ...(isRecord(ui?.csp) ? { csp: ui.csp } : {}),
    ...(isRecord(ui?.permissions) ? { permissions: ui.permissions } : {}),
    resourceUri,
  }
}

export const getToolAppsMetaPayload = (
  context: CommandContext,
  toolName: string,
  output?: unknown,
): Record<string, unknown> | null => {
  const descriptor = context.services.mcp.getTool(toolName)

  if (!descriptor) {
    return null
  }

  const descriptorApps = descriptor.apps
  const outputApps = extractOutputAppsMeta(output)
  const resourceUri = descriptorApps?.resourceUri ?? outputApps?.resourceUri

  if (!resourceUri) {
    return null
  }

  const csp = descriptorApps?.csp ?? outputApps?.csp
  const permissions = descriptorApps?.permissions ?? outputApps?.permissions

  return {
    ...(csp ? { csp } : {}),
    ...(permissions ? { permissions } : {}),
    resourceUri,
    serverId: descriptor.serverId,
  }
}
