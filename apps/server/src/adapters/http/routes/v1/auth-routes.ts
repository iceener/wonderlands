import { Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'

import { requireAuthenticatedAccount } from '../../../../app/require-authenticated-account'
import type { AppEnv } from '../../../../app/types'
import { createAuthSessionSecret, hashAuthSessionSecret } from '../../../../shared/auth-session'
import { DomainErrorException } from '../../../../shared/errors'
import { asAccountId, asAuthSessionId } from '../../../../shared/ids'
import { verifyPassword } from '../../../../shared/password'
import { createAuthSessionRepository } from '../../../persistence/sqlite/identity/auth-session-repository'
import { createPasswordCredentialRepository } from '../../../persistence/sqlite/identity/password-credential-repository'
import { createTenantMembershipRepository } from '../../../persistence/sqlite/tenancy/tenant-membership-repository'
import { successEnvelope } from '../../api-envelope'
import { parseJsonBodyAs } from '../../route-support'

const loginInputSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
})

const toAuthPayload = (c: Parameters<typeof requireAuthenticatedAccount>[0]) => {
  const auth = c.get('auth')

  if (!auth || auth.method !== 'auth_session') {
    throw new DomainErrorException({
      message: 'Browser auth session required',
      type: 'auth',
    })
  }

  return {
    expiresAt: auth.expiresAt,
    kind: 'auth_session' as const,
    sessionId: auth.authSessionId,
  }
}

const buildAuthResponse = (c: Parameters<typeof requireAuthenticatedAccount>[0]) => {
  const account = requireAuthenticatedAccount(c)
  const membershipsResult = createTenantMembershipRepository(c.get('db')).listByAccountId(
    account.id,
  )

  if (!membershipsResult.ok) {
    throw new DomainErrorException(membershipsResult.error)
  }

  return {
    account,
    auth: toAuthPayload(c),
    memberships: membershipsResult.value.map((membership) => ({
      role: membership.role,
      tenantId: membership.tenantId,
      tenantName: membership.tenantName,
      tenantSlug: membership.tenantSlug,
    })),
    tenantScope: c.get('tenantScope'),
  }
}

const sessionCookieOptions = (c: Parameters<typeof requireAuthenticatedAccount>[0]) => ({
  httpOnly: true,
  maxAge: c.get('config').auth.session.maxAgeSeconds,
  path: '/',
  sameSite: c.get('config').auth.session.sameSite,
  secure: c.get('config').auth.session.secure,
})

const issueAuthSession = (
  c: Parameters<typeof requireAuthenticatedAccount>[0],
  input: {
    accountId: string
  },
) => {
  if (!c.get('config').auth.methods.includes('auth_session')) {
    throw new DomainErrorException({
      message: 'Browser auth sessions are disabled in this runtime profile',
      type: 'auth',
    })
  }

  const issuedAt = c.get('services').clock.nowIso()
  const expiresAt = new Date(
    Date.parse(issuedAt) + c.get('config').auth.session.maxAgeSeconds * 1000,
  ).toISOString()
  const authSessionId = asAuthSessionId(c.get('services').ids.create('aus'))
  const authSessionSecret = createAuthSessionSecret()
  const authSessionRepository = createAuthSessionRepository(c.get('db'))
  const createResult = authSessionRepository.create({
    accountId: asAccountId(input.accountId),
    createdAt: issuedAt,
    expiresAt,
    hashedSecret: hashAuthSessionSecret(authSessionSecret),
    id: authSessionId,
    status: 'active',
    updatedAt: issuedAt,
  })

  if (!createResult.ok) {
    throw new DomainErrorException(createResult.error)
  }

  setCookie(c, c.get('config').auth.session.cookieName, authSessionSecret, sessionCookieOptions(c))
  c.set('auth', {
    authSessionId,
    expiresAt,
    method: 'auth_session',
  })
}

export const createAuthRoutes = (): Hono<AppEnv> => {
  const routes = new Hono<AppEnv>()

  routes.get('/session', (c) => {
    toAuthPayload(c)
    requireAuthenticatedAccount(c)

    return c.json(successEnvelope(c, buildAuthResponse(c)), 200)
  })

  routes.post('/login', async (c) => {
    const parsedInput = await parseJsonBodyAs(c, loginInputSchema)

    const passwordCredentialRepository = createPasswordCredentialRepository(c.get('db'))
    const authRecord = passwordCredentialRepository.findAuthRecordByEmail(parsedInput.email)

    if (!authRecord.ok) {
      throw new DomainErrorException(authRecord.error)
    }

    if (!authRecord.value || !verifyPassword(parsedInput.password, authRecord.value.passwordHash)) {
      throw new DomainErrorException({
        message: 'Invalid email or password',
        type: 'auth',
      })
    }

    c.set('account', authRecord.value.account)
    c.set('requestScope', {
      account: authRecord.value.account,
      kind: 'authenticated',
      tenantScope: null,
    })
    c.set('tenantScope', null)

    issueAuthSession(c, {
      accountId: authRecord.value.account.id,
    })

    return c.json(successEnvelope(c, buildAuthResponse(c)), 201)
  })

  routes.post('/logout', (c) => {
    const requestAuth = c.get('auth')

    if (requestAuth?.method === 'auth_session') {
      const revokedAt = c.get('services').clock.nowIso()
      const revokeResult = createAuthSessionRepository(c.get('db')).revoke(
        requestAuth.authSessionId,
        revokedAt,
      )

      if (!revokeResult.ok) {
        throw new DomainErrorException(revokeResult.error)
      }
    }

    deleteCookie(c, c.get('config').auth.session.cookieName, sessionCookieOptions(c))

    return c.json(
      successEnvelope(c, {
        loggedOut: true,
      }),
      200,
    )
  })

  return routes
}
