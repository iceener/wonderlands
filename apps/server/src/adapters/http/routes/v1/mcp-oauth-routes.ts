import type { Context, Hono } from 'hono'

import {
  beginStoredMcpAuthorization,
  completeStoredMcpAuthorization,
} from '../../../../adapters/mcp/oauth-provider'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { createMcpOauthAuthorizationRepository } from '../../../../domain/mcp/mcp-oauth-authorization-repository'
import { DomainErrorException } from '../../../../shared/errors'
import { successEnvelope } from '../../api-envelope'
import { parseJsonBodyAs, parseQueryAs, unwrapRouteResult } from '../../route-support'
import {
  beginMcpAuthorizationInputSchema,
  buildMcpOauthCallbackUrl,
  mcpOauthCallbackQuerySchema,
  renderOauthCompletionPage,
  resolveAuthorizationCodeServer,
} from './mcp-route-support'

const handleMcpOauthCallback = async (c: Context<AppEnv>) => {
  const parsed = (() => {
    try {
      return parseQueryAs(c, mcpOauthCallbackQuerySchema, {
        code: c.req.query('code'),
        error: c.req.query('error'),
        error_description: c.req.query('error_description'),
        state: c.req.query('state'),
      })
    } catch (error) {
      if (!(error instanceof DomainErrorException)) {
        throw error
      }

      return c.html(
        renderOauthCompletionPage({
          message: error.domainError.message,
          responseOrigin: null,
          serverId: null,
          status: 'error',
        }),
        400,
      )
    }
  })()

  if (parsed instanceof Response) {
    return parsed
  }

  const authorizationRepository = createMcpOauthAuthorizationRepository(c.get('db'))
  const authorization = authorizationRepository.getById(parsed.state)

  if (!authorization.ok) {
    return c.html(
      renderOauthCompletionPage({
        message: authorization.error.message,
        responseOrigin: null,
        serverId: null,
        status: 'error',
      }),
      404,
    )
  }

  const tenantScope = {
    accountId: authorization.value.accountId,
    role: 'owner' as const,
    tenantId: authorization.value.tenantId,
  }
  const finalizeAuthorization = () => {
    const deleted = authorizationRepository.deleteById(authorization.value.id)

    if (!deleted.ok) {
      throw new DomainErrorException(deleted.error)
    }
  }

  try {
    if (authorization.value.expiresAt <= c.get('services').clock.nowIso()) {
      finalizeAuthorization()
      return c.html(
        renderOauthCompletionPage({
          message: `MCP OAuth authorization for ${authorization.value.serverId} expired. Start again.`,
          responseOrigin: authorization.value.responseOrigin,
          serverId: authorization.value.serverId,
          status: 'error',
        }),
        410,
      )
    }

    if (parsed.error) {
      finalizeAuthorization()
      return c.html(
        renderOauthCompletionPage({
          message: parsed.error_description ?? `OAuth authorization failed: ${parsed.error}`,
          responseOrigin: authorization.value.responseOrigin,
          serverId: authorization.value.serverId,
          status: 'error',
        }),
        400,
      )
    }

    if (!parsed.code) {
      finalizeAuthorization()
      return c.html(
        renderOauthCompletionPage({
          message: 'OAuth callback is missing its authorization code.',
          responseOrigin: authorization.value.responseOrigin,
          serverId: authorization.value.serverId,
          status: 'error',
        }),
        400,
      )
    }

    const server = resolveAuthorizationCodeServer(c, tenantScope, authorization.value.serverId)

    await completeStoredMcpAuthorization({
      auth: server.auth,
      authorizationCode: parsed.code,
      authorizationId: authorization.value.id,
      db: c.get('db'),
      encryptionKey: c.get('config').mcp.secretEncryptionKey,
      nowIso: c.get('services').clock.nowIso,
      redirectUrl: authorization.value.redirectUri,
      responseOrigin: authorization.value.responseOrigin,
      scope: tenantScope,
      serverId: authorization.value.serverId,
      serverUrl: server.url,
    })

    finalizeAuthorization()

    unwrapRouteResult(
      await c.get('services').mcp.refreshServer(tenantScope, authorization.value.serverId),
    )

    return c.html(
      renderOauthCompletionPage({
        message: `MCP authorization completed for ${authorization.value.serverId}.`,
        responseOrigin: authorization.value.responseOrigin,
        serverId: authorization.value.serverId,
        status: 'authorized',
      }),
      200,
    )
  } catch (error) {
    try {
      finalizeAuthorization()
    } catch {}

    return c.html(
      renderOauthCompletionPage({
        message: error instanceof Error ? error.message : 'Unknown MCP OAuth callback failure',
        responseOrigin: authorization.value.responseOrigin,
        serverId: authorization.value.serverId,
        status: 'error',
      }),
      400,
    )
  }
}

export const registerMcpOauthRoutes = (routes: Hono<AppEnv>): void => {
  routes.post('/servers/:serverId/oauth/start', async (c) => {
    const tenantScope = requireTenantScope(c)
    const serverId = c.req.param('serverId')
    const input = await parseJsonBodyAs(c, beginMcpAuthorizationInputSchema)
    const server = resolveAuthorizationCodeServer(c, tenantScope, serverId)
    const nowIso = c.get('services').clock.nowIso()
    const authorizationRepository = createMcpOauthAuthorizationRepository(c.get('db'))
    unwrapRouteResult(authorizationRepository.deleteExpired(nowIso))

    const started = await beginStoredMcpAuthorization({
      auth: server.auth,
      authorizationId: c.get('services').ids.create('moa'),
      db: c.get('db'),
      encryptionKey: c.get('config').mcp.secretEncryptionKey,
      nowIso: c.get('services').clock.nowIso,
      redirectUrl: buildMcpOauthCallbackUrl(c, serverId),
      responseOrigin: input.responseOrigin ?? null,
      scope: tenantScope,
      serverId,
      serverUrl: server.url,
    })

    if (started.kind === 'authorized') {
      const refreshed = unwrapRouteResult(
        await c.get('services').mcp.refreshServer(tenantScope, serverId),
      )

      return c.json(
        successEnvelope(c, {
          kind: 'authorized' as const,
          snapshot: refreshed,
        }),
        200,
      )
    }

    return c.json(successEnvelope(c, started), 200)
  })

  routes.get('/oauth/callback', handleMcpOauthCallback)
  routes.get('/oauth/:serverId/callback', handleMcpOauthCallback)
}
