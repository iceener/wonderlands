import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import {
  sandboxExecutionFileRoleValues,
  sandboxExecutionStatusValues,
  sandboxNetworkModeValues,
  sandboxPackageStatusValues,
  sandboxProviderValues,
  sandboxRuntimeValues,
  sandboxVaultAccessModeValues,
  sandboxWritebackOperationValues,
  sandboxWritebackStatusValues,
} from '../../domain/sandbox/types'
import { workspaces } from './agents'
import { jobs, runs, sessionThreads, toolExecutions, workSessions } from './collaboration'
import { files } from './files'
import { accounts, tenants } from './identity'

export const sandboxExecutions = sqliteTable(
  'sandbox_executions',
  {
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
    durationMs: integer('duration_ms'),
    errorText: text('error_text'),
    externalSandboxId: text('external_sandbox_id'),
    id: text('id').primaryKey(),
    jobId: text('job_id').references(() => jobs.id),
    networkMode: text('network_mode', { enum: sandboxNetworkModeValues }).notNull(),
    policySnapshotJson: text('policy_snapshot_json', { mode: 'json' }).notNull(),
    provider: text('provider', { enum: sandboxProviderValues }).notNull(),
    queuedAt: text('queued_at'),
    requestJson: text('request_json', { mode: 'json' }).notNull(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id),
    runtime: text('runtime', { enum: sandboxRuntimeValues }).notNull(),
    sessionId: text('session_id')
      .notNull()
      .references(() => workSessions.id),
    startedAt: text('started_at'),
    status: text('status', { enum: sandboxExecutionStatusValues }).notNull(),
    stderrText: text('stderr_text'),
    stdoutText: text('stdout_text'),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    threadId: text('thread_id').references(() => sessionThreads.id),
    toolExecutionId: text('tool_execution_id').references(() => toolExecutions.id),
    vaultAccessMode: text('vault_access_mode', { enum: sandboxVaultAccessModeValues }).notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id),
    workspaceRef: text('workspace_ref'),
  },
  (table) => [
    uniqueIndex('sandbox_executions_id_tenant_unique').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.sessionId, table.tenantId],
      foreignColumns: [workSessions.id, workSessions.tenantId],
      name: 'sandbox_executions_session_tenant_fk',
    }),
    foreignKey({
      columns: [table.threadId, table.sessionId, table.tenantId],
      foreignColumns: [sessionThreads.id, sessionThreads.sessionId, sessionThreads.tenantId],
      name: 'sandbox_executions_thread_scope_fk',
    }),
    foreignKey({
      columns: [table.runId, table.tenantId],
      foreignColumns: [runs.id, runs.tenantId],
      name: 'sandbox_executions_run_tenant_fk',
    }),
    foreignKey({
      columns: [table.toolExecutionId, table.tenantId],
      foreignColumns: [toolExecutions.id, toolExecutions.tenantId],
      name: 'sandbox_executions_tool_execution_tenant_fk',
    }),
    foreignKey({
      columns: [table.jobId, table.tenantId],
      foreignColumns: [jobs.id, jobs.tenantId],
      name: 'sandbox_executions_job_tenant_fk',
    }),
    foreignKey({
      columns: [table.workspaceId, table.tenantId],
      foreignColumns: [workspaces.id, workspaces.tenantId],
      name: 'sandbox_executions_workspace_tenant_fk',
    }),
    index('sandbox_executions_tenant_status_idx').on(table.tenantId, table.status),
    index('sandbox_executions_run_id_idx').on(table.runId),
    index('sandbox_executions_job_id_idx').on(table.jobId),
    index('sandbox_executions_tool_execution_id_idx').on(table.toolExecutionId),
  ],
)

