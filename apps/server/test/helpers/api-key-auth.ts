import type { AppRuntime } from '../../src/app/runtime'
import {
  accountPreferences,
  accounts,
  apiKeys,
  tenantMemberships,
  tenants,
  toolProfiles,
} from '../../src/db/schema'
import { hashApiKeySecret } from '../../src/shared/api-key'
import type { TenantRole } from '../../src/shared/scope'

export interface SeedApiKeyAuthOptions {
  accountEmail?: string
  accountId?: string
  accountName?: string
  apiKeyId?: string
  expiresAt?: string | null
  includeMembership?: boolean
  includeTenant?: boolean
  role?: TenantRole
  secret?: string
  status?: 'active' | 'revoked' | 'expired'
  tenantId?: string
}

export const createApiKeyAuthHeaders = (
  secret: string,
  tenantId?: string,
): Record<string, string> => {
  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
  }

  if (tenantId) {
    headers['x-tenant-id'] = tenantId
  }

  return headers
}

export const seedApiKeyAuth = (runtime: AppRuntime, options: SeedApiKeyAuthOptions = {}) => {
  const now = '2026-03-29T00:00:00.000Z'
  const accountEmail = options.accountEmail ?? 'ada@example.com'
  const accountId = options.accountId ?? 'acc_test'
  const accountName = options.accountName ?? 'Ada'
  const apiKeyId = options.apiKeyId ?? 'key_test'
  const includeMembership = options.includeMembership ?? true
  const includeTenant = options.includeTenant ?? true
  const role = options.role ?? 'admin'
  const secret = options.secret ?? 'sk_test_1234567890'
  const status = options.status ?? 'active'
  const tenantId = options.tenantId ?? 'ten_test'
  const assistantToolProfileId = `tpf_assistant_${accountId.slice(4)}`

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
    .insert(apiKeys)
    .values({
      accountId,
      createdAt: now,
      expiresAt: options.expiresAt ?? null,
      hashedSecret: hashApiKeySecret(secret),
      id: apiKeyId,
      label: 'Primary key',
      lastFour: secret.slice(-4),
      lastUsedAt: null,
      revokedAt: status === 'revoked' ? now : null,
      scopeJson: null,
      status,
    })
    .run()

  runtime.db
    .insert(toolProfiles)
    .values({
      accountId,
      createdAt: now,
      id: assistantToolProfileId,
      name: `Assistant ${accountId}`,
      scope: 'account_private',
      status: 'active',
      tenantId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        accountId,
        name: `Assistant ${accountId}`,
        scope: 'account_private',
        status: 'active',
        tenantId,
        updatedAt: now,
      },
      target: toolProfiles.id,
    })
    .run()

  runtime.db
    .insert(accountPreferences)
    .values({
      accountId,
      assistantToolProfileId,
      defaultAgentId: null,
      defaultTargetKind: 'assistant',
      shortcutBindings: null,
      tenantId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        assistantToolProfileId,
        defaultAgentId: null,
        defaultTargetKind: 'assistant',
        shortcutBindings: null,
        tenantId,
        updatedAt: now,
      },
      target: [accountPreferences.tenantId, accountPreferences.accountId],
    })
    .run()

  return {
    accountId,
    assistantToolProfileId,
    headers: createApiKeyAuthHeaders(secret, tenantId),
    secret,
    tenantId,
  }
}
