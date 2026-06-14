import { createMiddleware } from 'hono/factory'

import type { AppRuntime } from '../runtime'
import type { AppEnv } from '../types'

export const runtimeContextMiddleware = (runtime: AppRuntime) =>
  createMiddleware<AppEnv>(async (c, next) => {
    c.set('config', runtime.config)
    c.set('db', runtime.db)
    c.set('services', runtime.services)

    await next()
  })
