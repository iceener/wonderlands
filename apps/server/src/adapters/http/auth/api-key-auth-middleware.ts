import { createMiddleware } from 'hono/factory'

import type { AppConfig } from '../../../app/config'
import type { AppEnv } from '../../../app/types'
import { createApiKeyRepository } from '../../../domain/identity/api-key-repository'
import { hashApiKeySecret, parseBearerToken } from '../../../shared/api-key'
import { DomainErrorException } from '../../../shared/errors'
import type { RequestScope, TenantScope } from '../../../shared/scope'
import { parseTenantIdHeader, resolveTenantScopeForAccount } from './tenant-scope'

export const apiKeyAuthMiddleware = (config: AppConfig) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const authorizationHeader = c.req.header('authorization')
    const tenantIdResult = parseTenantIdHeader(c.req.header('x-tenant-id'))

    if (!tenantIdResult.ok) {
      throw new DomainErrorException(tenantIdResult.error)
    }

    if (!config.auth.methods.includes('api_key')) {
      if (authorizationHeader) {
        throw new DomainErrorException({
          message: 'API key auth is disabled in this runtime profile',
          type: 'auth',
        })
      }

      await next()
      return
    }

    if (c.get('auth')) {
      if (authorizationHeader) {
        throw new DomainErrorException({
          message: 'Request must not mix API key auth with another authentication method',
          type: 'auth',
        })
      }

      await next()
      return
    }

    if (!authorizationHeader) {
      if (tenantIdResult.value) {
        throw new DomainErrorException({
          message: 'x-tenant-id requires Authorization: Bearer <secret>',
          type: 'auth',
        })
      }

      await next()
      return
    }

    const apiKeySecret = parseBearerToken(authorizationHeader)

    if (!apiKeySecret) {
      throw new DomainErrorException({
        message: 'Authorization header must use Bearer <secret>',
        type: 'auth',
      })
    }

    const apiKeyRepository = createApiKeyRepository(c.get('db'))
    const authRecordResult = apiKeyRepository.findAuthRecordByHashedSecret(
      hashApiKeySecret(apiKeySecret),
    )

    if (!authRecordResult.ok) {
      throw new DomainErrorException(authRecordResult.error)
    }

    const authRecord = authRecordResult.value

    if (!authRecord) {
      throw new DomainErrorException({
        message: 'Invalid API key',
        type: 'auth',
      })
    }

    if (authRecord.status !== 'active') {
      throw new DomainErrorException({
        message: `API key is ${authRecord.status}`,
        type: 'auth',
      })
    }

    const authenticatedAt = c.get('services').clock.nowIso()

    if (authRecord.expiresAt && authRecord.expiresAt <= authenticatedAt) {
      throw new DomainErrorException({
        message: 'API key has expired',
        type: 'auth',
      })
    }

    let tenantScope: TenantScope | null = null
    let requestScope: RequestScope = {
      account: authRecord.account,
      kind: 'authenticated',
      tenantScope: null,
    }

    if (tenantIdResult.value) {
      const tenantScopeResult = resolveTenantScopeForAccount(
        c.get('db'),
        authRecord.account.id,
        tenantIdResult.value,
      )

      if (!tenantScopeResult.ok) {
        throw new DomainErrorException(tenantScopeResult.error)
      }

      tenantScope = tenantScopeResult.value
      requestScope = {
        account: authRecord.account,
        kind: 'authenticated',
        tenantScope,
      }
    }

    const markUsedResult = apiKeyRepository.markUsed(authRecord.apiKeyId, authenticatedAt)

    if (!markUsedResult.ok) {
      throw new DomainErrorException(markUsedResult.error)
    }

    c.set('account', authRecord.account)
    c.set('auth', {
      apiKeyId: authRecord.apiKeyId,
      method: 'api_key',
    })
    c.set('tenantScope', tenantScope)
    c.set('requestScope', requestScope)

    await next()
  })
