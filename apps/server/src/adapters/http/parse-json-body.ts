import type { Context } from 'hono'

import type { AppEnv } from '../../app/types'
import { DomainErrorException } from '../../shared/errors'

export const parseJsonBody = async (c: Context<AppEnv>): Promise<unknown> => {
  try {
    return await c.req.json()
  } catch {
    throw new DomainErrorException({
      message: 'Malformed JSON request body',
      type: 'validation',
    })
  }
}
