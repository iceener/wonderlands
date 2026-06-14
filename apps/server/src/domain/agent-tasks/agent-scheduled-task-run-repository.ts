import { and, desc, eq } from 'drizzle-orm'

import { agentScheduledTaskRuns } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  type AgentScheduledTaskId,
  type AgentScheduledTaskRunId,
  asAgentScheduledTaskId,
  asAgentScheduledTaskRunId,
  asJobId,
  asRunId,
  asSessionMessageId,
  asSessionThreadId,
  asTenantId,
  asWorkSessionId,
  type JobId,
  type RunId,
  type SessionMessageId,
  type SessionThreadId,
  type TenantId,
  type WorkSessionId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

export type AgentScheduledTaskRunTrigger = 'scheduled' | 'manual'
export type AgentScheduledTaskRunStatus =
  | 'claimed'
  | 'bootstrapping'
  | 'queued'
  | 'failed'
  | 'skipped'

export interface AgentScheduledTaskRunRecord {
  bootstrapCompletedAt: string | null
  bootstrapStartedAt: string | null
  claimedAt: string
  createdAt: string
  errorJson: unknown | null
  id: AgentScheduledTaskRunId
  idempotencyKey: string
  jobId: JobId | null
  messageId: SessionMessageId | null
  runId: RunId | null
  scheduledFor: string
  sessionId: WorkSessionId | null
  status: AgentScheduledTaskRunStatus
  taskId: AgentScheduledTaskId
  tenantId: TenantId
  terminalAt: string | null
  threadId: SessionThreadId | null
  trigger: AgentScheduledTaskRunTrigger
  updatedAt: string
}

export interface ClaimAgentScheduledTaskRunInput {
  claimedAt: string
  id: AgentScheduledTaskRunId
  idempotencyKey: string
  scheduledFor: string
  taskId: AgentScheduledTaskId
  trigger: AgentScheduledTaskRunTrigger
}

const toAgentScheduledTaskRunRecord = (
  row: typeof agentScheduledTaskRuns.$inferSelect,
): AgentScheduledTaskRunRecord => ({
  bootstrapCompletedAt: row.bootstrapCompletedAt,
  bootstrapStartedAt: row.bootstrapStartedAt,
  claimedAt: row.claimedAt,
  createdAt: row.createdAt,
  errorJson: row.errorJson,
  id: asAgentScheduledTaskRunId(row.id),
  idempotencyKey: row.idempotencyKey,
  jobId: row.jobId ? asJobId(row.jobId) : null,
  messageId: row.messageId ? asSessionMessageId(row.messageId) : null,
  runId: row.runId ? asRunId(row.runId) : null,
  scheduledFor: row.scheduledFor,
  sessionId: row.sessionId ? asWorkSessionId(row.sessionId) : null,
  status: row.status,
  taskId: asAgentScheduledTaskId(row.taskId),
  tenantId: asTenantId(row.tenantId),
  terminalAt: row.terminalAt,
  threadId: row.threadId ? asSessionThreadId(row.threadId) : null,
  trigger: row.trigger,
  updatedAt: row.updatedAt,
})

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('UNIQUE constraint failed')

