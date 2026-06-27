import { basename } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppConfig } from '../../../../app/config'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import {
  type McpFileRoot,
  searchFilePicker,
} from '../../../../application/files/file-picker-search'
import { asWorkSessionId } from '../../../../shared/ids'
import type { TenantScope } from '../../../../shared/scope'
import { successEnvelope } from '../../api-envelope'
import { parseQueryAs, unwrapRouteResult } from '../../route-support'
import { isStaticServerVisibleToTenant } from './mcp-route-support'

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
  query: z.string().optional(),
  sessionId: z.string().trim().min(1).max(200).optional(),
})

// Filesystem MCP servers (stdio with an explicit FS_ROOTS) expose local folders
// the agent can read. Surface those folders in the `#` picker alongside the
// vault. Workspace-scoped servers are skipped: their root is the account vault,
// which the picker already indexes.
const resolveMcpFileRoots = (config: AppConfig, tenantScope: TenantScope): McpFileRoot[] => {
  const roots: McpFileRoot[] = []

  for (const server of config.mcp.servers) {
    if (
      server.kind !== 'stdio' ||
      server.workspaceScoped ||
      server.enabled === false ||
      !isStaticServerVisibleToTenant(server, tenantScope.tenantId)
    ) {
      continue
    }

    const fsRoots = server.env?.FS_ROOTS

    if (!fsRoots) {
      continue
    }

    for (const rawPath of fsRoots.split(',')) {
      const rootPath = rawPath.trim()

      if (rootPath) {
        roots.push({ mountId: basename(rootPath), rootPath })
      }
    }
  }

  return roots
}

export const createFilePickerRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/search', async (c) => {
    const parsed = parseQueryAs(c, querySchema, {
      limit: c.req.query('limit'),
      query: c.req.query('query') ?? '',
      sessionId: c.req.query('sessionId') ?? undefined,
    })

    const result = unwrapRouteResult(
      await searchFilePicker(
        c.get('db'),
        {
          limit: parsed.limit,
          query: parsed.query,
          sessionId: parsed.sessionId ? asWorkSessionId(parsed.sessionId) : null,
        },
        {
          createId: c.get('services').ids.create,
          fileStorageRoot: c.get('config').files.storage.root,
          mcpFileRoots: resolveMcpFileRoots(c.get('config'), requireTenantScope(c)),
          tenantScope: requireTenantScope(c),
        },
      ),
    )

    return c.json(successEnvelope(c, result), 200)
  })

  return routes
}
