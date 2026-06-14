import type { Tool } from '@modelcontextprotocol/sdk/types.js'

import { isMcpToolModelVisible, parseMcpAppsToolMeta } from './apps-meta'
import { createMcpToolFingerprint } from './tool-fingerprint'
import type { McpDiscoveredTool, McpServerConfig } from './types'

const MCP_RUNTIME_SEPARATOR = '__'
const MCP_LEGACY_RUNTIME_SEPARATOR = '.'

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')

const toRuntimePrefix = (server: Pick<McpServerConfig, 'id' | 'toolPrefix'>): string =>
  slugify(server.toolPrefix ?? server.id)

const toRuntimeSuffix = (remoteName: string): string => slugify(remoteName)

export const buildMcpRuntimeName = (
  server: Pick<McpServerConfig, 'id' | 'toolPrefix'>,
  remoteName: string,
): string => `${toRuntimePrefix(server)}${MCP_RUNTIME_SEPARATOR}${toRuntimeSuffix(remoteName)}`

export const toLegacyMcpRuntimeName = (runtimeName: string): string =>
  runtimeName.includes(MCP_RUNTIME_SEPARATOR)
    ? runtimeName.replace(MCP_RUNTIME_SEPARATOR, MCP_LEGACY_RUNTIME_SEPARATOR)
    : runtimeName

export const toCanonicalMcpRuntimeName = (runtimeName: string): string =>
  runtimeName.includes(MCP_LEGACY_RUNTIME_SEPARATOR)
    ? runtimeName.replace(MCP_LEGACY_RUNTIME_SEPARATOR, MCP_RUNTIME_SEPARATOR)
    : runtimeName

export const getMcpRuntimeNameAliasesFromRuntimeName = (runtimeName: string): string[] =>
  Array.from(
    new Set([
      runtimeName,
      toCanonicalMcpRuntimeName(runtimeName),
      toLegacyMcpRuntimeName(runtimeName),
    ]),
  ).filter((value) => value.length > 0)

const cloneSchemaObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      properties: {},
      required: [],
      type: 'object',
    }
  }

  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

export const normalizeMcpTool = (server: McpServerConfig, remoteTool: Tool): McpDiscoveredTool => {
  const apps = parseMcpAppsToolMeta(remoteTool)
  const inputSchema = cloneSchemaObject(remoteTool.inputSchema)
  const outputSchema = remoteTool.outputSchema ? cloneSchemaObject(remoteTool.outputSchema) : null

  return {
    apps,
    description: remoteTool.description,
    execution: remoteTool.execution ?? null,
    fingerprint: createMcpToolFingerprint({
      apps,
      description: remoteTool.description ?? null,
      execution: remoteTool.execution ?? null,
      inputSchema,
      outputSchema,
      remoteName: remoteTool.name,
      serverId: server.id,
      title: remoteTool.title ?? remoteTool.annotations?.title ?? null,
    }),
    inputSchema,
    modelVisible: isMcpToolModelVisible(apps),
    outputSchema,
    registrationSkippedReason: null,
    remoteName: remoteTool.name,
    remoteTool,
    runtimeName: buildMcpRuntimeName(server, remoteTool.name),
    serverId: server.id,
    title: remoteTool.title ?? remoteTool.annotations?.title ?? null,
  }
}
