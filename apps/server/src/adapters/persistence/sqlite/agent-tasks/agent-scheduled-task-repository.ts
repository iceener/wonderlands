import { and, desc, eq, inArray, isNotNull, lte } from 'drizzle-orm'

import { agentScheduledTasks } from '../../../../db/schema'
import type {
  AgentScheduledTaskRecord,
  AgentScheduledTaskRepository,
  AgentScheduledTaskStatus,
  CreateAgentScheduledTaskRecordInput,
  UpdateAgentScheduledTaskPointersInput,
  UpdateAgentScheduledTaskRecordInput,
} from '../../../../domain/agent-tasks/agent-scheduled-task-repository'
import type { DomainError } from '../../../../shared/errors'
import {
  type AgentId,
  type AgentScheduledTaskId,
  asAccountId,
  asAgentId,
  asAgentScheduledTaskId,
  asAgentScheduledTaskRunId,
  asJobId,
  asRunId,
  asSessionMessageId,
  asSessionThreadId,
  asTenantId,
  asWorkSessionId,
} from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import type { RepositoryDatabase } from '../repository-database'

const toAgentScheduledTaskRecord = (
  row: typeof agentScheduledTasks.$inferSelect,
): AgentScheduledTaskRecord => ({
  agentId: asAgentId(row.agentId),
  archivedAt: row.archivedAt,
  content: row.content,
  createdAt: row.createdAt,
  createdByAccountId: asAccountId(row.createdByAccountId),
  cronExpression: row.cronExpression,
  deletedAt: row.deletedAt,
  description: row.description,
  id: asAgentScheduledTaskId(row.id),
  lastAttemptId: row.lastAttemptId ? asAgentScheduledTaskRunId(row.lastAttemptId) : null,
  lastErrorJson: row.lastErrorJson,
  lastJobId: row.lastJobId ? asJobId(row.lastJobId) : null,
  lastMessageId: row.lastMessageId ? asSessionMessageId(row.lastMessageId) : null,
  lastRunAt: row.lastRunAt,
  lastRunId: row.lastRunId ? asRunId(row.lastRunId) : null,
  lastSessionId: row.lastSessionId ? asWorkSessionId(row.lastSessionId) : null,
  lastThreadId: row.lastThreadId ? asSessionThreadId(row.lastThreadId) : null,
  name: row.name,
  nextRunAt: row.nextRunAt,
  overlapPolicy: row.overlapPolicy,
  ownerAccountId: asAccountId(row.ownerAccountId),
  pausedAt: row.pausedAt,
  status: row.status,
  tenantId: asTenantId(row.tenantId),
  timezone: row.timezone,
  updatedAt: row.updatedAt,
  updatedByAccountId: asAccountId(row.updatedByAccountId),
  version: row.version,
})

