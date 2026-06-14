import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import {
  agentKindValues,
  agentStatusValues,
  agentVisibilityValues,
  delegationModeValues,
  workspaceKindValues,
  workspaceStatusValues,
} from '../../domain/agents/agent-types'
import { accounts, tenants } from './identity'
import { toolProfiles } from './tool-access'

export const agents = sqliteTable(
  'agents',
  {
    activeRevisionId: text('active_revision_id'),
    archivedAt: text('archived_at'),
    baseAgentId: text('base_agent_id').references((): AnySQLiteColumn => agents.id),
    createdAt: text('created_at').notNull(),
    createdByAccountId: text('created_by_account_id').references(() => accounts.id),
    id: text('id').primaryKey(),
    kind: text('kind', { enum: agentKindValues }).notNull(),
    name: text('name').notNull(),
    ownerAccountId: text('owner_account_id').references(() => accounts.id),
    slug: text('slug').notNull(),
    status: text('status', { enum: agentStatusValues }).notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    updatedAt: text('updated_at').notNull(),
    visibility: text('visibility', { enum: agentVisibilityValues }).notNull(),
  },
  (table) => [
    check(
      'agents_system_owner_rule',
      sql`(${table.visibility} <> 'system' or ${table.ownerAccountId} is null)`,
    ),
    uniqueIndex('agents_id_tenant_unique').on(table.id, table.tenantId),
    uniqueIndex('agents_tenant_live_slug_unique')
      .on(table.tenantId, table.slug)
      .where(sql`${table.status} <> 'deleted'`),
    index('agents_tenant_visibility_status_idx').on(table.tenantId, table.visibility, table.status),
    index('agents_tenant_slug_idx').on(table.tenantId, table.slug),
    index('agents_owner_account_id_idx').on(table.ownerAccountId),
    index('agents_active_revision_id_idx').on(table.activeRevisionId),
  ],
)

export const agentRevisions = sqliteTable(
  'agent_revisions',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    checksumSha256: text('checksum_sha256').notNull(),
    createdAt: text('created_at').notNull(),
    createdByAccountId: text('created_by_account_id').references(() => accounts.id),
    frontmatterJson: text('frontmatter_json', { mode: 'json' }).notNull(),
    gardenFocusJson: text('garden_focus_json', { mode: 'json' }).notNull(),
    id: text('id').primaryKey(),
    instructionsMd: text('instructions_md').notNull(),
    kernelPolicyJson: text('kernel_policy_json', { mode: 'json' }).notNull(),
    memoryPolicyJson: text('memory_policy_json', { mode: 'json' }).notNull(),
    modelConfigJson: text('model_config_json', { mode: 'json' }).notNull(),
    resolvedConfigJson: text('resolved_config_json', { mode: 'json' }).notNull(),
    sandboxPolicyJson: text('sandbox_policy_json', { mode: 'json' }).notNull(),
    sourceMarkdown: text('source_markdown').notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    toolProfileId: text('tool_profile_id'),
    toolPolicyJson: text('tool_policy_json', { mode: 'json' }).notNull(),
    version: integer('version').notNull(),
    workspacePolicyJson: text('workspace_policy_json', { mode: 'json' }).notNull(),
  },
  (table) => [
    uniqueIndex('agent_revisions_id_tenant_unique').on(table.id, table.tenantId),
    uniqueIndex('agent_revisions_id_agent_tenant_unique').on(
      table.id,
      table.agentId,
      table.tenantId,
    ),
    uniqueIndex('agent_revisions_agent_version_unique').on(table.agentId, table.version),
    uniqueIndex('agent_revisions_agent_checksum_unique').on(table.agentId, table.checksumSha256),
    foreignKey({
      columns: [table.agentId, table.tenantId],
      foreignColumns: [agents.id, agents.tenantId],
      name: 'agent_revisions_agent_tenant_fk',
    }),
    foreignKey({
      columns: [table.toolProfileId, table.tenantId],
      foreignColumns: [toolProfiles.id, toolProfiles.tenantId],
      name: 'agent_revisions_tool_profile_tenant_fk',
    }),
    index('agent_revisions_tenant_id_idx').on(table.tenantId),
    index('agent_revisions_agent_id_idx').on(table.agentId),
    index('agent_revisions_created_by_account_id_idx').on(table.createdByAccountId),
    index('agent_revisions_tool_profile_id_idx').on(table.toolProfileId),
  ],
)

export const agentSubagentLinks = sqliteTable(
  'agent_subagent_links',
  {
    alias: text('alias').notNull(),
    childAgentId: text('child_agent_id')
      .notNull()
      .references(() => agents.id),
    createdAt: text('created_at').notNull(),
    delegationMode: text('delegation_mode', { enum: delegationModeValues }).notNull(),
    id: text('id').primaryKey(),
    parentAgentRevisionId: text('parent_agent_revision_id')
      .notNull()
      .references(() => agentRevisions.id),
    position: integer('position').notNull().default(0),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
  },
  (table) => [
    foreignKey({
      columns: [table.parentAgentRevisionId, table.tenantId],
      foreignColumns: [agentRevisions.id, agentRevisions.tenantId],
      name: 'agent_subagent_links_parent_revision_tenant_fk',
    }),
    foreignKey({
      columns: [table.childAgentId, table.tenantId],
      foreignColumns: [agents.id, agents.tenantId],
      name: 'agent_subagent_links_child_agent_tenant_fk',
    }),
    uniqueIndex('agent_subagent_links_parent_alias_unique').on(
      table.parentAgentRevisionId,
      table.alias,
    ),
    index('agent_subagent_links_parent_position_idx').on(
      table.parentAgentRevisionId,
      table.position,
    ),
    index('agent_subagent_links_child_agent_id_idx').on(table.childAgentId),
  ],
)

export const workspaces = sqliteTable(
  'workspaces',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    createdAt: text('created_at').notNull(),
    id: text('id').primaryKey(),
    kind: text('kind', { enum: workspaceKindValues }).notNull(),
    label: text('label'),
    rootRef: text('root_ref').notNull(),
    status: text('status', { enum: workspaceStatusValues }).notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('workspaces_id_tenant_unique').on(table.id, table.tenantId),
    uniqueIndex('workspaces_tenant_account_kind_unique').on(
      table.tenantId,
      table.accountId,
      table.kind,
    ),
    index('workspaces_tenant_status_idx').on(table.tenantId, table.status),
    index('workspaces_account_id_idx').on(table.accountId),
  ],
)
