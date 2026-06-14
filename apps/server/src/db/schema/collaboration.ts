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
  jobDependencyTypeValues,
  jobKindValues,
  jobStatusValues,
} from '../../domain/runtime/job-types'
import { agents } from './agents'
import { accounts, tenants } from './identity'
import { toolProfiles } from './tool-access'

const workSessionStatusValues = ['active', 'archived', 'deleted'] as const
const sessionThreadStatusValues = ['active', 'merged', 'archived', 'deleted'] as const
const sessionThreadTitleSourceValues = [
  'manual',
  'auto_first_message',
  'manual_regenerate',
] as const
const messageAuthorKindValues = ['user', 'assistant', 'system', 'tool'] as const
const runStatusValues = [
  'pending',
  'running',
  'cancelling',
  'waiting',
  'completed',
  'failed',
  'cancelled',
] as const
const runTargetKindValues = ['assistant', 'agent'] as const
const waitTypeValues = ['agent', 'tool', 'mcp', 'human', 'upload'] as const
const waitTargetKindValues = [
  'run',
  'tool_execution',
  'mcp_operation',
  'human_response',
  'upload',
  'external',
] as const
const waitStatusValues = ['pending', 'resolved', 'cancelled', 'timed_out'] as const
const itemTypeValues = ['message', 'function_call', 'function_call_output', 'reasoning'] as const
const itemRoleValues = ['user', 'assistant', 'system', 'developer'] as const
const toolDomainValues = ['native', 'mcp', 'provider', 'system'] as const
const usageOperationValues = [
  'interaction',
  'summary',
  'embedding',
  'transcription',
  'image_generation',
  'speech',
  'file_processing',
] as const

export const workSessions = sqliteTable(
  'work_sessions',
  {
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    createdByAccountId: text('created_by_account_id').references(() => accounts.id),
    deletedAt: text('deleted_at'),
    id: text('id').primaryKey(),
    metadata: text('metadata', { mode: 'json' }),
    rootRunId: text('root_run_id'),
    status: text('status', { enum: workSessionStatusValues }).notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    title: text('title'),
    updatedAt: text('updated_at').notNull(),
    workspaceId: text('workspace_id'),
    workspaceRef: text('workspace_ref'),
  },
  (table) => [
    uniqueIndex('work_sessions_id_tenant_unique').on(table.id, table.tenantId),
    index('work_sessions_tenant_id_idx').on(table.tenantId),
    index('work_sessions_tenant_status_idx').on(table.tenantId, table.status),
    index('work_sessions_root_run_id_idx').on(table.rootRunId),
    index('work_sessions_created_by_account_id_idx').on(table.createdByAccountId),
    index('work_sessions_workspace_id_idx').on(table.workspaceId),
  ],
)

export const sessionThreads = sqliteTable(
  'session_threads',
  {
    branchFromMessageId: text('branch_from_message_id'),
    branchFromSequence: integer('branch_from_sequence'),
    createdAt: text('created_at').notNull(),
    createdByAccountId: text('created_by_account_id').references(() => accounts.id),
    id: text('id').primaryKey(),
    parentThreadId: text('parent_thread_id'),
    sessionId: text('session_id')
      .notNull()
      .references(() => workSessions.id),
    status: text('status', { enum: sessionThreadStatusValues }).notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    title: text('title'),
    titleSource: text('title_source', { enum: sessionThreadTitleSourceValues }),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('session_threads_id_tenant_unique').on(table.id, table.tenantId),
    uniqueIndex('session_threads_id_session_tenant_unique').on(
      table.id,
      table.sessionId,
      table.tenantId,
    ),
    foreignKey({
      columns: [table.sessionId, table.tenantId],
      foreignColumns: [workSessions.id, workSessions.tenantId],
      name: 'session_threads_session_tenant_fk',
    }),
    foreignKey({
      columns: [table.parentThreadId, table.sessionId, table.tenantId],
      foreignColumns: [table.id, table.sessionId, table.tenantId],
      name: 'session_threads_parent_thread_scope_fk',
    }),
    index('session_threads_tenant_id_idx').on(table.tenantId),
    index('session_threads_session_id_idx').on(table.sessionId),
    index('session_threads_parent_thread_id_idx').on(table.parentThreadId),
    index('session_threads_branch_from_message_id_idx').on(table.branchFromMessageId),
    index('session_threads_session_status_idx').on(table.sessionId, table.status),
  ],
)

