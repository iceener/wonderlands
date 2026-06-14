import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { runs, workSessions } from './collaboration'
import { accounts, tenants } from './identity'

const fileAccessScopeValues = ['session_local', 'account_library'] as const
const fileSourceKindValues = ['upload', 'artifact', 'generated', 'derived'] as const
const fileStatusValues = ['ready', 'processing', 'failed', 'deleted'] as const
const fileLinkTypeValues = ['session', 'thread', 'message', 'run', 'tool_execution'] as const
const uploadStatusValues = ['pending', 'completed', 'failed', 'cancelled'] as const

export const uploads = sqliteTable(
  'uploads',
  {
    accessScope: text('access_scope', { enum: fileAccessScopeValues }).notNull(),
    accountId: text('account_id').references(() => accounts.id),
    checksumSha256: text('checksum_sha256'),
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
    declaredMimeType: text('declared_mime_type'),
    detectedMimeType: text('detected_mime_type'),
    errorText: text('error_text'),
    fileId: text('file_id'),
    id: text('id').primaryKey(),
    originalFilename: text('original_filename').notNull(),
    sessionId: text('session_id').references(() => workSessions.id),
    sizeBytes: integer('size_bytes'),
    stagedStorageKey: text('staged_storage_key'),
    status: text('status', { enum: uploadStatusValues }).notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    title: text('title'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('uploads_id_tenant_unique').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.sessionId, table.tenantId],
      foreignColumns: [workSessions.id, workSessions.tenantId],
      name: 'uploads_session_tenant_fk',
    }),
    index('uploads_tenant_id_idx').on(table.tenantId),
    index('uploads_account_id_idx').on(table.accountId),
    index('uploads_session_id_idx').on(table.sessionId),
    index('uploads_tenant_status_idx').on(table.tenantId, table.status),
  ],
)

export const files = sqliteTable(
  'files',
  {
    accessScope: text('access_scope', { enum: fileAccessScopeValues }).notNull(),
    checksumSha256: text('checksum_sha256'),
    createdAt: text('created_at').notNull(),
    createdByAccountId: text('created_by_account_id').references(() => accounts.id),
    createdByRunId: text('created_by_run_id').references(() => runs.id),
    id: text('id').primaryKey(),
    metadata: text('metadata', { mode: 'json' }),
    mimeType: text('mime_type'),
    originUploadId: text('origin_upload_id'),
    originalFilename: text('original_filename'),
    sizeBytes: integer('size_bytes'),
    sourceKind: text('source_kind', { enum: fileSourceKindValues }).notNull(),
    status: text('status', { enum: fileStatusValues }).notNull(),
    storageKey: text('storage_key').notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    title: text('title'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('files_id_tenant_unique').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.createdByRunId, table.tenantId],
      foreignColumns: [runs.id, runs.tenantId],
      name: 'files_created_by_run_tenant_fk',
    }),
    index('files_tenant_id_idx').on(table.tenantId),
    index('files_created_by_account_id_idx').on(table.createdByAccountId),
    index('files_created_by_run_id_idx').on(table.createdByRunId),
    index('files_tenant_access_scope_idx').on(table.tenantId, table.accessScope),
    index('files_tenant_account_scope_idx').on(
      table.tenantId,
      table.createdByAccountId,
      table.accessScope,
    ),
    index('files_tenant_source_kind_idx').on(table.tenantId, table.sourceKind),
    index('files_tenant_checksum_idx').on(table.tenantId, table.checksumSha256),
  ],
)

export const fileLinks = sqliteTable(
  'file_links',
  {
    createdAt: text('created_at').notNull(),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id),
    id: text('id').primaryKey(),
    linkType: text('link_type', { enum: fileLinkTypeValues }).notNull(),
    targetId: text('target_id').notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
  },
  (table) => [
    foreignKey({
      columns: [table.fileId, table.tenantId],
      foreignColumns: [files.id, files.tenantId],
      name: 'file_links_file_tenant_fk',
    }),
    uniqueIndex('file_links_file_link_target_unique').on(
      table.fileId,
      table.linkType,
      table.targetId,
    ),
    index('file_links_target_idx').on(table.linkType, table.targetId),
    index('file_links_tenant_id_idx').on(table.tenantId),
  ],
)
