import { createMiddleware } from 'hono/factory'

import { errorEnvelope } from '../../adapters/http/api-envelope'
import type { AppEnv } from '../types'

export const requestSizeGuardMiddleware = (maxBytes: number) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const contentLengthHeader = c.req.header('content-length')

    if (contentLengthHeader) {
      const contentLength = Number.parseInt(contentLengthHeader, 10)

      if (Number.isInteger(contentLength) && contentLength > maxBytes) {
        return c.json(
          errorEnvelope(c, {
            message: 'Request body exceeds the configured limit',
            type: 'validation',
          }),
          413,
        )
      }
    }

    await next()
  })
