import type { Context } from 'hono'
import { DomainErrorException } from '../shared/errors'
import type { AppEnv } from './types'

export const requireAuthenticatedAccount = (c: Context<AppEnv>) => {
  const requestScope = c.get('requestScope')

  if (requestScope.kind !== 'authenticated') {
    throw new DomainErrorException({
      message: 'This operation requires an authenticated account',
      type: 'auth',
    })
  }

  return requestScope.account
}
