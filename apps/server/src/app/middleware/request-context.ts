import { createMiddleware } from 'hono/factory'

import { asRequestId, asTraceId } from '../../shared/ids'
import type { AppEnv } from '../types'

const createRequestId = (): string => crypto.randomUUID()
const createTraceId = (): string => crypto.randomUUID()

export const requestContextMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = asRequestId(c.req.header('x-request-id') ?? createRequestId())
  const traceId = asTraceId(c.req.header('x-trace-id') ?? createTraceId())

  c.set('requestId', requestId)
  c.set('traceId', traceId)
  c.set('account', null)
  c.set('auth', null)
  c.set('tenantScope', null)
  c.set('requestScope', { kind: 'unauthenticated' })

  c.header('x-request-id', requestId)
  c.header('x-trace-id', traceId)

  await next()
})