export const jobs = sqliteTable(
  'jobs',
  {
    assignedAgentId: text('assigned_agent_id'),
    assignedAgentRevisionId: text('assigned_agent_revision_id'),
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
    currentRunId: text('current_run_id'),
    id: text('id').primaryKey(),
    inputJson: text('input_json', { mode: 'json' }),
    kind: text('kind', { enum: jobKindValues }).notNull(),
    lastHeartbeatAt: text('last_heartbeat_at'),
    lastSchedulerSyncAt: text('last_scheduler_sync_at'),
    nextSchedulerCheckAt: text('next_scheduler_check_at'),
    parentJobId: text('parent_job_id'),
    priority: integer('priority').notNull().default(100),
    queuedAt: text('queued_at'),
    resultJson: text('result_json', { mode: 'json' }),
    rootJobId: text('root_job_id').notNull(),
    sessionId: text('session_id')
      .notNull()
      .references(() => workSessions.id),
    statusReasonJson: text('status_reason_json', { mode: 'json' }),
    status: text('status', { enum: jobStatusValues }).notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    threadId: text('thread_id').references(() => sessionThreads.id),
    title: text('title').notNull(),
    updatedAt: text('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('jobs_id_tenant_unique').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.sessionId, table.tenantId],
      foreignColumns: [workSessions.id, workSessions.tenantId],
      name: 'jobs_session_tenant_fk',
    }),
    foreignKey({
      columns: [table.threadId, table.sessionId, table.tenantId],
      foreignColumns: [sessionThreads.id, sessionThreads.sessionId, sessionThreads.tenantId],
      name: 'jobs_thread_scope_fk',
    }),
    foreignKey({
      columns: [table.parentJobId, table.tenantId],
      foreignColumns: [table.id, table.tenantId],
      name: 'jobs_parent_scope_fk',
    }),
    foreignKey({
      columns: [table.rootJobId, table.tenantId],
      foreignColumns: [table.id, table.tenantId],
      name: 'jobs_root_scope_fk',
    }),
    foreignKey({
      columns: [table.assignedAgentId, table.tenantId],
      foreignColumns: [agents.id, agents.tenantId],
      name: 'jobs_assigned_agent_tenant_fk',
    }),
    index('jobs_tenant_id_idx').on(table.tenantId),
    index('jobs_session_id_idx').on(table.sessionId),
    index('jobs_thread_id_idx').on(table.threadId),
    index('jobs_parent_job_id_idx').on(table.parentJobId),
    index('jobs_root_job_id_idx').on(table.rootJobId),
    index('jobs_current_run_id_idx').on(table.currentRunId),
    index('jobs_status_priority_idx').on(table.sessionId, table.status, table.priority),
    index('jobs_queued_at_idx').on(table.queuedAt),
  ],
)

export const jobDependencies = sqliteTable(
  'job_dependencies',
  {
    createdAt: text('created_at').notNull(),
    fromJobId: text('from_job_id').notNull(),
    id: text('id').primaryKey(),
    metadataJson: text('metadata_json', { mode: 'json' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => workSessions.id),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    toJobId: text('to_job_id').notNull(),
    type: text('type', { enum: jobDependencyTypeValues }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.sessionId, table.tenantId],
      foreignColumns: [workSessions.id, workSessions.tenantId],
      name: 'job_dependencies_session_tenant_fk',
    }),
    foreignKey({
      columns: [table.fromJobId, table.tenantId],
      foreignColumns: [jobs.id, jobs.tenantId],
      name: 'job_dependencies_from_scope_fk',
    }),
    foreignKey({
      columns: [table.toJobId, table.tenantId],
      foreignColumns: [jobs.id, jobs.tenantId],
      name: 'job_dependencies_to_scope_fk',
    }),
    uniqueIndex('job_dependencies_relation_unique').on(table.fromJobId, table.toJobId, table.type),
    index('job_dependencies_to_job_id_idx').on(table.toJobId),
    index('job_dependencies_session_type_idx').on(table.sessionId, table.type),
  ],
)