export const sandboxExecutionFiles = sqliteTable(
  'sandbox_execution_files',
  {
    checksumSha256: text('checksum_sha256'),
    createdAt: text('created_at').notNull(),
    createdFileId: text('created_file_id').references(() => files.id),
    id: text('id').primaryKey(),
    mimeType: text('mime_type'),
    role: text('role', { enum: sandboxExecutionFileRoleValues }).notNull(),
    sandboxExecutionId: text('sandbox_execution_id')
      .notNull()
      .references(() => sandboxExecutions.id),
    sandboxPath: text('sandbox_path').notNull(),
    sizeBytes: integer('size_bytes'),
    sourceFileId: text('source_file_id').references(() => files.id),
    sourceVaultPath: text('source_vault_path'),
    targetVaultPath: text('target_vault_path'),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
  },
  (table) => [
    uniqueIndex('sandbox_execution_files_id_tenant_unique').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.sandboxExecutionId, table.tenantId],
      foreignColumns: [sandboxExecutions.id, sandboxExecutions.tenantId],
      name: 'sandbox_execution_files_execution_tenant_fk',
    }),
    foreignKey({
      columns: [table.sourceFileId, table.tenantId],
      foreignColumns: [files.id, files.tenantId],
      name: 'sandbox_execution_files_source_file_tenant_fk',
    }),
    foreignKey({
      columns: [table.createdFileId, table.tenantId],
      foreignColumns: [files.id, files.tenantId],
      name: 'sandbox_execution_files_created_file_tenant_fk',
    }),
    index('sandbox_execution_files_execution_idx').on(table.sandboxExecutionId),
    index('sandbox_execution_files_role_idx').on(table.role),
  ],
)

export const sandboxExecutionPackages = sqliteTable(
  'sandbox_execution_packages',
  {
    createdAt: text('created_at').notNull(),
    errorText: text('error_text'),
    id: text('id').primaryKey(),
    installScriptsAllowed: integer('install_scripts_allowed', { mode: 'boolean' })
      .notNull()
      .default(false),
    name: text('name').notNull(),
    registryHost: text('registry_host'),
    requestedVersion: text('requested_version').notNull(),
    resolvedVersion: text('resolved_version'),
    sandboxExecutionId: text('sandbox_execution_id')
      .notNull()
      .references(() => sandboxExecutions.id),
    status: text('status', { enum: sandboxPackageStatusValues }).notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
  },
  (table) => [
    uniqueIndex('sandbox_execution_packages_id_tenant_unique').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.sandboxExecutionId, table.tenantId],
      foreignColumns: [sandboxExecutions.id, sandboxExecutions.tenantId],
      name: 'sandbox_execution_packages_execution_tenant_fk',
    }),
    index('sandbox_execution_packages_execution_idx').on(table.sandboxExecutionId),
    index('sandbox_execution_packages_status_idx').on(table.status),
  ],
)

export const sandboxWritebackOperations = sqliteTable(
  'sandbox_writeback_operations',
  {
    appliedAt: text('applied_at'),
    approvedAt: text('approved_at'),
    approvedByAccountId: text('approved_by_account_id').references(() => accounts.id),
    createdAt: text('created_at').notNull(),
    errorText: text('error_text'),
    id: text('id').primaryKey(),
    operation: text('operation', { enum: sandboxWritebackOperationValues }).notNull(),
    requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(true),
    sandboxExecutionId: text('sandbox_execution_id')
      .notNull()
      .references(() => sandboxExecutions.id),
    sourceSandboxPath: text('source_sandbox_path').notNull(),
    status: text('status', { enum: sandboxWritebackStatusValues }).notNull(),
    targetVaultPath: text('target_vault_path').notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
  },
  (table) => [
    uniqueIndex('sandbox_writeback_operations_id_tenant_unique').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.sandboxExecutionId, table.tenantId],
      foreignColumns: [sandboxExecutions.id, sandboxExecutions.tenantId],
      name: 'sandbox_writeback_operations_execution_tenant_fk',
    }),
    index('sandbox_writeback_operations_execution_idx').on(table.sandboxExecutionId),
    index('sandbox_writeback_operations_status_idx').on(table.status),
  ],
)
