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
import { contextSummaries, runs, sessionThreads, workSessions } from './collaboration'
import { tenants } from './identity'

const memoryScopeKindValues = [
  'run_local',
  'thread_shared',
  'session_shared',
  'agent_profile',
] as const
const memoryKindValues = ['observation', 'reflection'] as const
const memoryVisibilityValues = ['private', 'promoted'] as const
const memoryStatusValues = ['active', 'superseded'] as const

export const memoryRecords = sqliteTable(
  'memory_records',
  {
    content: text('content', { mode: 'json' }).notNull(),
    createdAt: text('created_at').notNull(),
    generation: integer('generation').notNull().default(1),
    id: text('id').primaryKey(),
    kind: text('kind', { enum: memoryKindValues }).notNull(),
    ownerRunId: text('owner_run_id').references(() => runs.id),
    parentRecordId: text('parent_record_id').references((): AnySQLiteColumn => memoryRecords.id),
    rootRunId: text('root_run_id').references(() => runs.id),
    scopeKind: text('scope_kind', { enum: memoryScopeKindValues }).notNull(),
    scopeRef: text('scope_ref').notNull(),
    sessionId: text('session_id').references(() => workSessions.id),
    status: text('status', { enum: memoryStatusValues }).notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    threadId: text('thread_id').references(() => sessionThreads.id),
    tokenCount: integer('token_count'),
    visibility: text('visibility', { enum: memoryVisibilityValues }).notNull(),
  },
  (table) => [
    uniqueIndex('memory_records_id_tenant_unique').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.ownerRunId, table.tenantId],
      foreignColumns: [runs.id, runs.tenantId],
      name: 'memory_records_owner_run_tenant_fk',
    }),
    foreignKey({
      columns: [table.rootRunId, table.tenantId],
      foreignColumns: [runs.id, runs.tenantId],
      name: 'memory_records_root_run_tenant_fk',
    }),
    foreignKey({
      columns: [table.sessionId, table.tenantId],
      foreignColumns: [workSessions.id, workSessions.tenantId],
      name: 'memory_records_session_tenant_fk',
    }),
    foreignKey({
      columns: [table.threadId, table.tenantId],
      foreignColumns: [sessionThreads.id, sessionThreads.tenantId],
      name: 'memory_records_thread_tenant_fk',
    }),
    index('memory_records_tenant_id_idx').on(table.tenantId),
    index('memory_records_scope_idx').on(table.scopeKind, table.scopeRef),
    index('memory_records_owner_run_idx').on(table.ownerRunId),
    index('memory_records_kind_status_idx').on(table.kind, table.status),
  ],
)

export const memoryRecordSources = sqliteTable(
  'memory_record_sources',
  {
    createdAt: text('created_at').notNull(),
    fromSequence: integer('from_sequence').notNull(),
    id: text('id').primaryKey(),
    recordId: text('record_id')
      .notNull()
      .references(() => memoryRecords.id),
    sourceRecordId: text('source_record_id').references(() => memoryRecords.id),
    sourceRunId: text('source_run_id')
      .notNull()
      .references(() => runs.id),
    sourceSummaryId: text('source_summary_id').references(() => contextSummaries.id),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    throughSequence: integer('through_sequence').notNull(),
  },
  (table) => [
    check(
      'memory_record_sources_sequence_rule',
      sql`${table.fromSequence} <= ${table.throughSequence}`,
    ),
    foreignKey({
      columns: [table.recordId, table.tenantId],
      foreignColumns: [memoryRecords.id, memoryRecords.tenantId],
      name: 'memory_record_sources_record_tenant_fk',
    }),
    foreignKey({
      columns: [table.sourceRecordId, table.tenantId],
      foreignColumns: [memoryRecords.id, memoryRecords.tenantId],
      name: 'memory_record_sources_source_record_tenant_fk',
    }),
    foreignKey({
      columns: [table.sourceRunId, table.tenantId],
      foreignColumns: [runs.id, runs.tenantId],
      name: 'memory_record_sources_run_tenant_fk',
    }),
    foreignKey({
      columns: [table.sourceSummaryId, table.tenantId],
      foreignColumns: [contextSummaries.id, contextSummaries.tenantId],
      name: 'memory_record_sources_summary_tenant_fk',
    }),
    index('memory_record_sources_tenant_id_idx').on(table.tenantId),
    index('memory_record_sources_summary_id_idx').on(table.sourceSummaryId),
    index('memory_record_sources_record_id_idx').on(table.recordId),
    index('memory_record_sources_source_record_id_idx').on(table.sourceRecordId),
  ],
)
