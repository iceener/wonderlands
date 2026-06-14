import { Hono } from 'hono'

import type { AppEnv } from '../../../../app/types'
import { registerThreadMemoryRoutes } from './thread-memory-routes'
import { registerThreadMutationRoutes } from './thread-mutation-routes'
import { registerThreadQueryRoutes } from './thread-query-routes'

export const createThreadRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()
  registerThreadQueryRoutes(routes)
  registerThreadMutationRoutes(routes)
  registerThreadMemoryRoutes(routes)

  return routes
}
