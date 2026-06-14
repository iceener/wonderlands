import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { accounts, tenants } from './identity'

const gardenSiteStatusValues = ['draft', 'active', 'disabled', 'archived'] as const
const gardenBuildModeValues = ['manual', 'debounced_scan'] as const
const gardenDeployModeValues = ['api_hosted', 'github_pages'] as const
const gardenProtectedAccessModeValues = ['none', 'site_password'] as const
const gardenBuildTriggerKindValues = ['manual', 'auto_scan', 'republish'] as const
const gardenBuildStatusValues = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const
const gardenDeploymentTargetKindValues = ['api_hosted', 'github_pages'] as const
const gardenDeploymentStatusValues = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const

export const gardenSites = sqliteTable(
  'garden_sites',
  {
    buildMode: text('build_mode', { enum: gardenBuildModeValues }).notNull(),
    createdAt: text('created_at').notNull(),
    createdByAccountId: text('created_by_account_id')
      .notNull()
      .references(() => accounts.id),
    currentBuildId: text('current_build_id'),
    currentPublishedBuildId: text('current_published_build_id'),
    deployMode: text('deploy_mode', { enum: gardenDeployModeValues }).notNull(),
    id: text('id').primaryKey(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    name: text('name').notNull(),
    protectedAccessMode: text('protected_access_mode', {
      enum: gardenProtectedAccessModeValues,
    }).notNull(),
    protectedSecretRef: text('protected_secret_ref'),
    protectedSessionTtlSeconds: integer('protected_session_ttl_seconds').notNull(),
    slug: text('slug').notNull(),
    sourceScopePath: text('source_scope_path').notNull(),
    status: text('status', { enum: gardenSiteStatusValues }).notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    updatedAt: text('updated_at').notNull(),
    updatedByAccountId: text('updated_by_account_id')
      .notNull()
      .references(() => accounts.id),
  },
  (table) => [
    uniqueIndex('garden_sites_slug_unique').on(table.slug),
    uniqueIndex('garden_sites_tenant_slug_unique').on(table.tenantId, table.slug),
    index('garden_sites_tenant_status_idx').on(table.tenantId, table.status),
    index('garden_sites_current_build_id_idx').on(table.currentBuildId),
    index('garden_sites_current_published_build_id_idx').on(table.currentPublishedBuildId),
  ],
)

export const gardenBuilds = sqliteTable(
  'garden_builds',
  {
    completedAt: text('completed_at'),
    configFingerprintSha256: text('config_fingerprint_sha256'),
    createdAt: text('created_at').notNull(),
    errorMessage: text('error_message'),
    id: text('id').primaryKey(),
    manifestJson: text('manifest_json', { mode: 'json' }),
    protectedArtifactRoot: text('protected_artifact_root'),
    protectedPageCount: integer('protected_page_count').notNull().default(0),
    publicArtifactRoot: text('public_artifact_root'),
    publicPageCount: integer('public_page_count').notNull().default(0),
    requestedByAccountId: text('requested_by_account_id')
      .notNull()
      .references(() => accounts.id),
    siteId: text('site_id')
      .notNull()
      .references(() => gardenSites.id),
    sourceFingerprintSha256: text('source_fingerprint_sha256'),
    startedAt: text('started_at'),
    status: text('status', { enum: gardenBuildStatusValues }).notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    triggerKind: text('trigger_kind', { enum: gardenBuildTriggerKindValues }).notNull(),
    warningCount: integer('warning_count').notNull().default(0),
  },
  (table) => [
    index('garden_builds_site_id_idx').on(table.siteId),
    index('garden_builds_tenant_site_created_idx').on(
      table.tenantId,
      table.siteId,
      table.createdAt,
    ),
    index('garden_builds_status_idx').on(table.status),
  ],
)

export const gardenDeployments = sqliteTable(
  'garden_deployments',
  {
    buildId: text('build_id')
      .notNull()
      .references(() => gardenBuilds.id),
    completedAt: text('completed_at'),
    configJson: text('config_json', { mode: 'json' }),
    createdAt: text('created_at').notNull(),
    errorMessage: text('error_message'),
    externalUrl: text('external_url'),
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => gardenSites.id),
    startedAt: text('started_at'),
    status: text('status', { enum: gardenDeploymentStatusValues }).notNull(),
    targetKind: text('target_kind', { enum: gardenDeploymentTargetKindValues }).notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
  },
  (table) => [
    index('garden_deployments_build_id_idx').on(table.buildId),
    index('garden_deployments_site_id_idx').on(table.siteId),
    index('garden_deployments_status_idx').on(table.status),
  ],
)

export const gardenSiteStatusValuesExport = gardenSiteStatusValues
export const gardenBuildModeValuesExport = gardenBuildModeValues
export const gardenDeployModeValuesExport = gardenDeployModeValues
export const gardenProtectedAccessModeValuesExport = gardenProtectedAccessModeValues
export const gardenBuildTriggerKindValuesExport = gardenBuildTriggerKindValues
export const gardenBuildStatusValuesExport = gardenBuildStatusValues
export const gardenDeploymentTargetKindValuesExport = gardenDeploymentTargetKindValues
export const gardenDeploymentStatusValuesExport = gardenDeploymentStatusValues
