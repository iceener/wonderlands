import type { Hono } from 'hono'

import { getMcpRuntimeNameAliasesFromRuntimeName } from '../../../../adapters/mcp/normalize-tool'
import { isAuthorizationCodeServer } from '../../../../adapters/mcp/oauth-authorization-code'
import { createMcpServerRepository } from '../../../../adapters/persistence/sqlite/mcp/mcp-server-repository'
import { createMcpToolAssignmentRepository } from '../../../../adapters/persistence/sqlite/mcp/mcp-tool-assignment-repository'
import { createMcpToolCacheRepository } from '../../../../adapters/persistence/sqlite/mcp/mcp-tool-cache-repository'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { DomainErrorException } from '../../../../shared/errors'
import { asToolProfileId } from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'
import { parseJsonBodyAs, parseQueryAs, unwrapRouteResult } from '../../route-support'
import {
  assignMcpToolInputSchema,
  deleteMcpToolAssignmentQuerySchema,
  isStaticServerVisibleToTenant,
  listAssignmentsByProfileOrEmpty,
  mcpAppOriginQuerySchema,
  mcpAppToolCallInputSchema,
  resolveAssignedTool,
  resolveMcpServerId,
  resolveRequestedToolProfileId,
  resolveRuntimeNameForServerTool,
  toApiDbServer,
  toApiStaticServer,
  toApiStaticTool,
  toAssignmentByRuntimeName,
} from './mcp-route-support'

