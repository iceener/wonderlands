import { Hono } from 'hono'
import { z } from 'zod'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { searchFilePicker } from '../../../../application/files/file-picker-search'
import { asWorkSessionId } from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'
import { parseQueryAs, unwrapRouteResult } from '../../route-support'

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
  query: z.string().optional(),
  sessionId: z.string().trim().min(1).max(200).optional(),
})

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
          tenantScope: requireTenantScope(c),
        },
      ),
    )

    return c.json(successEnvelope(c, result), 200)
  })

  return routes
}