export const runs = sqliteTable(
  'runs',
  {
    actorAccountId: text('actor_account_id').references(() => accounts.id),
    completedAt: text('completed_at'),
    configSnapshot: text('config_snapshot', { mode: 'json' }).notNull(),
    createdAt: text('created_at').notNull(),
    errorJson: text('error_json', { mode: 'json' }),
    agentId: text('agent_id'),
    agentRevisionId: text('agent_revision_id'),
    id: text('id').primaryKey(),
    lastProgressAt: text('last_progress_at'),
    parentRunId: text('parent_run_id').references((): AnySQLiteColumn => runs.id),
    resultJson: text('result_json', { mode: 'json' }),
    rootRunId: text('root_run_id').notNull(),
    sessionId: text('session_id')
      .notNull()
      .references(() => workSessions.id),
    sourceCallId: text('source_call_id'),
    staleRecoveryCount: integer('stale_recovery_count').notNull().default(0),
    startedAt: text('started_at'),
    status: text('status', { enum: runStatusValues }).notNull(),
    task: text('task').notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    targetKind: text('target_kind', { enum: runTargetKindValues }).notNull(),
    threadId: text('thread_id').references(() => sessionThreads.id),
    toolProfileId: text('tool_profile_id'),
    turnCount: integer('turn_count').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
    version: integer('version').notNull().default(1),
    jobId: text('job_id'),
    workspaceId: text('workspace_id'),
    workspaceRef: text('workspace_ref'),
  },
  (table) => [
    check(
      'runs_root_run_rule',
      sql`((${table.parentRunId} is null and ${table.rootRunId} = ${table.id}) or (${table.parentRunId} is not null and ${table.rootRunId} <> ${table.id}))`,
    ),
    uniqueIndex('runs_id_tenant_unique').on(table.id, table.tenantId),
    uniqueIndex('runs_id_session_tenant_unique').on(table.id, table.sessionId, table.tenantId),
    uniqueIndex('runs_id_tenant_session_root_unique').on(
      table.id,
      table.tenantId,
      table.sessionId,
      table.rootRunId,
    ),
    foreignKey({
      columns: [table.sessionId, table.tenantId],
      foreignColumns: [workSessions.id, workSessions.tenantId],
      name: 'runs_session_tenant_fk',
    }),
    foreignKey({
      columns: [table.toolProfileId, table.tenantId],
      foreignColumns: [toolProfiles.id, toolProfiles.tenantId],
      name: 'runs_tool_profile_tenant_fk',
    }),
    foreignKey({
      columns: [table.threadId, table.sessionId, table.tenantId],
      foreignColumns: [sessionThreads.id, sessionThreads.sessionId, sessionThreads.tenantId],
      name: 'runs_thread_scope_fk',
    }),
    index('runs_tenant_id_idx').on(table.tenantId),
    index('runs_session_id_idx').on(table.sessionId),
    index('runs_thread_id_idx').on(table.threadId),
    index('runs_parent_run_id_idx').on(table.parentRunId),
    index('runs_root_run_id_idx').on(table.rootRunId),
    index('runs_agent_id_idx').on(table.agentId),
    index('runs_agent_revision_id_idx').on(table.agentRevisionId),
    index('runs_actor_account_id_idx').on(table.actorAccountId),
    index('runs_target_kind_idx').on(table.targetKind),
    index('runs_tool_profile_id_idx').on(table.toolProfileId),
    index('runs_workspace_id_idx').on(table.workspaceId),
    index('runs_job_id_idx').on(table.jobId),
    index('runs_session_status_idx').on(table.sessionId, table.status),
    index('runs_root_status_idx').on(table.rootRunId, table.status),
    index('runs_status_progress_idx').on(table.status, table.lastProgressAt),
  ],
)

