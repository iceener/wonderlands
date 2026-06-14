import type { AppRuntime } from '../../src/app/runtime'
import { accounts, authSessions, tenantMemberships, tenants } from '../../src/db/schema'
import type { AuthSessionStatus } from '../../src/shared/auth'
import { hashAuthSessionSecret } from '../../src/shared/auth-session'
import type { TenantRole } from '../../src/shared/scope'

export interface SeedAuthSessionOptions {
  accountEmail?: string
  accountId?: string
  accountName?: string
  authSessionId?: string
  cookieName?: string
  expiresAt?: string
  includeMembership?: boolean
  includeTenant?: boolean
  role?: TenantRole
  secret?: string
  status?: AuthSessionStatus
  tenantId?: string
}

export const createAuthSessionCookieHeader = (
  cookieName: string,
  secret: string,
): Record<string, string> => ({
  cookie: `${cookieName}=${secret}`,
})

export const seedAuthSession = (runtime: AppRuntime, options: SeedAuthSessionOptions = {}) => {
  const now = '2026-03-29T00:00:00.000Z'
  const accountEmail = options.accountEmail ?? 'ada@example.com'
  const accountId = options.accountId ?? 'acc_test'
  const accountName = options.accountName ?? 'Ada'
  const authSessionId = options.authSessionId ?? 'aus_test'
  const cookieName = options.cookieName ?? runtime.config.auth.session.cookieName
  const includeMembership = options.includeMembership ?? true
  const includeTenant = options.includeTenant ?? true
  const role = options.role ?? 'admin'
  const secret = options.secret ?? 'ats_test_1234567890'
  const status = options.status ?? 'active'
  const tenantId = options.tenantId ?? 'ten_test'

  runtime.db
    .insert(accounts)
    .values({
      createdAt: now,
      email: accountEmail,
      id: accountId,
      name: accountName,
      preferences: null,
      updatedAt: now,
    })
    .run()

  if (includeTenant) {
    runtime.db
      .insert(tenants)
      .values({
        createdAt: now,
        id: tenantId,
        name: 'Test Tenant',
        slug: tenantId === 'ten_test' ? 'test-tenant' : `${tenantId}-slug`,
        status: 'active',
        updatedAt: now,
      })
      .run()
  }

  if (includeMembership) {
    runtime.db
      .insert(tenantMemberships)
      .values({
        accountId,
        createdAt: now,
        id: `mem_${tenantId}`,
        role,
        tenantId,
      })
      .run()
  }

  runtime.db
    .insert(authSessions)
    .values({
      accountId,
      createdAt: now,
      expiresAt: options.expiresAt ?? '2026-04-29T00:00:00.000Z',
      hashedSecret: hashAuthSessionSecret(secret),
      id: authSessionId,
      lastUsedAt: null,
      metadataJson: null,
      revokedAt: status === 'revoked' ? now : null,
      status,
      updatedAt: now,
    })
    .run()

  return {
    accountId,
    cookieHeader: createAuthSessionCookieHeader(cookieName, secret),
    cookieName,
    secret,
    tenantId,
  }
}
