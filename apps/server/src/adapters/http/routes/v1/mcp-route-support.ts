import type { Context } from 'hono'
import { z } from 'zod'
import { getMcpRuntimeNameAliasesFromRuntimeName } from '../../../../adapters/mcp/normalize-tool'
import {
  canStartAuthorizationCodeOAuth,
  toAuthorizationCodeServerConfig,
} from '../../../../adapters/mcp/oauth-authorization-code'
import { protectStoredHttpAuthConfig } from '../../../../adapters/mcp/stored-auth'
import type { McpDiscoveredTool, McpServerConfig } from '../../../../adapters/mcp/types'
import type { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import type { RepositoryDatabase } from '../../../../domain/database-port'
import {
  createMcpServerRepository,
  type McpServerRecord,
  toMcpServerConfig,
} from '../../../../domain/mcp/mcp-server-repository'
import { createMcpToolAssignmentRepository } from '../../../../domain/mcp/mcp-tool-assignment-repository'
import { DomainErrorException } from '../../../../shared/errors'
import { ok } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import { toZodErrorMessage } from '../../validation'

const logLevelSchema = z.enum([
  'alert',
  'critical',
  'debug',
  'emergency',
  'error',
  'info',
  'notice',
  'warning',
])

const recordSchema = z.record(z.string(), z.string())

const mcpStoredHttpAuthSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('none'),
  }),
  z.object({
    kind: z.literal('bearer'),
    token: z.string().trim().min(1),
  }),
  z.object({
    clientId: z.string().trim().min(1).optional(),
    clientName: z.string().trim().min(1).optional(),
    clientSecret: z.string().trim().min(1).optional(),
    kind: z.literal('oauth_authorization_code'),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
    tokenEndpointAuthMethod: z.string().trim().min(1).optional(),
  }),
  z.object({
    clientId: z.string().trim().min(1),
    clientSecret: z.string().trim().min(1),
    kind: z.literal('oauth_client_credentials'),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
  }),
  z.object({
    algorithm: z.string().trim().min(1),
    clientId: z.string().trim().min(1),
    kind: z.literal('oauth_private_key_jwt'),
    privateKey: z.string().trim().min(1),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
  }),
  z.object({
    assertion: z.string().trim().min(1),
    clientId: z.string().trim().min(1),
    kind: z.literal('oauth_static_private_key_jwt'),
    resource: z.string().trim().min(1).optional(),
    resourceMetadataUrl: z.string().url().optional(),
    scope: z.string().trim().min(1).optional(),
  }),
])

export const createMcpServerInputSchema = z.discriminatedUnion('kind', [
  z.object({
    config: z.object({
      args: z.array(z.string()).optional(),
      command: z.string().trim().min(1),
      cwd: z.string().trim().min(1).optional(),
      env: recordSchema.optional(),
      stderr: z.enum(['inherit', 'pipe']).optional(),
    }),
    enabled: z.boolean().optional(),
    kind: z.literal('stdio'),
    label: z.string().trim().min(1).max(200),
    logLevel: logLevelSchema.optional(),
  }),
  z.object({
    config: z.object({
      auth: mcpStoredHttpAuthSchema.optional(),
      headers: recordSchema.optional(),
      url: z.string().url(),
    }),
    enabled: z.boolean().optional(),
    kind: z.literal('streamable_http'),
    label: z.string().trim().min(1).max(200),
    logLevel: logLevelSchema.optional(),
  }),
])

export const assignMcpToolInputSchema = z
  .object({
    toolProfileId: z.string().trim().min(1).max(200).optional(),
    requiresConfirmation: z.boolean().optional(),
    runtimeName: z.string().trim().min(1).max(300),
    serverId: z.string().trim().min(1).max(200),
  })
  .refine((value) => Boolean(value.toolProfileId), {
    message: 'toolProfileId is required',
    path: ['toolProfileId'],
  })

export const deleteMcpToolAssignmentQuerySchema = z
  .object({
    toolProfileId: z.string().trim().min(1).max(200).optional(),
  })
  .refine((value) => Boolean(value.toolProfileId), {
    message: 'toolProfileId is required',
    path: ['toolProfileId'],
  })

export const beginMcpAuthorizationInputSchema = z.object({
  responseOrigin: z.string().url().optional(),
})

export const mcpAppOriginQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).optional(),
    format: z.enum(['html', 'raw']).optional(),
    serverId: z.string().trim().min(1).optional(),
    toolName: z.string().trim().min(1).optional(),
    uri: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value.serverId || value.toolName), {
    message: 'Missing required query parameters: serverId (or toolName)',
    path: ['serverId'],
  })

