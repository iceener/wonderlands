import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { z } from 'zod'

import type { McpServerConfig } from '../../adapters/mcp/types'
import { parseJsonString, parseOptionalString } from './env'

const mcpServerIdSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/)
const mcpWorkspaceScopeSchema = z.enum(['account', 'run'])
const mcpLoggingLevelSchema = z.enum([
  'alert',
  'critical',
  'debug',
  'emergency',
  'error',
  'info',
  'notice',
  'warning',
])
const mcpRecordSchema = z.record(z.string(), z.string())
const rawMcpHttpAuthSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('none'),
  }),
  z.object({
    kind: z.literal('bearer'),
    tokenEnv: z.string().trim().min(1),
  }),
  z.object({
    clientId: z.string().trim().min(1).optional(),
    clientName: z.string().trim().min(1).optional(),
    clientSecretEnv: z.string().trim().min(1).optional(),
    kind: z.literal('oauth_authorization_code'),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
    tokenEndpointAuthMethod: z.string().trim().min(1).optional(),
  }),
  z.object({
    clientId: z.string().trim().min(1),
    clientSecretEnv: z.string().trim().min(1),
    kind: z.literal('oauth_client_credentials'),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
  }),
  z.object({
    algorithm: z.string().trim().min(1),
    clientId: z.string().trim().min(1),
    kind: z.literal('oauth_private_key_jwt'),
    privateKeyEnv: z.string().trim().min(1),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
  }),
  z.object({
    assertionEnv: z.string().trim().min(1),
    clientId: z.string().trim().min(1),
    kind: z.literal('oauth_static_private_key_jwt'),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
  }),
])
const rawMcpServerSchema = z.discriminatedUnion('kind', [
  z.object({
    allowedTenantIds: z.array(z.string().trim().min(1)).optional(),
    args: z.array(z.string()).optional(),
    command: z.string().trim().min(1),
    cwd: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    env: mcpRecordSchema.optional(),
    id: mcpServerIdSchema,
    kind: z.literal('stdio'),
    logLevel: mcpLoggingLevelSchema.optional(),
    stderr: z.enum(['inherit', 'pipe']).optional(),
    toolPrefix: mcpServerIdSchema.optional(),
    workspaceScoped: mcpWorkspaceScopeSchema.optional(),
  }),
  z.object({
    allowedTenantIds: z.array(z.string().trim().min(1)).optional(),
    auth: rawMcpHttpAuthSchema.optional(),
    enabled: z.boolean().optional(),
    headers: mcpRecordSchema.optional(),
    id: mcpServerIdSchema,
    kind: z.literal('streamable_http'),
    logLevel: mcpLoggingLevelSchema.optional(),
    toolPrefix: mcpServerIdSchema.optional(),
    url: z.string().url(),
  }),
])
const rawMcpServersSchema = z.array(rawMcpServerSchema)

export const resolveMcpServers = (
  rawFilePath: string | undefined,
  env: NodeJS.ProcessEnv,
): McpServerConfig[] => {
  const configuredFilePath = rawFilePath?.trim()
  const filePath = resolve(process.cwd(), configuredFilePath || './.mcp-servers.json')
  const fileExists = existsSync(filePath)

  if (!fileExists) {
    if (configuredFilePath) {
      throw new Error(`MCP_SERVERS_FILE does not exist: ${filePath}`)
    }

    return []
  }

  const fileContents = readFileSync(filePath, 'utf8').trim()
  const parsed = parseJsonString(
    fileContents.length > 0 ? fileContents : '[]',
    [],
    (input) => rawMcpServersSchema.parse(input),
    `MCP_SERVERS_FILE (${filePath})`,
  )
  const serverIds = new Set<string>()
  const toolPrefixes = new Set<string>()

  return parsed.map<McpServerConfig>((server) => {
    if (serverIds.has(server.id)) {
      throw new Error(`MCP server id ${server.id} is duplicated`)
    }

    serverIds.add(server.id)

    const toolPrefix = server.toolPrefix ?? server.id

    if (toolPrefixes.has(toolPrefix)) {
      throw new Error(`MCP tool prefix ${toolPrefix} is duplicated`)
    }

    toolPrefixes.add(toolPrefix)

    if (server.kind === 'stdio') {
      return {
        allowedTenantIds: server.allowedTenantIds,
        args: server.args,
        command: server.command,
        cwd: server.cwd,
        enabled: server.enabled ?? true,
        env: server.env,
        id: server.id,
        kind: 'stdio',
        logLevel: server.logLevel,
        stderr: server.stderr ?? 'pipe',
        toolPrefix,
        workspaceScoped: server.workspaceScoped,
      }
    }

    const auth = server.auth ?? { kind: 'none' as const }
    const toBaseStreamableHttpServerConfig = () => ({
      allowedTenantIds: server.allowedTenantIds,
      enabled: server.enabled ?? true,
      headers: server.headers,
      id: server.id,
      kind: 'streamable_http' as const,
      logLevel: server.logLevel,
      toolPrefix,
      url: server.url,
    })

    switch (auth.kind) {
      case 'none':
        return {
          ...toBaseStreamableHttpServerConfig(),
          auth,
        }
      case 'bearer':
        return {
          ...toBaseStreamableHttpServerConfig(),
          auth: {
            kind: 'bearer',
            token: parseOptionalString(env[auth.tokenEnv]),
          },
        }
      case 'oauth_client_credentials':
        return {
          ...toBaseStreamableHttpServerConfig(),
          auth: {
            clientId: auth.clientId,
            clientSecret: parseOptionalString(env[auth.clientSecretEnv]),
            kind: auth.kind,
            resource: parseOptionalString(auth.resource),
            resourceMetadataUrl: parseOptionalString(auth.resourceMetadataUrl),
            scope: parseOptionalString(auth.scope),
          },
        }
      case 'oauth_authorization_code':
        return {
          ...toBaseStreamableHttpServerConfig(),
          auth: {
            clientId: parseOptionalString(auth.clientId),
            clientName: parseOptionalString(auth.clientName),
            clientSecret: parseOptionalString(
              auth.clientSecretEnv ? env[auth.clientSecretEnv] : undefined,
            ),
            kind: auth.kind,
            resource: parseOptionalString(auth.resource),
            resourceMetadataUrl: parseOptionalString(auth.resourceMetadataUrl),
            scope: parseOptionalString(auth.scope),
            tokenEndpointAuthMethod: parseOptionalString(auth.tokenEndpointAuthMethod),
          },
        }
      case 'oauth_private_key_jwt':
        return {
          ...toBaseStreamableHttpServerConfig(),
          auth: {
            algorithm: auth.algorithm,
            clientId: auth.clientId,
            kind: auth.kind,
            privateKey: parseOptionalString(env[auth.privateKeyEnv]),
            resource: parseOptionalString(auth.resource),
            resourceMetadataUrl: parseOptionalString(auth.resourceMetadataUrl),
            scope: parseOptionalString(auth.scope),
          },
        }
      case 'oauth_static_private_key_jwt':
        return {
          ...toBaseStreamableHttpServerConfig(),
          auth: {
            assertion: parseOptionalString(env[auth.assertionEnv]),
            clientId: auth.clientId,
            kind: auth.kind,
            resource: parseOptionalString(auth.resource),
            resourceMetadataUrl: parseOptionalString(auth.resourceMetadataUrl),
            scope: parseOptionalString(auth.scope),
          },
        }
    }

    throw new Error(`Unsupported MCP auth kind ${(auth as { kind: string }).kind}`)
  })
}