export const accountThreadActivitySeen = sqliteTable(
  'account_thread_activity_seen',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    seenCompletedAt: text('seen_completed_at').notNull(),
    seenCompletedRunId: text('seen_completed_run_id').notNull(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    threadId: text('thread_id')
      .notNull()
      .references(() => sessionThreads.id),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('account_thread_activity_seen_tenant_account_thread_unique').on(
      table.tenantId,
      table.accountId,
      table.threadId,
    ),
    foreignKey({
      columns: [table.threadId, table.tenantId],
      foreignColumns: [sessionThreads.id, sessionThreads.tenantId],
      name: 'account_thread_activity_seen_thread_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.seenCompletedRunId, table.tenantId],
      foreignColumns: [runs.id, runs.tenantId],
      name: 'account_thread_activity_seen_run_tenant_fk',
    }).onDelete('cascade'),
    index('account_thread_activity_seen_tenant_account_idx').on(table.tenantId, table.accountId),
    index('account_thread_activity_seen_thread_idx').on(table.threadId),
    index('account_thread_activity_seen_run_idx').on(table.seenCompletedRunId),
  ],
)

export const sessionMessages = sqliteTable(
  'session_messages',
  {
    authorAccountId: text('author_account_id').references(() => accounts.id),
    authorKind: text('author_kind', { enum: messageAuthorKindValues }).notNull(),
    content: text('content', { mode: 'json' }).notNull(),
    createdAt: text('created_at').notNull(),
    id: text('id').primaryKey(),
    metadata: text('metadata', { mode: 'json' }),
    runId: text('run_id'),
    sequence: integer('sequence').notNull(),
    sessionId: text('session_id')
      .notNull()
      .references(() => workSessions.id),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    threadId: text('thread_id')
      .notNull()
      .references(() => sessionThreads.id),
  },
  (table) => [
    foreignKey({
      columns: [table.sessionId, table.tenantId],
      foreignColumns: [workSessions.id, workSessions.tenantId],
      name: 'session_messages_session_tenant_fk',
    }),
    foreignKey({
      columns: [table.threadId, table.sessionId, table.tenantId],
      foreignColumns: [sessionThreads.id, sessionThreads.sessionId, sessionThreads.tenantId],
      name: 'session_messages_thread_scope_fk',
    }),
    foreignKey({
      columns: [table.runId, table.sessionId, table.tenantId],
      foreignColumns: [runs.id, runs.sessionId, runs.tenantId],
      name: 'session_messages_run_scope_fk',
    }),
    index('session_messages_tenant_id_idx').on(table.tenantId),
    uniqueIndex('session_messages_thread_sequence_unique').on(table.threadId, table.sequence),
    index('session_messages_session_id_idx').on(table.sessionId),
    index('session_messages_run_id_idx').on(table.runId),
  ],
)

