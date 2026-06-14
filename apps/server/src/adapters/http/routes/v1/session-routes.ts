import { Hono } from 'hono'

import type { AppEnv } from '../../../../app/types'
import { registerSessionBootstrapRoutes } from './session-bootstrap-routes'
import { registerSessionCoreRoutes } from './session-core-routes'

export const createSessionRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()
  registerSessionCoreRoutes(routes)
  registerSessionBootstrapRoutes(routes)

  return routes
}