export const registerMcpToolRoutes = (routes: Hono<AppEnv>): void => {
  routes.get('/servers/:serverId/tools', (c) => {
    const tenantScope = requireTenantScope(c)
    const serverId = c.req.param('serverId')
    const serverRepository = createMcpServerRepository(c.get('db'))
    const toolRepository = createMcpToolCacheRepository(c.get('db'))
    const server = serverRepository.getById(tenantScope, serverId)

    if (!server.ok) {
      const staticServer = c
        .get('config')
        .mcp.servers.find(
          (entry) =>
            entry.id === serverId && isStaticServerVisibleToTenant(entry, tenantScope.tenantId),
        )

      if (!staticServer) {
        throw new DomainErrorException(server.error)
      }

      const profile = resolveRequestedToolProfileId({ toolProfileId: c.req.query('toolProfileId') })
      const snapshot = c.get('services').mcp.getServerSnapshot(tenantScope, serverId)
      const assignments = unwrapRouteResult(
        listAssignmentsByProfileOrEmpty(c.get('db'), tenantScope, profile),
      )
      const assignmentByRuntimeName = toAssignmentByRuntimeName(assignments)

      const tools = c
        .get('services')
        .mcp.listTools()
        .filter((tool) => tool.serverId === serverId)
        .filter(() =>
          isAuthorizationCodeServer(staticServer) ? snapshot?.status === 'ready' : true,
        )
        .map((tool) => ({
          ...toApiStaticTool(tenantScope.tenantId, tool),
          assignment: resolveAssignedTool(assignmentByRuntimeName, tool.runtimeName),
        }))

      return c.json(
        successEnvelope(c, {
          toolProfileId: profile ?? null,
          server: toApiStaticServer(staticServer, tenantScope.tenantId),
          tools,
        }),
        200,
      )
    }

    const tools = unwrapRouteResult(toolRepository.listByServerId(tenantScope, serverId))

    const profile = resolveRequestedToolProfileId({ toolProfileId: c.req.query('toolProfileId') })
    const assignments = unwrapRouteResult(
      listAssignmentsByProfileOrEmpty(c.get('db'), tenantScope, profile),
    )
    const assignmentByRuntimeName = toAssignmentByRuntimeName(assignments)

    return c.json(
      successEnvelope(c, {
        toolProfileId: profile ?? null,
        server: toApiDbServer(server.value, c.get('config').mcp.secretEncryptionKey),
        tools: tools.map((tool) => ({
          ...tool,
          assignment: resolveAssignedTool(assignmentByRuntimeName, tool.runtimeName),
        })),
      }),
      200,
    )
  })

  routes.post('/assignments', async (c) => {
    const tenantScope = requireTenantScope(c)
    const input = await parseJsonBodyAs(c, assignMcpToolInputSchema)
    const toolProfileId = resolveRequestedToolProfileId(input)

    if (!toolProfileId) {
      throw new DomainErrorException({
        message: 'toolProfileId is required',
        type: 'validation',
      })
    }

    const serverRepository = createMcpServerRepository(c.get('db'))
    const toolRepository = createMcpToolCacheRepository(c.get('db'))
    const assignmentRepository = createMcpToolAssignmentRepository(c.get('db'))
    const server = serverRepository.getById(tenantScope, input.serverId)

    let resolvedRuntimeName: string | null = null

    if (server.ok) {
      resolvedRuntimeName = resolveRuntimeNameForServerTool(
        unwrapRouteResult(toolRepository.listByServerId(tenantScope, input.serverId)),
        input.runtimeName,
      )
    } else {
      const staticServer = c
        .get('config')
        .mcp.servers.find(
          (entry) =>
            entry.id === input.serverId &&
            isStaticServerVisibleToTenant(entry, tenantScope.tenantId),
        )

      if (!staticServer) {
        throw new DomainErrorException(server.error)
      }

      resolvedRuntimeName = resolveRuntimeNameForServerTool(
        c
          .get('services')
          .mcp.listTools()
          .filter((tool) => tool.serverId === input.serverId),
        input.runtimeName,
      )
    }

    if (!resolvedRuntimeName) {
      throw new DomainErrorException({
        message: `MCP tool ${input.runtimeName} not found for server ${input.serverId}`,
        type: 'not_found',
      })
    }

    const assignment = assignmentRepository.upsert(tenantScope, {
      id: c.get('services').ids.create('mta'),
      requiresConfirmation: input.requiresConfirmation ?? true,
      runtimeName: resolvedRuntimeName,
      serverId: input.serverId,
      toolProfileId: asToolProfileId(toolProfileId),
      updatedAt: c.get('services').clock.nowIso(),
    })

    if (!assignment.ok) {
      throw new DomainErrorException(assignment.error)
    }

    for (const legacyRuntimeName of getMcpRuntimeNameAliasesFromRuntimeName(resolvedRuntimeName)) {
      if (legacyRuntimeName === resolvedRuntimeName) {
        continue
      }

      const deleted = assignmentRepository.deleteByRuntimeName(
        tenantScope,
        toolProfileId,
        legacyRuntimeName,
      )

      if (!deleted.ok && deleted.error.type !== 'not_found') {
        throw new DomainErrorException(deleted.error)
      }
    }

    return c.json(
      successEnvelope(c, {
        assignment: assignment.value,
      }),
      201,
    )
  })

  routes.delete('/assignments/:runtimeName', async (c) => {
    const tenantScope = requireTenantScope(c)
    const runtimeName = c.req.param('runtimeName')
    const query = parseQueryAs(c, deleteMcpToolAssignmentQuerySchema, {
      toolProfileId: c.req.query('toolProfileId'),
    })

    const assignmentRepository = createMcpToolAssignmentRepository(c.get('db'))
    const toolProfileId = resolveRequestedToolProfileId(query)

    if (!toolProfileId) {
      throw new DomainErrorException({
        message: 'toolProfileId is required',
        type: 'validation',
      })
    }

    const deleted = assignmentRepository.deleteByAnyRuntimeName(
      tenantScope,
      toolProfileId,
      getMcpRuntimeNameAliasesFromRuntimeName(runtimeName),
    )

    if (!deleted.ok) {
      throw new DomainErrorException(deleted.error)
    }

    return c.json(
      successEnvelope(c, {
        assignment: deleted.value,
      }),
      200,
    )
  })

  routes.post('/tools/call', async (c) => {
    const tenantScope = requireTenantScope(c)
    const input = await parseJsonBodyAs(c, mcpAppToolCallInputSchema)
    const serverId = resolveMcpServerId(c, input.serverId, input.toolName)
    const result = await c.get('services').mcp.callServerTool({
      args: input.arguments ?? null,
      name: input.name,
      serverId,
      tenantScope,
    })

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 200)
  })

  routes.get('/resources/list', async (c) => {
    const tenantScope = requireTenantScope(c)
    const query = parseQueryAs(c, mcpAppOriginQuerySchema, {
      cursor: c.req.query('cursor'),
      serverId: c.req.query('serverId'),
      toolName: c.req.query('toolName'),
    })

    const serverId = resolveMcpServerId(c, query.serverId, query.toolName)
    const result = await c.get('services').mcp.listResources({
      cursor: query.cursor,
      serverId,
      tenantScope,
    })

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 200)
  })

  routes.get('/resources/templates/list', async (c) => {
    const tenantScope = requireTenantScope(c)
    const query = parseQueryAs(c, mcpAppOriginQuerySchema, {
      cursor: c.req.query('cursor'),
      serverId: c.req.query('serverId'),
      toolName: c.req.query('toolName'),
    })

    const serverId = resolveMcpServerId(c, query.serverId, query.toolName)
    const result = await c.get('services').mcp.listResourceTemplates({
      cursor: query.cursor,
      serverId,
      tenantScope,
    })

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(successEnvelope(c, result.value), 200)
  })

  routes.get('/resources/read', async (c) => {
    const tenantScope = requireTenantScope(c)
    const query = parseQueryAs(c, mcpAppOriginQuerySchema, {
      format: c.req.query('format'),
      serverId: c.req.query('serverId'),
      toolName: c.req.query('toolName'),
      uri: c.req.query('uri'),
    })

    if (!query.uri) {
      throw new DomainErrorException({
        message: 'Missing required query parameter: uri',
        type: 'validation',
      })
    }

    const serverId = resolveMcpServerId(c, query.serverId, query.toolName)

    if (query.format === 'raw') {
      const rawResult = await c.get('services').mcp.readRawResource({
        serverId,
        tenantScope,
        uri: query.uri,
      })

      if (!rawResult.ok) {
        throw new DomainErrorException(rawResult.error)
      }

      return c.json(successEnvelope(c, rawResult.value), 200)
    }

    const result = await c.get('services').mcp.readResource({
      serverId,
      tenantScope,
      uri: query.uri,
    })

    if (!result.ok) {
      throw new DomainErrorException(result.error)
    }

    return c.json(
      successEnvelope(c, {
        html: result.value.html,
        mimeType: result.value.mimeType,
      }),
      200,
    )
  })
}