export const runDependencies = sqliteTable(
  'run_dependencies',
  {
    callId: text('call_id').notNull(),
    createdAt: text('created_at').notNull(),
    description: text('description'),
    id: text('id').primaryKey(),
    resolutionJson: text('resolution_json', { mode: 'json' }),
    resolvedAt: text('resolved_at'),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id),
    status: text('status', { enum: waitStatusValues }).notNull(),
    targetKind: text('target_kind', { enum: waitTargetKindValues }).notNull(),
    targetRef: text('target_ref'),
    targetRunId: text('target_run_id').references(() => runs.id),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    timeoutAt: text('timeout_at'),
    type: text('type', { enum: waitTypeValues }).notNull(),
  },
  (table) => [
    check(
      'run_dependencies_agent_target_rule',
      sql`((${table.type} = 'agent' and ${table.targetKind} = 'run' and ${table.targetRunId} is not null) or (${table.type} <> 'agent' and ${table.targetRunId} is null))`,
    ),
    foreignKey({
      columns: [table.runId, table.tenantId],
      foreignColumns: [runs.id, runs.tenantId],
      name: 'run_dependencies_run_tenant_fk',
    }),
    foreignKey({
      columns: [table.targetRunId, table.tenantId],
      foreignColumns: [runs.id, runs.tenantId],
      name: 'run_dependencies_target_run_tenant_fk',
    }),
    index('run_dependencies_run_status_idx').on(table.runId, table.status),
    index('run_dependencies_target_run_id_idx').on(table.targetRunId),
    index('run_dependencies_target_kind_ref_idx').on(table.targetKind, table.targetRef),
    index('run_dependencies_run_call_id_idx').on(table.runId, table.callId),
    index('run_dependencies_timeout_at_idx').on(table.timeoutAt),
  ],
)

export const items = sqliteTable(
  'items',
  {
    arguments: text('arguments'),
    callId: text('call_id'),
    content: text('content', { mode: 'json' }),
    createdAt: text('created_at').notNull(),
    id: text('id').primaryKey(),
    name: text('name'),
    output: text('output'),
    providerPayload: text('provider_payload', { mode: 'json' }),
    role: text('role', { enum: itemRoleValues }),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id),
    sequence: integer('sequence').notNull(),
    summary: text('summary', { mode: 'json' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    type: text('type', { enum: itemTypeValues }).notNull(),
  },
  (table) => [
    check(
      'items_type_payload_rule',
      sql`(
        (${table.type} = 'message' and ${table.role} is not null and ${table.content} is not null) or
        (${table.type} = 'function_call' and ${table.callId} is not null and ${table.name} is not null and ${table.arguments} is not null) or
        (${table.type} = 'function_call_output' and ${table.callId} is not null and ${table.output} is not null) or
        (${table.type} = 'reasoning' and ${table.summary} is not null and ${table.role} is null)
      )`,
    ),
    foreignKey({
      columns: [table.runId, table.tenantId],
      foreignColumns: [runs.id, runs.tenantId],
      name: 'items_run_tenant_fk',
    }),
    index('items_tenant_id_idx').on(table.tenantId),
    uniqueIndex('items_run_sequence_unique').on(table.runId, table.sequence),
    index('items_run_call_id_idx').on(table.runId, table.callId),
    index('items_call_id_idx').on(table.callId),
  ],
)

export const toolExecutions = sqliteTable(
  'tool_executions',
  {
    argsJson: text('args_json', { mode: 'json' }),
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
    domain: text('domain', { enum: toolDomainValues }).notNull(),
    durationMs: integer('duration_ms'),
    errorText: text('error_text'),
    id: text('id').primaryKey(),
    outcomeJson: text('outcome_json', { mode: 'json' }),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id),
    startedAt: text('started_at'),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    tool: text('tool').notNull(),
  },
  (table) => [
    uniqueIndex('tool_executions_id_tenant_unique').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.runId, table.tenantId],
      foreignColumns: [runs.id, runs.tenantId],
      name: 'tool_executions_run_tenant_fk',
    }),
    index('tool_executions_tenant_id_idx').on(table.tenantId),
    index('tool_executions_run_id_idx').on(table.runId),
    index('tool_executions_tool_idx').on(table.tool),
    index('tool_executions_run_tool_idx').on(table.runId, table.tool),
    index('tool_executions_domain_idx').on(table.domain),
  ],
)

