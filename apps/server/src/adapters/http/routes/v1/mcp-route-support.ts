import type { Context } from 'hono'
import type { z } from 'zod'
import {
  canStartAuthorizationCodeOAuth,
  toAuthorizationCodeServerConfig,
} from '../../../../adapters/mcp/oauth-authorization-code'
import { toMcpServerConfig } from '../../../../adapters/mcp/server-config'
import { protectStoredHttpAuthConfig } from '../../../../adapters/mcp/stored-auth'
import { createMcpServerRepository } from '../../../../adapters/persistence/sqlite/mcp/mcp-server-repository'
import { createMcpToolAssignmentRepository } from '../../../../adapters/persistence/sqlite/mcp/mcp-tool-assignment-repository'
import type { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import type { RepositoryDatabase } from '../../../../domain/database-port'
import { DomainErrorException } from '../../../../shared/errors'
import { ok } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import { isStaticServerVisibleToTenant } from './mcp-route-presenters'
import type { createMcpServerInputSchema } from './mcp-route-schemas'

// Re-exported for backward compatibility so existing route imports of
// schemas/presenters/OAuth-completion-page from `./mcp-route-support` keep
// working after the god-module split.
export * from './mcp-oauth-completion-page'
export * from './mcp-route-presenters'
export * from './mcp-route-schemas'

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

export const listAssignmentsByProfileOrEmpty = (
  db: RepositoryDatabase,
  tenantScope: TenantScope,
  toolProfileId: string | null,
) =>
  toolProfileId
    ? createMcpToolAssignmentRepository(db).listByProfile(tenantScope, toolProfileId)
    : ok([])

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
