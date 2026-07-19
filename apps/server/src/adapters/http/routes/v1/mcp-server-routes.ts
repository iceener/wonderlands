import type { Hono } from 'hono'

import { createMcpOauthAuthorizationRepository } from '../../../../adapters/persistence/sqlite/mcp/mcp-oauth-authorization-repository'
import { createMcpOauthCredentialRepository } from '../../../../adapters/persistence/sqlite/mcp/mcp-oauth-credential-repository'
import { createMcpServerRepository } from '../../../../adapters/persistence/sqlite/mcp/mcp-server-repository'
import { createMcpToolAssignmentRepository } from '../../../../adapters/persistence/sqlite/mcp/mcp-tool-assignment-repository'
import { createMcpToolCacheRepository } from '../../../../adapters/persistence/sqlite/mcp/mcp-tool-cache-repository'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { successEnvelope } from '../../api-envelope'
import { parseJsonBodyAs, unwrapRouteResult } from '../../route-support'
import {
  createMcpServerInputSchema,
  isStaticServerVisibleToTenant,
  toApiDbServer,
  toApiStaticServer,
  toMcpServerUpsertInput,
} from './mcp-route-support'

export const registerMcpServerRoutes = (routes: Hono<AppEnv>): void => {
  routes.get('/servers', (c) => {
    const tenantScope = requireTenantScope(c)
    const repository = createMcpServerRepository(c.get('db'))
    const result = unwrapRouteResult(repository.listByAccount(tenantScope))

    const staticServers = c
      .get('config')
      .mcp.servers.filter((server) => isStaticServerVisibleToTenant(server, tenantScope.tenantId))
      .map((server) => toApiStaticServer(server, tenantScope.tenantId))
    const entries = [
      ...staticServers,
      ...result.map((server) => toApiDbServer(server, c.get('config').mcp.secretEncryptionKey)),
    ].sort((left, right) => {
      const labelOrder = left.label.localeCompare(right.label)
      return labelOrder !== 0 ? labelOrder : left.id.localeCompare(right.id)
    })

    return c.json(
      successEnvelope(
        c,
        entries.map((server) => ({
          ...server,
          snapshot: c.get('services').mcp.getServerSnapshot(tenantScope, server.id),
        })),
      ),
      200,
    )
  })

  routes.post('/servers', async (c) => {
    const tenantScope = requireTenantScope(c)
    const input = await parseJsonBodyAs(c, createMcpServerInputSchema)
    const now = c.get('services').clock.nowIso()
    const repository = createMcpServerRepository(c.get('db'))
    const created = unwrapRouteResult(
      repository.create(tenantScope, {
        ...toMcpServerUpsertInput(input, {
          encryptionKey: c.get('config').mcp.secretEncryptionKey,
          id: c.get('services').ids.create('mcs'),
          now,
        }),
        createdAt: now,
      }),
    )

    const refreshed = unwrapRouteResult(
      await c.get('services').mcp.refreshServer(tenantScope, created.id),
    )

    return c.json(
      successEnvelope(c, {
        server: toApiDbServer(created, c.get('config').mcp.secretEncryptionKey),
        snapshot: refreshed,
      }),
      201,
    )
  })

  routes.patch('/servers/:serverId', async (c) => {
    const tenantScope = requireTenantScope(c)
    const serverId = c.req.param('serverId')
    const input = await parseJsonBodyAs(c, createMcpServerInputSchema)
    const now = c.get('services').clock.nowIso()
    const repository = createMcpServerRepository(c.get('db'))
    const updated = unwrapRouteResult(
      repository.update(
        tenantScope,
        toMcpServerUpsertInput(input, {
          encryptionKey: c.get('config').mcp.secretEncryptionKey,
          id: serverId,
          now,
        }),
      ),
    )

    const refreshed = unwrapRouteResult(
      await c.get('services').mcp.refreshServer(tenantScope, updated.id),
    )

    return c.json(
      successEnvelope(c, {
        server: toApiDbServer(updated, c.get('config').mcp.secretEncryptionKey),
        snapshot: refreshed,
      }),
      200,
    )
  })

  routes.delete('/servers/:serverId', async (c) => {
    const tenantScope = requireTenantScope(c)
    const serverId = c.req.param('serverId')
    const oauthAuthorizationRepository = createMcpOauthAuthorizationRepository(c.get('db'))
    const oauthCredentialRepository = createMcpOauthCredentialRepository(c.get('db'))
    const serverRepository = createMcpServerRepository(c.get('db'))
    const toolAssignmentRepository = createMcpToolAssignmentRepository(c.get('db'))
    const toolCacheRepository = createMcpToolCacheRepository(c.get('db'))

    const deletedAssignments = unwrapRouteResult(
      toolAssignmentRepository.deleteByServerId(tenantScope, serverId),
    )
    const deletedCache = unwrapRouteResult(
      toolCacheRepository.deleteByServerId(tenantScope, serverId),
    )
    const deletedCredentials = unwrapRouteResult(
      oauthCredentialRepository.deleteByServerId(tenantScope, serverId),
    )

    const pendingAuthorization = oauthAuthorizationRepository.getByServerId(tenantScope, serverId)

    if (pendingAuthorization.ok) {
      unwrapRouteResult(oauthAuthorizationRepository.deleteById(pendingAuthorization.value.id))
    }

    const deletedServer = unwrapRouteResult(serverRepository.delete(tenantScope, serverId))
    unwrapRouteResult(await c.get('services').mcp.removeRegisteredServer(tenantScope, serverId))

    return c.json(
      successEnvelope(c, {
        deletedToolAssignments: deletedAssignments,
        deletedTools: deletedCache,
        serverId: deletedServer.id,
      }),
      200,
    )
  })

  routes.post('/servers/:serverId/refresh', async (c) => {
    const tenantScope = requireTenantScope(c)
    const serverId = c.req.param('serverId')
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(await c.get('services').mcp.refreshServer(tenantScope, serverId)),
      ),
      200,
    )
  })
}
