import type { AppRuntime } from '../../src/app/runtime'
import { accounts, passwordCredentials, tenantMemberships, tenants } from '../../src/db/schema'
import { hashPassword, normalizeAuthEmail } from '../../src/shared/password'
import type { TenantRole } from '../../src/shared/scope'

export interface SeedPasswordAuthOptions {
  accountEmail?: string
  accountId?: string
  accountName?: string
  includeMembership?: boolean
  includeTenant?: boolean
  password?: string
  role?: TenantRole
  tenantId?: string
}

export const seedPasswordAuth = (runtime: AppRuntime, options: SeedPasswordAuthOptions = {}) => {
  const now = '2026-03-29T00:00:00.000Z'
  const accountEmail = normalizeAuthEmail(options.accountEmail ?? 'ada@example.com')
  const accountId = options.accountId ?? 'acc_test'
  const accountName = options.accountName ?? 'Ada'
  const includeMembership = options.includeMembership ?? true
  const includeTenant = options.includeTenant ?? true
  const password = options.password ?? 'correct horse battery staple'
  const role = options.role ?? 'admin'
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
    .insert(passwordCredentials)
    .values({
      accountId,
      createdAt: now,
      passwordHash: hashPassword(password),
      updatedAt: now,
    })
    .run()

  return {
    accountEmail,
    accountId,
    password,
    tenantId,
  }
}