export const mcpAppToolCallInputSchema = z
  .object({
    arguments: z.record(z.string(), z.unknown()).nullish(),
    name: z.string().trim().min(1),
    serverId: z.string().trim().min(1).optional(),
    toolName: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value.serverId || value.toolName), {
    message: 'Missing required body fields: serverId (or toolName)',
    path: ['serverId'],
  })

export const mcpOauthCallbackQuerySchema = z.object({
  code: z.string().trim().min(1).optional(),
  error: z.string().trim().min(1).optional(),
  error_description: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1),
})

export const toValidationMessage = toZodErrorMessage

export const resolveRequestedToolProfileId = (input: {
  toolProfileId?: string | null | undefined
}): string | null => input.toolProfileId?.trim() || null

export const toStoredServerConfig = (
  input: z.infer<typeof createMcpServerInputSchema>,
  encryptionKey: string | null,
) =>
  input.kind === 'stdio'
    ? {
        args: input.config.args,
        command: input.config.command,
        cwd: input.config.cwd,
        env: input.config.env,
        stderr: input.config.stderr,
      }
    : {
        auth:
          input.config.auth?.kind === 'none' || !input.config.auth
            ? { kind: 'none' as const }
            : protectStoredHttpAuthConfig(
                input.config.auth.kind === 'bearer'
                  ? {
                      kind: 'bearer' as const,
                      token: input.config.auth.token,
                    }
                  : input.config.auth.kind === 'oauth_authorization_code'
                    ? {
                        clientId: input.config.auth.clientId ?? null,
                        clientName: input.config.auth.clientName ?? null,
                        clientSecret: input.config.auth.clientSecret ?? null,
                        kind: 'oauth_authorization_code' as const,
                        resource: input.config.auth.resource ?? null,
                        resourceMetadataUrl: input.config.auth.resourceMetadataUrl ?? null,
                        scope: input.config.auth.scope ?? null,
                        tokenEndpointAuthMethod: input.config.auth.tokenEndpointAuthMethod ?? null,
                      }
                    : input.config.auth.kind === 'oauth_client_credentials'
                      ? {
                          clientId: input.config.auth.clientId,
                          clientSecret: input.config.auth.clientSecret,
                          kind: 'oauth_client_credentials' as const,
                          resource: input.config.auth.resource ?? null,
                          resourceMetadataUrl: input.config.auth.resourceMetadataUrl ?? null,
                          scope: input.config.auth.scope ?? null,
                        }
                      : input.config.auth.kind === 'oauth_private_key_jwt'
                        ? {
                            algorithm: input.config.auth.algorithm,
                            clientId: input.config.auth.clientId,
                            kind: 'oauth_private_key_jwt' as const,
                            privateKey: input.config.auth.privateKey,
                            resource: input.config.auth.resource ?? null,
                            resourceMetadataUrl: input.config.auth.resourceMetadataUrl ?? null,
                            scope: input.config.auth.scope ?? null,
                          }
                        : {
                            assertion: input.config.auth.assertion,
                            clientId: input.config.auth.clientId,
                            kind: 'oauth_static_private_key_jwt' as const,
                            resource: input.config.auth.resource ?? null,
                            resourceMetadataUrl: input.config.auth.resourceMetadataUrl ?? null,
                            scope: input.config.auth.scope ?? null,
                          },
                encryptionKey,
              ),
        headers: input.config.headers,
        url: input.config.url,
      }

export const toMcpServerUpsertInput = (
  input: z.infer<typeof createMcpServerInputSchema>,
  options: {
    encryptionKey: string | null
    id: string
    now: string
  },
) => ({
  config: toStoredServerConfig(input, options.encryptionKey),
  enabled: input.enabled,
  id: options.id,
  kind: input.kind,
  label: input.label,
  logLevel: input.logLevel ?? null,
  updatedAt: options.now,
})

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

export const listAssignmentsByProfileOrEmpty = (
  db: RepositoryDatabase,
  tenantScope: TenantScope,
  toolProfileId: string | null,
) =>
  toolProfileId
    ? createMcpToolAssignmentRepository(db).listByProfile(tenantScope, toolProfileId)
    : ok([])

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

export const buildMcpOauthCallbackUrl = (c: Context<AppEnv>, serverId?: string): string => {
  const callbackPath = serverId
    ? `${c.get('config').api.basePath}/mcp/oauth/${encodeURIComponent(serverId)}/callback`
    : `${c.get('config').api.basePath}/mcp/oauth/callback`

  return new URL(callbackPath, c.req.url).toString()
}

