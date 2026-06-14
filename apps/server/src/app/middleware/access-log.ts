import { createMiddleware } from 'hono/factory'

import type { AppEnv } from '../types'

const levelRank = {
  debug: 10,
  error: 40,
  info: 20,
  warn: 30,
} as const

const resolveEventLevel = (status: number): keyof typeof levelRank => {
  if (status >= 500) {
    return 'error'
  }

  if (status >= 400) {
    return 'warn'
  }

  return 'info'
}

export const accessLogMiddleware = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const startedAt = performance.now()

    await next()

    const durationMs = Number((performance.now() - startedAt).toFixed(2))
    const eventLevel = resolveEventLevel(c.res.status)
    const logger = c.get('services').logger

    if (levelRank[eventLevel] < levelRank[logger.level]) {
      return
    }

    logger.log(eventLevel, 'HTTP access', {
      durationMs,
      method: c.req.method,
      path: c.req.path,
      requestId: c.get('requestId'),
      status: c.res.status,
      subsystem: 'http',
      traceId: c.get('traceId'),
    })
  })
