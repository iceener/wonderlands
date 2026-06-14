import type { Context } from 'hono'
import { DomainErrorException } from '../shared/errors'
import type { AppEnv } from './types'

export const requireTenantScope = (c: Context<AppEnv>) => {
  const tenantScope = c.get('tenantScope')

  if (!tenantScope) {
    throw new DomainErrorException({
      message: 'This operation requires an authenticated tenant scope',
      type: 'permission',
    })
  }

  return tenantScope
}