export const resolveMcpServerId = (
  c: Context<AppEnv>,
  serverId: string | null | undefined,
  toolName: string | null | undefined,
): string => {
  if (serverId) {
    return serverId
  }

  if (!toolName) {
    throw new DomainErrorException({
      message: 'Missing required query parameters: serverId (or toolName)',
      type: 'validation',
    })
  }

  const tool = c.get('services').mcp.getTool(toolName)

  if (!tool) {
    throw new DomainErrorException({
      message: `MCP tool ${toolName} was not found`,
      type: 'not_found',
    })
  }

  return tool.serverId
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const renderOauthCompletionPage = (input: {
  message: string
  responseOrigin: string | null
  serverId: string | null
  status: 'authorized' | 'error'
}) => {
  const payload = JSON.stringify({
    message: input.message,
    serverId: input.serverId,
    status: input.status,
    type: '05_04_api.mcp_oauth',
  }).replace(/</g, '\\u003c')
  const targetOrigin = JSON.stringify(input.responseOrigin ?? '*')

  const isSuccess = input.status === 'authorized'
  const statusLabel = isSuccess ? 'Authorization complete' : 'Authorization failed'
  const statusColor = isSuccess ? '#4ade80' : '#f87171'

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${statusLabel}</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      html{background:#09090b;color:#ececef;font-family:"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
      body{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem}
      .logo{width:80px;height:72px;margin-bottom:2rem;opacity:0.18}
      .status{font-size:15px;font-weight:600;color:${statusColor};margin-bottom:0.5rem}
      .message{font-size:13px;color:#a0a0ab;line-height:1.6;text-align:center;max-width:28rem}
      .hint{margin-top:1.5rem;font-size:11px;color:#63636e}
    </style>
  </head>
  <body>
    <svg class="logo" viewBox="0 0 25.03 22" fill="currentColor" aria-hidden="true">
      <path d="M12.697 22V16.882H6.417a5.15 5.15 0 0 1-5.151-5.15V10.502c0-2.671 1.777-4.936 4.21-5.674L3.862.932 6.113 0l2.904 7.01H6.416a2.715 2.715 0 0 0-2.715 2.715v2.005a2.715 2.715 0 0 0 2.715 2.715h8.717v2.743c1.767-1.297 4.174-3.063 4.655-3.417a3.94 3.94 0 0 0 1.43-2.818V9.724a2.715 2.715 0 0 0-2.715-2.714h-7.769L9.666 4.573h8.836a5.15 5.15 0 0 1 5.151 5.151v1.228a5.24 5.24 0 0 1-2.425 4.783s-6.593 4.839-6.593 4.839L12.697 22Z"/>
      <path d="M18.927.0004 16.461 5.953l2.251.933 2.466-5.953L18.927.0004Z"/>
      <path d="M2.934 9.42H0v2.707h2.934V9.42Z"/>
      <path d="M25.028 9.42h-2.934v2.707h2.934V9.42Z"/>
    </svg>
    <div class="status">${escapeHtml(statusLabel)}</div>
    <p class="message">${escapeHtml(input.message)}</p>
    <p class="hint">This window will close automatically.</p>
    <script>
      const payload = ${payload};
      const targetOrigin = ${targetOrigin};
      const notifyOpener = function() {
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage(payload, targetOrigin);
            return true;
          } catch {}
        }

        return false;
      };

      if (notifyOpener()) {
        setTimeout(notifyOpener, 250);
        setTimeout(notifyOpener, 700);
        setTimeout(function() { window.close(); }, 1200);
      }
    </script>
  </body>
</html>`
}

export const resolveAuthorizationCodeServer = (
  c: Context<AppEnv>,
  tenantScope: ReturnType<typeof requireTenantScope>,
  serverId: string,
) => {
  const repository = createMcpServerRepository(c.get('db'))
  const storedServer = repository.getById(tenantScope, serverId)

  if (storedServer.ok) {
    const config = toMcpServerConfig(storedServer.value, c.get('config').mcp.secretEncryptionKey)

    if (!canStartAuthorizationCodeOAuth(config)) {
      throw new DomainErrorException({
        message: `MCP server ${serverId} does not support browser OAuth authorization`,
        type: 'conflict',
      })
    }

    return toAuthorizationCodeServerConfig(config)
  }

  const staticServer = c
    .get('config')
    .mcp.servers.find(
      (entry) =>
        entry.id === serverId && isStaticServerVisibleToTenant(entry, tenantScope.tenantId),
    )

  if (!staticServer) {
    throw new DomainErrorException(storedServer.error)
  }

  if (!canStartAuthorizationCodeOAuth(staticServer)) {
    throw new DomainErrorException({
      message: `MCP server ${serverId} does not support browser OAuth authorization`,
      type: 'conflict',
    })
  }

  return toAuthorizationCodeServerConfig(staticServer)
}
