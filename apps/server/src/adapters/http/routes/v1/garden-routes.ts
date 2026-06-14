import { Hono } from 'hono'

import { requireAuthenticatedAccount } from '../../../../app/require-authenticated-account'
import { requireTenantScope } from '../../../../app/require-tenant-scope'
import type { AppEnv } from '../../../../app/types'
import { serveGardenArtifact } from '../../../../application/garden/artifact-response'
import {
  parseCreateGardenSiteInput,
  parseRequestGardenBuildInput,
  parseUpdateGardenSiteInput,
} from '../../../../application/garden/garden-service'
import { DomainErrorException } from '../../../../shared/errors'
import { asGardenBuildId, asGardenSiteId } from '../../../../shared/ids'
import { successEnvelope } from '../../api-envelope'
import { parseJsonBody } from '../../parse-json-body'
import { unwrapRouteResult } from '../../route-support'
import {
  buildGardenPreviewMountBasePath,
  resolvePublicGardenRequestPath,
  toGardenService,
} from '../garden-route-support'

export const createGardenRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/', (c) => {
    return c.json(
      successEnvelope(c, unwrapRouteResult(toGardenService(c).listSites(requireTenantScope(c)))),
      200,
    )
  })

  routes.post('/', async (c) => {
    const parsedInput = parseCreateGardenSiteInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(toGardenService(c).createSite(requireTenantScope(c), parsedInput.value)),
      ),
      201,
    )
  })

  routes.get('/:gardenSiteId', (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toGardenService(c).getSiteById(
            requireTenantScope(c),
            asGardenSiteId(c.req.param('gardenSiteId')),
          ),
        ),
      ),
      200,
    )
  })

  routes.patch('/:gardenSiteId', async (c) => {
    const parsedInput = parseUpdateGardenSiteInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toGardenService(c).updateSite(
            requireTenantScope(c),
            asGardenSiteId(c.req.param('gardenSiteId')),
            parsedInput.value,
          ),
        ),
      ),
      200,
    )
  })

  routes.post('/:gardenSiteId/bootstrap-source', async (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          await toGardenService(c).bootstrapSource(
            requireTenantScope(c),
            asGardenSiteId(c.req.param('gardenSiteId')),
          ),
        ),
      ),
      200,
    )
  })

  routes.get('/:gardenSiteId/builds', (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toGardenService(c).listBuilds(
            requireTenantScope(c),
            asGardenSiteId(c.req.param('gardenSiteId')),
          ),
        ),
      ),
      200,
    )
  })

  routes.post('/:gardenSiteId/builds', async (c) => {
    const parsedInput = parseRequestGardenBuildInput(await parseJsonBody(c))

    if (!parsedInput.ok) {
      throw new DomainErrorException(parsedInput.error)
    }

    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          await toGardenService(c).requestBuild(
            requireTenantScope(c),
            asGardenSiteId(c.req.param('gardenSiteId')),
            parsedInput.value,
          ),
        ),
      ),
      201,
    )
  })

  routes.get('/:gardenSiteId/builds/:gardenBuildId', (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toGardenService(c).getBuildById(
            requireTenantScope(c),
            asGardenSiteId(c.req.param('gardenSiteId')),
            asGardenBuildId(c.req.param('gardenBuildId')),
          ),
        ),
      ),
      200,
    )
  })

  routes.post('/:gardenSiteId/publish', (c) => {
    return c.json(
      successEnvelope(
        c,
        unwrapRouteResult(
          toGardenService(c).publishSite(
            requireTenantScope(c),
            asGardenSiteId(c.req.param('gardenSiteId')),
          ),
        ),
      ),
      200,
    )
  })

  routes.get('/:gardenSiteId/preview', async (c) => {
    const result = unwrapRouteResult(
      toGardenService(c).getPreviewBuildForAccount(
        requireAuthenticatedAccount(c).id,
        asGardenSiteId(c.req.param('gardenSiteId')),
      ),
    )

    return serveGardenArtifact(c, {
      allowProtected: true,
      mountBasePath: buildGardenPreviewMountBasePath(c, c.req.param('gardenSiteId')),
      requestPath: '/',
      resolution: result,
    })
  })

  routes.get('/:gardenSiteId/preview/*', async (c) => {
    const mountBasePath = buildGardenPreviewMountBasePath(c, c.req.param('gardenSiteId'))
    const requestPath = resolvePublicGardenRequestPath(c.req.path, {
      mountBasePath,
    })

    if (!requestPath) {
      throw new DomainErrorException({
        message: 'Invalid garden preview path',
        type: 'not_found',
      })
    }

    const result = unwrapRouteResult(
      toGardenService(c).getPreviewBuildForAccount(
        requireAuthenticatedAccount(c).id,
        asGardenSiteId(c.req.param('gardenSiteId')),
      ),
    )

    return serveGardenArtifact(c, {
      allowProtected: true,
      mountBasePath,
      requestPath,
      resolution: result,
    })
  })

  return routes
}
