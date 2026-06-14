import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { agents } from './agents'
import { accounts, tenants } from './identity'

const agentScheduledTaskStatusValues = ['active', 'paused', 'archived', 'deleted'] as const
const agentScheduledTaskOverlapPolicyValues = ['skip'] as const
const agentScheduledTaskRunTriggerValues = ['scheduled', 'manual'] as const
const agentScheduledTaskRunStatusValues = [
  'claimed',
  'bootstrapping',
  'queued',
  'failed',
  'skipped',
] as const

export const agentScheduledTasks = sqliteTable(
  'agent_scheduled_tasks',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    archivedAt: text('archived_at'),
    content: text('content').notNull(),
    createdAt: text('created_at').notNull(),
    createdByAccountId: text('created_by_account_id')
      .notNull()
      .references(() => accounts.id),
    cronExpression: text('cron_expression').notNull(),
    deletedAt: text('deleted_at'),
    description: text('description'),
    id: text('id').primaryKey(),
    lastAttemptId: text('last_attempt_id'),
    lastErrorJson: text('last_error_json', { mode: 'json' }),
    lastJobId: text('last_job_id'),
    lastMessageId: text('last_message_id'),
    lastRunAt: text('last_run_at'),
    lastRunId: text('last_run_id'),
    lastSessionId: text('last_session_id'),
    lastThreadId: text('last_thread_id'),
    name: text('name').notNull(),
    nextRunAt: text('next_run_at'),
    overlapPolicy: text('overlap_policy', {
      enum: agentScheduledTaskOverlapPolicyValues,
    }).notNull(),
    ownerAccountId: text('owner_account_id')
      .notNull()
      .references(() => accounts.id),
    pausedAt: text('paused_at'),
    status: text('status', { enum: agentScheduledTaskStatusValues }).notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    timezone: text('timezone').notNull(),
    updatedAt: text('updated_at').notNull(),
    updatedByAccountId: text('updated_by_account_id')
      .notNull()
      .references(() => accounts.id),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('agent_scheduled_tasks_tenant_owner_status_idx').on(
      table.tenantId,
      table.ownerAccountId,
      table.status,
    ),
    index('agent_scheduled_tasks_status_next_run_idx').on(table.status, table.nextRunAt),
    index('agent_scheduled_tasks_tenant_agent_idx').on(table.tenantId, table.agentId),
    index('agent_scheduled_tasks_tenant_owner_idx').on(table.tenantId, table.ownerAccountId),
    index('agent_scheduled_tasks_last_thread_idx').on(table.lastThreadId),
  ],
)

export const agentScheduledTaskRuns = sqliteTable(
  'agent_scheduled_task_runs',
  {
    bootstrapCompletedAt: text('bootstrap_completed_at'),
    bootstrapStartedAt: text('bootstrap_started_at'),
    claimedAt: text('claimed_at').notNull(),
    createdAt: text('created_at').notNull(),
    errorJson: text('error_json', { mode: 'json' }),
    id: text('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    jobId: text('job_id'),
    messageId: text('message_id'),
    runId: text('run_id'),
    scheduledFor: text('scheduled_for').notNull(),
    sessionId: text('session_id'),
    status: text('status', { enum: agentScheduledTaskRunStatusValues }).notNull(),
    taskId: text('task_id')
      .notNull()
      .references(() => agentScheduledTasks.id),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    terminalAt: text('terminal_at'),
    threadId: text('thread_id'),
    trigger: text('trigger', { enum: agentScheduledTaskRunTriggerValues }).notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('agent_scheduled_task_runs_task_idempotency_unique').on(
      table.taskId,
      table.idempotencyKey,
    ),
    index('agent_scheduled_task_runs_tenant_task_created_idx').on(
      table.tenantId,
      table.taskId,
      table.createdAt,
    ),
    index('agent_scheduled_task_runs_status_claimed_idx').on(table.status, table.claimedAt),
    index('agent_scheduled_task_runs_thread_idx').on(table.threadId),
    index('agent_scheduled_task_runs_run_idx').on(table.runId),
  ],
)

export const agentScheduledTaskStatusValuesExport = agentScheduledTaskStatusValues
export const agentScheduledTaskOverlapPolicyValuesExport = agentScheduledTaskOverlapPolicyValues
export const agentScheduledTaskRunTriggerValuesExport = agentScheduledTaskRunTriggerValues
export const agentScheduledTaskRunStatusValuesExport = agentScheduledTaskRunStatusValues
