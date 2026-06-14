import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { EncryptedSecret } from '../../shared/secret-box'
import { accounts, tenants } from './identity'
import { toolProfiles } from './tool-access'

const mcpServerKindValues = ['stdio', 'streamable_http'] as const
const mcpServerScopeValues = ['account_private', 'tenant_shared'] as const

export const mcpServers = sqliteTable(
  'mcp_servers',
  {
    configJson: text('config_json', { mode: 'json' }).notNull(),
    createdAt: text('created_at').notNull(),
    createdByAccountId: text('created_by_account_id')
      .notNull()
      .references(() => accounts.id),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    id: text('id').primaryKey(),
    kind: text('kind', { enum: mcpServerKindValues }).notNull(),
    label: text('label').notNull(),
    lastDiscoveredAt: text('last_discovered_at'),
    lastError: text('last_error'),
    logLevel: text('log_level'),
    scope: text('scope', { enum: mcpServerScopeValues }).notNull().default('account_private'),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('mcp_servers_id_tenant_unique').on(table.id, table.tenantId),
    uniqueIndex('mcp_servers_tenant_account_label_unique').on(
      table.tenantId,
      table.createdByAccountId,
      table.label,
    ),
    index('mcp_servers_tenant_id_idx').on(table.tenantId),
    index('mcp_servers_tenant_account_idx').on(table.tenantId, table.createdByAccountId),
    index('mcp_servers_tenant_enabled_idx').on(table.tenantId, table.enabled),
  ],
)

export const mcpToolCache = sqliteTable(
  'mcp_tool_cache',
  {
    appsMetaJson: text('apps_meta_json', { mode: 'json' }),
    createdAt: text('created_at').notNull(),
    description: text('description'),
    executionJson: text('execution_json', { mode: 'json' }),
    fingerprint: text('fingerprint').notNull(),
    id: text('id').primaryKey(),
    inputSchemaJson: text('input_schema_json', { mode: 'json' }).notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    modelVisible: integer('model_visible', { mode: 'boolean' }).notNull().default(true),
    outputSchemaJson: text('output_schema_json', { mode: 'json' }),
    remoteName: text('remote_name').notNull(),
    runtimeName: text('runtime_name').notNull(),
    serverId: text('server_id')
      .notNull()
      .references(() => mcpServers.id),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    title: text('title'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('mcp_tool_cache_id_tenant_unique').on(table.id, table.tenantId),
    uniqueIndex('mcp_tool_cache_server_remote_unique').on(table.serverId, table.remoteName),
    uniqueIndex('mcp_tool_cache_tenant_runtime_unique').on(table.tenantId, table.runtimeName),
    foreignKey({
      columns: [table.serverId, table.tenantId],
      foreignColumns: [mcpServers.id, mcpServers.tenantId],
      name: 'mcp_tool_cache_server_tenant_fk',
    }),
    index('mcp_tool_cache_tenant_id_idx').on(table.tenantId),
    index('mcp_tool_cache_server_id_idx').on(table.serverId),
    index('mcp_tool_cache_server_active_idx').on(table.serverId, table.isActive),
    index('mcp_tool_cache_runtime_name_idx').on(table.runtimeName),
    index('mcp_tool_cache_fingerprint_idx').on(table.fingerprint),
  ],
)

export const mcpToolAssignments = sqliteTable(
  'mcp_tool_assignments',
  {
    approvedAt: text('approved_at'),
    approvedFingerprint: text('approved_fingerprint'),
    createdAt: text('created_at').notNull(),
    id: text('id').primaryKey(),
    requiresConfirmation: integer('requires_confirmation', { mode: 'boolean' })
      .notNull()
      .default(true),
    runtimeName: text('runtime_name').notNull(),
    serverId: text('server_id').notNull(),
    toolProfileId: text('tool_profile_id').notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('mcp_tool_assignments_id_tenant_unique').on(table.id, table.tenantId),
    uniqueIndex('mcp_tool_assignments_scope_runtime_unique').on(
      table.tenantId,
      table.toolProfileId,
      table.runtimeName,
    ),
    foreignKey({
      columns: [table.toolProfileId, table.tenantId],
      foreignColumns: [toolProfiles.id, toolProfiles.tenantId],
      name: 'mcp_tool_assignments_tool_profile_tenant_fk',
    }),
    index('mcp_tool_assignments_tenant_id_idx').on(table.tenantId),
    index('mcp_tool_assignments_tool_profile_idx').on(table.tenantId, table.toolProfileId),
    index('mcp_tool_assignments_runtime_name_idx').on(table.runtimeName),
  ],
)

export const mcpOauthCredentials = sqliteTable(
  'mcp_oauth_credentials',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    clientInformationJson: text('client_information_json', { mode: 'json' }),
    createdAt: text('created_at').notNull(),
    discoveryStateJson: text('discovery_state_json', { mode: 'json' }),
    id: text('id').primaryKey(),
    serverId: text('server_id').notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    tokensJson: text('tokens_json', { mode: 'json' }),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('mcp_oauth_credentials_tenant_account_server_unique').on(
      table.tenantId,
      table.accountId,
      table.serverId,
    ),
    index('mcp_oauth_credentials_tenant_account_idx').on(table.tenantId, table.accountId),
    index('mcp_oauth_credentials_server_idx').on(table.serverId),
  ],
)

export const mcpOauthAuthorizations = sqliteTable(
  'mcp_oauth_authorizations',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    codeVerifierSecretJson: text('code_verifier_secret_json', {
      mode: 'json',
    }).$type<EncryptedSecret | null>(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    id: text('id').primaryKey(),
    redirectUri: text('redirect_uri').notNull(),
    responseOrigin: text('response_origin'),
    serverId: text('server_id').notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('mcp_oauth_authorizations_tenant_account_server_idx').on(
      table.tenantId,
      table.accountId,
      table.serverId,
    ),
    index('mcp_oauth_authorizations_expires_idx').on(table.expiresAt),
  ],
)