export const createAgentScheduledTaskRepository = (
  db: RepositoryDatabase,
): AgentScheduledTaskRepository => {
  const getById = (
    scope: TenantScope,
    taskId: AgentScheduledTaskId,
  ): Result<AgentScheduledTaskRecord, DomainError> => {
    const row = db
      .select()
      .from(agentScheduledTasks)
      .where(
        and(eq(agentScheduledTasks.id, taskId), eq(agentScheduledTasks.tenantId, scope.tenantId)),
      )
      .get()

    if (!row) {
      return err({
        message: `agent scheduled task ${taskId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toAgentScheduledTaskRecord(row))
  }

  const getOwnedById = (
    scope: TenantScope,
    taskId: AgentScheduledTaskId,
  ): Result<AgentScheduledTaskRecord, DomainError> => {
    const task = getById(scope, taskId)

    if (!task.ok) {
      return task
    }

    if (task.value.ownerAccountId !== scope.accountId || task.value.status === 'deleted') {
      return err({
        message: `agent scheduled task ${taskId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(task.value)
  }

  return {
    create: (
      scope: TenantScope,
      input: CreateAgentScheduledTaskRecordInput,
    ): Result<AgentScheduledTaskRecord, DomainError> => {
      try {
        db.insert(agentScheduledTasks)
          .values({
            agentId: input.agentId,
            archivedAt: null,
            content: input.content,
            createdAt: input.createdAt,
            createdByAccountId: scope.accountId,
            cronExpression: input.cronExpression,
            deletedAt: null,
            description: input.description,
            id: input.id,
            name: input.name,
            nextRunAt: input.nextRunAt,
            overlapPolicy: input.overlapPolicy,
            ownerAccountId: input.ownerAccountId,
            pausedAt: input.status === 'paused' ? input.createdAt : null,
            status: input.status,
            tenantId: scope.tenantId,
            timezone: input.timezone,
            updatedAt: input.createdAt,
            updatedByAccountId: scope.accountId,
            version: 1,
          })
          .run()

        return getById(scope, input.id)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown agent scheduled task create failure'

        return err({
          message: `failed to create agent scheduled task ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getById,
    getOwnedById,
    listDueTasks: (input: {
      limit: number
      now: string
    }): Result<AgentScheduledTaskRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(agentScheduledTasks)
          .where(
            and(
              eq(agentScheduledTasks.status, 'active'),
              isNotNull(agentScheduledTasks.nextRunAt),
              lte(agentScheduledTasks.nextRunAt, input.now),
            ),
          )
          .limit(input.limit)
          .all()

        return ok(rows.map(toAgentScheduledTaskRecord))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown due task scan failure'

        return err({
          message: `failed to list due agent scheduled tasks: ${message}`,
          type: 'conflict',
        })
      }
    },
    listOwnerTasks: (
      scope: TenantScope,
      filters: {
        agentId?: AgentId
        status?: AgentScheduledTaskStatus
      } = {},
    ): Result<AgentScheduledTaskRecord[], DomainError> => {
      try {
        const conditions = [
          eq(agentScheduledTasks.tenantId, scope.tenantId),
          eq(agentScheduledTasks.ownerAccountId, scope.accountId),
          filters.status && filters.status !== 'deleted'
            ? eq(agentScheduledTasks.status, filters.status)
            : inArray(agentScheduledTasks.status, ['active', 'paused']),
        ]

        if (filters.agentId) {
          conditions.push(eq(agentScheduledTasks.agentId, filters.agentId))
        }

        const rows = db
          .select()
          .from(agentScheduledTasks)
          .where(and(...conditions))
          .orderBy(desc(agentScheduledTasks.createdAt), desc(agentScheduledTasks.id))
          .all()

        return ok(rows.map(toAgentScheduledTaskRecord))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown agent scheduled task list failure'

        return err({
          message: `failed to list agent scheduled tasks: ${message}`,
          type: 'conflict',
        })
      }
    },
    update: (
      scope: TenantScope,
      input: UpdateAgentScheduledTaskRecordInput,
    ): Result<AgentScheduledTaskRecord, DomainError> => {
      try {
        const patch: Partial<typeof agentScheduledTasks.$inferInsert> = {
          updatedAt: input.updatedAt,
          updatedByAccountId: input.updatedByAccountId,
          version: input.expectedVersion + 1,
        }

        if (input.agentId !== undefined) patch.agentId = input.agentId
        if (input.archivedAt !== undefined) patch.archivedAt = input.archivedAt
        if (input.content !== undefined) patch.content = input.content
        if (input.cronExpression !== undefined) patch.cronExpression = input.cronExpression
        if (input.deletedAt !== undefined) patch.deletedAt = input.deletedAt
        if (input.description !== undefined) patch.description = input.description
        if (input.lastErrorJson !== undefined) patch.lastErrorJson = input.lastErrorJson
        if (input.name !== undefined) patch.name = input.name
        if (input.nextRunAt !== undefined) patch.nextRunAt = input.nextRunAt
        if (input.pausedAt !== undefined) patch.pausedAt = input.pausedAt
        if (input.status !== undefined) patch.status = input.status
        if (input.timezone !== undefined) patch.timezone = input.timezone

        const result = db
          .update(agentScheduledTasks)
          .set(patch)
          .where(
            and(
              eq(agentScheduledTasks.id, input.taskId),
              eq(agentScheduledTasks.tenantId, scope.tenantId),
              eq(agentScheduledTasks.version, input.expectedVersion),
            ),
          )
          .run()

        if (result.changes === 0) {
          return err({
            message: `agent scheduled task ${input.taskId} was modified concurrently`,
            type: 'conflict',
          })
        }

        return getById(scope, input.taskId)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown agent scheduled task update failure'

        return err({
          message: `failed to update agent scheduled task ${input.taskId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    updateLatestPointers: (
      scope: TenantScope,
      input: UpdateAgentScheduledTaskPointersInput,
    ): Result<AgentScheduledTaskRecord, DomainError> => {
      try {
        const patch: Partial<typeof agentScheduledTasks.$inferInsert> = {
          lastAttemptId: input.lastAttemptId,
          lastRunAt: input.lastRunAt,
          updatedAt: input.updatedAt,
        }

        if (input.lastErrorJson !== undefined) patch.lastErrorJson = input.lastErrorJson
        if (input.lastJobId !== undefined) patch.lastJobId = input.lastJobId
        if (input.lastMessageId !== undefined) patch.lastMessageId = input.lastMessageId
        if (input.lastRunId !== undefined) patch.lastRunId = input.lastRunId
        if (input.lastSessionId !== undefined) patch.lastSessionId = input.lastSessionId
        if (input.lastThreadId !== undefined) patch.lastThreadId = input.lastThreadId
        if (input.nextRunAt !== undefined) patch.nextRunAt = input.nextRunAt

        const result = db
          .update(agentScheduledTasks)
          .set(patch)
          .where(
            and(
              eq(agentScheduledTasks.id, input.taskId),
              eq(agentScheduledTasks.tenantId, scope.tenantId),
            ),
          )
          .run()

        if (result.changes === 0) {
          return err({
            message: `agent scheduled task ${input.taskId} not found while updating pointers`,
            type: 'not_found',
          })
        }

        return getById(scope, input.taskId)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown agent scheduled task pointer failure'

        return err({
          message: `failed to update latest pointers for ${input.taskId}: ${message}`,
          type: 'conflict',
        })
      }
    },
  }
}
