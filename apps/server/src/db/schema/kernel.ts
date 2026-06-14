import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { kernelArtifactKindValues, kernelSessionStatusValues } from '../../domain/kernel/types'
import { runs, sessionThreads, toolExecutions, workSessions } from './collaboration'
import { files } from './files'
import { tenants } from './identity'

export const kernelSessions = sqliteTable(
  'kernel_sessions',
  {
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
    durationMs: integer('duration_ms'),
    endpoint: text('endpoint'),
    errorText: text('error_text'),
    id: text('id').primaryKey(),
    policySnapshotJson: text('policy_snapshot_json', { mode: 'json' }).notNull(),
    provider: text('provider', { enum: ['local', 'cloud'] }).notNull(),
    requestJson: text('request_json', { mode: 'json' }).notNull(),
    resultJson: text('result_json', { mode: 'json' }),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => workSessions.id),
    startedAt: text('started_at'),
    status: text('status', { enum: kernelSessionStatusValues }).notNull(),
    stderrText: text('stderr_text'),
    stdoutText: text('stdout_text'),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    threadId: text('thread_id').references(() => sessionThreads.id),
    toolExecutionId: text('tool_execution_id').references(() => toolExecutions.id),
  },
  (table) => [
    uniqueIndex('kernel_sessions_id_tenant_unique').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.sessionId, table.tenantId],
      foreignColumns: [workSessions.id, workSessions.tenantId],
      name: 'kernel_sessions_session_tenant_fk',
    }),
    foreignKey({
      columns: [table.threadId, table.sessionId, table.tenantId],
      foreignColumns: [sessionThreads.id, sessionThreads.sessionId, sessionThreads.tenantId],
      name: 'kernel_sessions_thread_scope_fk',
    }),
    foreignKey({
      columns: [table.runId, table.tenantId],
      foreignColumns: [runs.id, runs.tenantId],
      name: 'kernel_sessions_run_tenant_fk',
    }),
    foreignKey({
      columns: [table.toolExecutionId, table.tenantId],
      foreignColumns: [toolExecutions.id, toolExecutions.tenantId],
      name: 'kernel_sessions_tool_execution_tenant_fk',
    }),
    index('kernel_sessions_tenant_status_idx').on(table.tenantId, table.status),
    index('kernel_sessions_run_id_idx').on(table.runId),
    index('kernel_sessions_tool_execution_id_idx').on(table.toolExecutionId),
  ],
)

export const kernelSessionArtifacts = sqliteTable(
  'kernel_session_artifacts',
  {
    createdAt: text('created_at').notNull(),
    fileId: text('file_id').references(() => files.id),
    id: text('id').primaryKey(),
    kind: text('kind', { enum: kernelArtifactKindValues }).notNull(),
    kernelSessionId: text('kernel_session_id')
      .notNull()
      .references(() => kernelSessions.id),
    metadataJson: text('metadata_json', { mode: 'json' }),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
  },
  (table) => [
    uniqueIndex('kernel_session_artifacts_id_tenant_unique').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.kernelSessionId, table.tenantId],
      foreignColumns: [kernelSessions.id, kernelSessions.tenantId],
      name: 'kernel_session_artifacts_session_tenant_fk',
    }),
    foreignKey({
      columns: [table.fileId, table.tenantId],
      foreignColumns: [files.id, files.tenantId],
      name: 'kernel_session_artifacts_file_tenant_fk',
    }),
    index('kernel_session_artifacts_session_idx').on(table.kernelSessionId),
    index('kernel_session_artifacts_kind_idx').on(table.kind),
  ],
)