export const usageLedger = sqliteTable(
  'usage_ledger',
  {
    cachedTokens: integer('cached_tokens').notNull().default(0),
    costMicros: integer('cost_micros'),
    createdAt: text('created_at').notNull(),
    estimatedInputTokens: integer('estimated_input_tokens'),
    estimatedOutputTokens: integer('estimated_output_tokens'),
    id: text('id').primaryKey(),
    inputTokens: integer('input_tokens').notNull().default(0),
    model: text('model').notNull(),
    operation: text('operation', { enum: usageOperationValues }).notNull(),
    outputTokens: integer('output_tokens').notNull().default(0),
    provider: text('provider').notNull(),
    runId: text('run_id').references(() => runs.id),
    sessionId: text('session_id').references(() => workSessions.id),
    stablePrefixTokens: integer('stable_prefix_tokens'),
    summaryId: text('summary_id').references(() => contextSummaries.id),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    threadId: text('thread_id').references(() => sessionThreads.id),
    toolExecutionId: text('tool_execution_id').references(() => toolExecutions.id),
    turn: integer('turn'),
    volatileSuffixTokens: integer('volatile_suffix_tokens'),
  },
  (table) => [
    foreignKey({
      columns: [table.runId, table.tenantId],
      foreignColumns: [runs.id, runs.tenantId],
      name: 'usage_ledger_run_tenant_fk',
    }),
    foreignKey({
      columns: [table.sessionId, table.tenantId],
      foreignColumns: [workSessions.id, workSessions.tenantId],
      name: 'usage_ledger_session_tenant_fk',
    }),
    foreignKey({
      columns: [table.threadId, table.tenantId],
      foreignColumns: [sessionThreads.id, sessionThreads.tenantId],
      name: 'usage_ledger_thread_tenant_fk',
    }),
    foreignKey({
      columns: [table.toolExecutionId, table.tenantId],
      foreignColumns: [toolExecutions.id, toolExecutions.tenantId],
      name: 'usage_ledger_tool_execution_tenant_fk',
    }),
    index('usage_ledger_tenant_id_idx').on(table.tenantId),
    index('usage_ledger_session_id_idx').on(table.sessionId),
    index('usage_ledger_run_id_idx').on(table.runId),
    index('usage_ledger_provider_model_idx').on(table.provider, table.model),
    index('usage_ledger_tenant_created_at_idx').on(table.tenantId, table.createdAt),
  ],
)

export const contextSummaries = sqliteTable(
  'context_summaries',
  {
    content: text('content').notNull(),
    createdAt: text('created_at').notNull(),
    fromSequence: integer('from_sequence').notNull(),
    id: text('id').primaryKey(),
    modelKey: text('model_key').notNull(),
    previousSummaryId: text('previous_summary_id').references(
      (): AnySQLiteColumn => contextSummaries.id,
    ),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    throughSequence: integer('through_sequence').notNull(),
    tokensAfter: integer('tokens_after'),
    tokensBefore: integer('tokens_before'),
    turnNumber: integer('turn_number'),
  },
  (table) => [
    check(
      'context_summaries_sequence_rule',
      sql`${table.fromSequence} <= ${table.throughSequence}`,
    ),
    uniqueIndex('context_summaries_id_tenant_unique').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.runId, table.tenantId],
      foreignColumns: [runs.id, runs.tenantId],
      name: 'context_summaries_run_tenant_fk',
    }),
    index('context_summaries_tenant_id_idx').on(table.tenantId),
    index('context_summaries_run_id_idx').on(table.runId),
    index('context_summaries_run_through_sequence_idx').on(table.runId, table.throughSequence),
  ],
)

export const runClaims = sqliteTable(
  'run_claims',
  {
    acquiredAt: text('acquired_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    renewedAt: text('renewed_at').notNull(),
    runId: text('run_id')
      .primaryKey()
      .references(() => runs.id),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workerId: text('worker_id').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.runId, table.tenantId],
      foreignColumns: [runs.id, runs.tenantId],
      name: 'run_claims_run_tenant_fk',
    }),
    index('run_claims_tenant_id_idx').on(table.tenantId),
    index('run_claims_expires_at_idx').on(table.expiresAt),
  ],
)
