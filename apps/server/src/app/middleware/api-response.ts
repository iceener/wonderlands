import { createMiddleware } from 'hono/factory'

import type { AppConfig } from '../config'
import type { AppEnv } from '../types'

export const apiResponseMiddleware = (config: AppConfig) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const startedAt = performance.now()

    await next()

    c.header('cache-control', 'no-store')
    c.header('x-api-version', config.api.version)
    c.header('x-response-time-ms', (performance.now() - startedAt).toFixed(2))
  })