export const createAgentScheduledTaskRunRepository = (db: RepositoryDatabase) => {
  const getById = (
    scope: TenantScope,
    taskRunId: AgentScheduledTaskRunId,
  ): Result<AgentScheduledTaskRunRecord, DomainError> => {
    const row = db
      .select()
      .from(agentScheduledTaskRuns)
      .where(
        and(
          eq(agentScheduledTaskRuns.id, taskRunId),
          eq(agentScheduledTaskRuns.tenantId, scope.tenantId),
        ),
      )
      .get()

    if (!row) {
      return err({
        message: `agent scheduled task run ${taskRunId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toAgentScheduledTaskRunRecord(row))
  }

  const update = (
    scope: TenantScope,
    taskRunId: AgentScheduledTaskRunId,
    values: Partial<typeof agentScheduledTaskRuns.$inferInsert>,
  ): Result<AgentScheduledTaskRunRecord, DomainError> => {
    try {
      const result = db
        .update(agentScheduledTaskRuns)
        .set(values)
        .where(
          and(
            eq(agentScheduledTaskRuns.id, taskRunId),
            eq(agentScheduledTaskRuns.tenantId, scope.tenantId),
          ),
        )
        .run()

      if (result.changes === 0) {
        return err({
          message: `agent scheduled task run ${taskRunId} not found in tenant ${scope.tenantId}`,
          type: 'not_found',
        })
      }

      return getById(scope, taskRunId)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown agent scheduled task run update failure'

      return err({
        message: `failed to update agent scheduled task run ${taskRunId}: ${message}`,
        type: 'conflict',
      })
    }
  }

  return {
    claim: (
      scope: TenantScope,
      input: ClaimAgentScheduledTaskRunInput,
    ): Result<AgentScheduledTaskRunRecord | null, DomainError> => {
      try {
        db.insert(agentScheduledTaskRuns)
          .values({
            bootstrapCompletedAt: null,
            bootstrapStartedAt: null,
            claimedAt: input.claimedAt,
            createdAt: input.claimedAt,
            errorJson: null,
            id: input.id,
            idempotencyKey: input.idempotencyKey,
            jobId: null,
            messageId: null,
            runId: null,
            scheduledFor: input.scheduledFor,
            sessionId: null,
            status: 'claimed',
            taskId: input.taskId,
            tenantId: scope.tenantId,
            terminalAt: null,
            threadId: null,
            trigger: input.trigger,
            updatedAt: input.claimedAt,
          })
          .run()

        return getById(scope, input.id)
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return ok(null)
        }

        const message =
          error instanceof Error ? error.message : 'Unknown agent scheduled task run claim failure'

        return err({
          message: `failed to claim agent scheduled task run ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    findByIdempotencyKey: (
      scope: TenantScope,
      input: {
        idempotencyKey: string
        taskId: AgentScheduledTaskId
      },
    ): Result<AgentScheduledTaskRunRecord | null, DomainError> => {
      try {
        const row = db
          .select()
          .from(agentScheduledTaskRuns)
          .where(
            and(
              eq(agentScheduledTaskRuns.tenantId, scope.tenantId),
              eq(agentScheduledTaskRuns.taskId, input.taskId),
              eq(agentScheduledTaskRuns.idempotencyKey, input.idempotencyKey),
            ),
          )
          .get()

        return ok(row ? toAgentScheduledTaskRunRecord(row) : null)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown agent scheduled task run lookup failure'

        return err({
          message: `failed to look up occurrence for task ${input.taskId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    findLatestByTaskId: (
      scope: TenantScope,
      input: {
        excludeTaskRunId?: AgentScheduledTaskRunId
        taskId: AgentScheduledTaskId
      },
    ): Result<AgentScheduledTaskRunRecord | null, DomainError> => {
      try {
        const rows = db
          .select()
          .from(agentScheduledTaskRuns)
          .where(
            and(
              eq(agentScheduledTaskRuns.tenantId, scope.tenantId),
              eq(agentScheduledTaskRuns.taskId, input.taskId),
            ),
          )
          .orderBy(desc(agentScheduledTaskRuns.createdAt), desc(agentScheduledTaskRuns.id))
          .limit(2)
          .all()

        const latest = rows
          .map(toAgentScheduledTaskRunRecord)
          .find((row) => row.id !== input.excludeTaskRunId)

        return ok(latest ?? null)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown agent scheduled task run lookup failure'

        return err({
          message: `failed to load latest occurrence for task ${input.taskId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getById,
    listByTaskId: (
      scope: TenantScope,
      input: {
        limit?: number
        taskId: AgentScheduledTaskId
      },
    ): Result<AgentScheduledTaskRunRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(agentScheduledTaskRuns)
          .where(
            and(
              eq(agentScheduledTaskRuns.tenantId, scope.tenantId),
              eq(agentScheduledTaskRuns.taskId, input.taskId),
            ),
          )
          .orderBy(desc(agentScheduledTaskRuns.createdAt), desc(agentScheduledTaskRuns.id))
          .limit(input.limit ?? 50)
          .all()

        return ok(rows.map(toAgentScheduledTaskRunRecord))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown agent scheduled task run list failure'

        return err({
          message: `failed to list runs for agent scheduled task ${input.taskId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    markBootstrapping: (
      scope: TenantScope,
      input: {
        bootstrapStartedAt: string
        taskRunId: AgentScheduledTaskRunId
      },
    ): Result<AgentScheduledTaskRunRecord, DomainError> =>
      update(scope, input.taskRunId, {
        bootstrapStartedAt: input.bootstrapStartedAt,
        status: 'bootstrapping',
        updatedAt: input.bootstrapStartedAt,
      }),
    markFailed: (
      scope: TenantScope,
      input: {
        errorJson: unknown
        failedAt: string
        taskRunId: AgentScheduledTaskRunId
      },
    ): Result<AgentScheduledTaskRunRecord, DomainError> =>
      update(scope, input.taskRunId, {
        errorJson: input.errorJson,
        status: 'failed',
        terminalAt: input.failedAt,
        updatedAt: input.failedAt,
      }),
    markQueued: (
      scope: TenantScope,
      input: {
        bootstrapCompletedAt: string
        jobId: JobId
        messageId: SessionMessageId
        runId: RunId
        sessionId: WorkSessionId
        taskRunId: AgentScheduledTaskRunId
        threadId: SessionThreadId
      },
    ): Result<AgentScheduledTaskRunRecord, DomainError> =>
      update(scope, input.taskRunId, {
        bootstrapCompletedAt: input.bootstrapCompletedAt,
        jobId: input.jobId,
        messageId: input.messageId,
        runId: input.runId,
        sessionId: input.sessionId,
        status: 'queued',
        threadId: input.threadId,
        updatedAt: input.bootstrapCompletedAt,
      }),
    markSkipped: (
      scope: TenantScope,
      input: {
        errorJson?: unknown
        skippedAt: string
        taskRunId: AgentScheduledTaskRunId
      },
    ): Result<AgentScheduledTaskRunRecord, DomainError> =>
      update(scope, input.taskRunId, {
        ...(input.errorJson !== undefined ? { errorJson: input.errorJson } : {}),
        status: 'skipped',
        terminalAt: input.skippedAt,
        updatedAt: input.skippedAt,
      }),
    toRecord: toAgentScheduledTaskRunRecord,
  }
}
