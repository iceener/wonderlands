import { Hono } from 'hono'

import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import {
  createToolProfileService,
  parseCreateToolProfileInput,
  parseUpdateToolProfileInput,
} from '../../../../application/tool-access/tool-profile-service'
import { DomainErrorException } from '../../../../shared/errors'
import { asToolProfileId } from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'
import { parseJsonBody } from '../../parse-json-body'
import { unwrapRouteResult } from '../../route-support'

const toToolProfileService = (c: Parameters<typeof requireTenantScope>[0]) =>
  createToolProfileService({
    createId: c.get('services').ids.create,
    db: c.get('db'),
    now: () => c.get('services').clock.nowIso(),
  })

export const createToolProfileRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/', (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(toToolProfileService(c).listToolProfiles(requireTenantScope(c))),
      ),
      200,
    )
  })

  routes.post('/', async (c) => {
    const parsedInput = parseCreateToolProfileInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toToolProfileService(c).createToolProfile(requireTenantScope(c), parsedInput.value),
        ),
      ),
      201,
    )
  })

  routes.get('/:toolProfileId', (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toToolProfileService(c).getToolProfileById(
            requireTenantScope(c),
            asToolProfileId(c.req.param('toolProfileId')),
          ),
        ),
      ),
      200,
    )
  })

  routes.patch('/:toolProfileId', async (c) => {
    const parsedInput = parseUpdateToolProfileInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toToolProfileService(c).updateToolProfile(
            requireTenantScope(c),
            asToolProfileId(c.req.param('toolProfileId')),
            parsedInput.value,
          ),
        ),
      ),
      200,
    )
  })

  return routes
}
