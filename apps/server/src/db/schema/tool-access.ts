import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { accounts, tenants } from './identity'

const toolProfileScopeValues = ['account_private', 'tenant_shared', 'system'] as const
const toolProfileStatusValues = ['active', 'archived', 'deleted'] as const

export const toolProfiles = sqliteTable(
  'tool_profiles',
  {
    accountId: text('account_id').references(() => accounts.id),
    createdAt: text('created_at').notNull(),
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    scope: text('scope', { enum: toolProfileScopeValues }).notNull(),
    status: text('status', { enum: toolProfileStatusValues }).notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check(
      'tool_profiles_account_private_rule',
      sql`(${table.scope} <> 'account_private' or ${table.accountId} is not null)`,
    ),
    uniqueIndex('tool_profiles_id_tenant_unique').on(table.id, table.tenantId),
    uniqueIndex('tool_profiles_tenant_scope_name_unique').on(
      table.tenantId,
      table.scope,
      table.name,
    ),
    index('tool_profiles_tenant_scope_idx').on(table.tenantId, table.scope),
    index('tool_profiles_account_id_idx').on(table.accountId),
  ],
)

export const toolProfileScopeValuesExport = toolProfileScopeValues
export const toolProfileStatusValuesExport = toolProfileStatusValues
