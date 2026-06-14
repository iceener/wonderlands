import { foreignKey, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { agents } from './agents'
import { accounts, tenants } from './identity'
import { toolProfiles } from './tool-access'

const defaultTargetKindValues = ['assistant', 'agent'] as const

export const accountPreferences = sqliteTable(
  'account_preferences',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    assistantToolProfileId: text('assistant_tool_profile_id').notNull(),
    defaultAgentId: text('default_agent_id').references(() => agents.id),
    defaultTargetKind: text('default_target_kind', { enum: defaultTargetKindValues }).notNull(),
    shortcutBindings: text('shortcut_bindings'),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('account_preferences_tenant_account_unique').on(table.tenantId, table.accountId),
    foreignKey({
      columns: [table.defaultAgentId, table.tenantId],
      foreignColumns: [agents.id, agents.tenantId],
      name: 'account_preferences_agent_tenant_fk',
    }),
    foreignKey({
      columns: [table.assistantToolProfileId, table.tenantId],
      foreignColumns: [toolProfiles.id, toolProfiles.tenantId],
      name: 'account_preferences_assistant_tool_profile_tenant_fk',
    }),
    index('account_preferences_default_agent_id_idx').on(table.defaultAgentId),
    index('account_preferences_assistant_tool_profile_id_idx').on(table.assistantToolProfileId),
  ],
)

export const defaultTargetKindValuesExport = defaultTargetKindValues
