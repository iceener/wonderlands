import { Hono } from 'hono'

import type { AppEnv } from '../../../../app/types'
import { registerMcpOauthRoutes } from './mcp-oauth-routes'
import { registerMcpServerRoutes } from './mcp-server-routes'
import { registerMcpToolRoutes } from './mcp-tool-routes'

export const createMcpRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  registerMcpServerRoutes(routes)
  registerMcpOauthRoutes(routes)
  registerMcpToolRoutes(routes)

  return routes
}
