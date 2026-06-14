import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { authSessionStatusValues } from '../../shared/auth'
import { tenantRoleValues } from '../../shared/scope'

const apiKeyStatusValues = ['active', 'revoked', 'expired'] as const
const tenantStatusValues = ['active', 'archived', 'deleted'] as const

export const accounts = sqliteTable(
  'accounts',
  {
    createdAt: text('created_at').notNull(),
    email: text('email'),
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    preferences: text('preferences', { mode: 'json' }),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('accounts_email_unique').on(table.email)],
)

export const apiKeys = sqliteTable(
  'api_keys',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at'),
    hashedSecret: text('hashed_secret').notNull(),
    id: text('id').primaryKey(),
    label: text('label'),
    lastFour: text('last_four').notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
    scopeJson: text('scope_json', { mode: 'json' }),
    status: text('status', { enum: apiKeyStatusValues }).notNull(),
  },
  (table) => [
    index('api_keys_account_id_idx').on(table.accountId),
    index('api_keys_account_status_idx').on(table.accountId, table.status),
    uniqueIndex('api_keys_hashed_secret_unique').on(table.hashedSecret),
  ],
)

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    hashedSecret: text('hashed_secret').notNull(),
    id: text('id').primaryKey(),
    lastUsedAt: text('last_used_at'),
    metadataJson: text('metadata_json', { mode: 'json' }),
    revokedAt: text('revoked_at'),
    status: text('status', { enum: authSessionStatusValues }).notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('auth_sessions_account_id_idx').on(table.accountId),
    index('auth_sessions_account_status_idx').on(table.accountId, table.status),
    index('auth_sessions_expires_at_idx').on(table.expiresAt),
    uniqueIndex('auth_sessions_hashed_secret_unique').on(table.hashedSecret),
  ],
)

export const passwordCredentials = sqliteTable(
  'password_credentials',
  {
    accountId: text('account_id')
      .primaryKey()
      .notNull()
      .references(() => accounts.id),
    createdAt: text('created_at').notNull(),
    passwordHash: text('password_hash').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('password_credentials_updated_at_idx').on(table.updatedAt)],
)

export const tenants = sqliteTable(
  'tenants',
  {
    createdAt: text('created_at').notNull(),
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: text('status', { enum: tenantStatusValues }).notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('tenants_slug_unique').on(table.slug),
    index('tenants_status_idx').on(table.status),
  ],
)

export const tenantMemberships = sqliteTable(
  'tenant_memberships',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    createdAt: text('created_at').notNull(),
    id: text('id').primaryKey(),
    role: text('role', { enum: tenantRoleValues }).notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
  },
  (table) => [
    uniqueIndex('tenant_memberships_tenant_account_unique').on(table.tenantId, table.accountId),
    index('tenant_memberships_account_id_idx').on(table.accountId),
  ],
)
