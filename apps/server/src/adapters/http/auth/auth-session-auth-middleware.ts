import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'

import type { AppConfig } from '../../../app/config'
import type { AppEnv } from '../../../app/types'
import { createAuthSessionRepository } from '../../../domain/identity/auth-session-repository'
import { hashAuthSessionSecret } from '../../../shared/auth-session'
import { DomainErrorException } from '../../../shared/errors'
import type { RequestScope, TenantScope } from '../../../shared/scope'
import { parseTenantIdHeader, resolveTenantScopeForAccount } from './tenant-scope'

export const authSessionAuthMiddleware = (config: AppConfig) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const sessionSecret = getCookie(c, config.auth.session.cookieName)
    const tenantIdResult = parseTenantIdHeader(c.req.header('x-tenant-id'))

    if (!tenantIdResult.ok) {
      throw new DomainErrorException(tenantIdResult.error)
    }

    if (!config.auth.methods.includes('auth_session')) {
      await next()
      return
    }

    if (!sessionSecret) {
      await next()
      return
    }

    const authSessionRepository = createAuthSessionRepository(c.get('db'))
    const authRecordResult = authSessionRepository.findAuthRecordByHashedSecret(
      hashAuthSessionSecret(sessionSecret),
    )

    if (!authRecordResult.ok) {
      throw new DomainErrorException(authRecordResult.error)
    }

    const authRecord = authRecordResult.value
    const authenticatedAt = c.get('services').clock.nowIso()

    if (!authRecord) {
      await next()
      return
    }

    if (authRecord.status !== 'active' || authRecord.expiresAt <= authenticatedAt) {
      await next()
      return
    }

    const markUsedResult = authSessionRepository.markUsed(authRecord.id, authenticatedAt)

    if (!markUsedResult.ok) {
      throw new DomainErrorException(markUsedResult.error)
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

    c.set('account', authRecord.account)
    c.set('auth', {
      authSessionId: authRecord.id,
      expiresAt: authRecord.expiresAt,
      method: 'auth_session',
    })
    c.set('tenantScope', tenantScope)
    c.set('requestScope', requestScope)

    await next()
  })
