import type {
  BackendAgentScheduledTask,
  BackendAgentScheduledTaskRun,
  PreviewAgentScheduledTaskScheduleOutput,
  RunAgentScheduledTaskNowOutput,
} from '@wonderlands/contracts'
import { z } from 'zod'

import {
  type AgentScheduledTaskRecord,
  type AgentScheduledTaskStatus,
  createAgentScheduledTaskRepository,
} from '../../domain/agent-tasks/agent-scheduled-task-repository'
import {
  type AgentScheduledTaskRunRecord,
  createAgentScheduledTaskRunRepository,
} from '../../domain/agent-tasks/agent-scheduled-task-run-repository'
import { createAgentRepository } from '../../domain/agents/agent-repository'
import { createRunRepository, type RunRecord } from '../../domain/runtime/run-repository'
import type { DomainError } from '../../shared/errors'
import {
  type AgentScheduledTaskId,
  type AgentScheduledTaskRunId,
  asAgentId,
  asAgentScheduledTaskId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import { resolveRootRunAgentBinding } from '../agents/root-run-agent-binding'
import type { CommandContext, CommandResult } from '../commands/command-context'
import { computeNextRunAt, previewRunTimes, validateCronSchedule } from './cron-schedule'
import { fireAgentScheduledTask } from './fire-agent-task'
import { toDisplayStatus } from './scheduled-task-status'

const createAgentTaskInputSchema = z.object({
  agentId: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(10_000),
  cronExpression: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).nullable().optional(),
  name: z.string().trim().min(1).max(200),
  overlapPolicy: z.literal('skip').optional(),
  status: z.enum(['active', 'paused']).optional(),
  timezone: z.string().trim().min(1).max(100),
})

const updateAgentTaskInputSchema = z.object({
  agentId: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(10_000).optional(),
  cronExpression: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  overlapPolicy: z.literal('skip').optional(),
  status: z.enum(['active', 'archived', 'paused']).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
})

const previewAgentTaskScheduleInputSchema = z.object({
  count: z.number().int().min(1).max(10).optional(),
  cronExpression: z.string().trim().min(1).max(200),
  from: z.string().trim().min(1).max(100).optional(),
  timezone: z.string().trim().min(1).max(100),
})

export type CreateAgentTaskInput = z.infer<typeof createAgentTaskInputSchema>
export type UpdateAgentTaskInput = z.infer<typeof updateAgentTaskInputSchema>
export type PreviewAgentTaskScheduleInput = z.infer<typeof previewAgentTaskScheduleInputSchema>

const parseWith =
  <TSchema extends z.ZodTypeAny>(schema: TSchema) =>
  (input: unknown): CommandResult<z.infer<TSchema>> => {
    const parsed = schema.safeParse(input)

    if (!parsed.success) {
      return err({
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
        type: 'validation',
      })
    }

    return ok(parsed.data)
  }

export const parseCreateAgentTaskInput = parseWith(createAgentTaskInputSchema)
export const parseUpdateAgentTaskInput = parseWith(updateAgentTaskInputSchema)
export const parsePreviewAgentTaskScheduleInput = parseWith(previewAgentTaskScheduleInputSchema)

export const createAgentTaskService = () => {
  const loadRuntimeRun = (
    context: CommandContext,
    taskRun: AgentScheduledTaskRunRecord,
  ): RunRecord | null => {
    if (!taskRun.runId) {
      return null
    }

    const run = createRunRepository(context.db).getById(context.tenantScope, taskRun.runId)

    return run.ok ? run.value : null
  }

  const toBackendTaskRun = (
    taskRun: AgentScheduledTaskRunRecord,
    runtimeRun: RunRecord | null,
  ): BackendAgentScheduledTaskRun => ({
    completedAt: runtimeRun?.completedAt ?? taskRun.terminalAt,
    displayStatus: toDisplayStatus(taskRun, runtimeRun),
    error: runtimeRun?.errorJson ?? taskRun.errorJson,
    id: taskRun.id,
    jobId: taskRun.jobId,
    lastProgressAt: runtimeRun?.lastProgressAt ?? null,
    messageId: taskRun.messageId,
    runId: taskRun.runId,
    runtimeStatus: runtimeRun?.status ?? null,
    scheduledFor: taskRun.scheduledFor,
    schedulerStatus: taskRun.status,
    sessionId: taskRun.sessionId,
    taskId: taskRun.taskId,
    threadId: taskRun.threadId,
    trigger: taskRun.trigger,
  })

  const toBackendTask = (
    context: CommandContext,
    task: AgentScheduledTaskRecord,
  ): BackendAgentScheduledTask => {
    const agent = createAgentRepository(context.db).getById(context.tenantScope, task.agentId)
    let lastDisplayStatus: BackendAgentScheduledTaskRun['displayStatus'] | null = null
    let lastProgressAt: string | null = null

    if (task.lastAttemptId) {
      const lastAttempt = createAgentScheduledTaskRunRepository(context.db).getById(
        context.tenantScope,
        task.lastAttemptId,
      )

      if (lastAttempt.ok) {
        const runtimeRun = loadRuntimeRun(context, lastAttempt.value)
        lastDisplayStatus = toDisplayStatus(lastAttempt.value, runtimeRun)
        lastProgressAt = runtimeRun?.lastProgressAt ?? null
      }
    }

    return {
      agentId: task.agentId,
      agentName: agent.ok ? agent.value.name : null,
      content: task.content,
      createdAt: task.createdAt,
      cronExpression: task.cronExpression,
      description: task.description,
      id: task.id,
      lastAttemptId: task.lastAttemptId,
      lastDisplayStatus,
      lastError: task.lastErrorJson,
      lastJobId: task.lastJobId,
      lastMessageId: task.lastMessageId,
      lastProgressAt,
      lastRunAt: task.lastRunAt,
      lastRunId: task.lastRunId,
      lastSessionId: task.lastSessionId,
      lastThreadId: task.lastThreadId,
      name: task.name,
      nextRunAt: task.nextRunAt,
      overlapPolicy: task.overlapPolicy,
      ownerAccountId: task.ownerAccountId,
      status: task.status,
      tenantId: task.tenantId,
      timezone: task.timezone,
      updatedAt: task.updatedAt,
    }
  }

  const validateAgentAccess = (
    context: CommandContext,
    agentId: string,
  ): Result<void, DomainError> => {
    const binding = resolveRootRunAgentBinding(context.db, context.tenantScope, {
      agentId,
      useAccountDefaultAgent: false,
    })

    if (!binding.ok) {
      return binding
    }

    if (binding.value.targetKind !== 'agent') {
      return err({
        message: `agent ${agentId} not found`,
        type: 'not_found',
      })
    }

    return ok(undefined)
  }

  const getOwnedTask = (
    context: CommandContext,
    taskId: AgentScheduledTaskId,
  ): Result<AgentScheduledTaskRecord, DomainError> =>
    createAgentScheduledTaskRepository(context.db).getOwnedById(context.tenantScope, taskId)

  return {
    createTask: (
      context: CommandContext,
      input: CreateAgentTaskInput,
    ): CommandResult<BackendAgentScheduledTask> => {
      const schedule = validateCronSchedule({
        cronExpression: input.cronExpression,
        timezone: input.timezone,
      })

      if (!schedule.ok) {
        return schedule
      }

      const agentAccess = validateAgentAccess(context, input.agentId)

      if (!agentAccess.ok) {
        return agentAccess
      }

      const now = context.services.clock.nowIso()
      const status = input.status ?? 'active'
      let nextRunAt: string | null = null

      if (status === 'active') {
        const next = computeNextRunAt({
          cronExpression: schedule.value.cronExpression,
          from: now,
          timezone: schedule.value.timezone,
        })

        if (!next.ok) {
          return next
        }

        nextRunAt = next.value
      }

      const created = createAgentScheduledTaskRepository(context.db).create(context.tenantScope, {
        agentId: asAgentId(input.agentId),
        content: input.content,
        createdAt: now,
        cronExpression: schedule.value.cronExpression,
        description: input.description ?? null,
        id: asAgentScheduledTaskId(context.services.ids.create('tsk')),
        name: input.name,
        nextRunAt,
        overlapPolicy: input.overlapPolicy ?? 'skip',
        ownerAccountId: context.tenantScope.accountId,
        status,
        timezone: schedule.value.timezone,
      })

      if (!created.ok) {
        return created
      }

      return ok(toBackendTask(context, created.value))
    },
    deleteTask: (
      context: CommandContext,
      taskId: AgentScheduledTaskId,
    ): CommandResult<BackendAgentScheduledTask> => {
      const task = getOwnedTask(context, taskId)

      if (!task.ok) {
        return task
      }

      const now = context.services.clock.nowIso()
      const deleted = createAgentScheduledTaskRepository(context.db).update(context.tenantScope, {
        deletedAt: now,
        expectedVersion: task.value.version,
        nextRunAt: null,
        status: 'deleted',
        taskId,
        updatedAt: now,
        updatedByAccountId: context.tenantScope.accountId,
      })

      if (!deleted.ok) {
        return deleted
      }

      return ok(toBackendTask(context, deleted.value))
    },
    getTask: (
      context: CommandContext,
      taskId: AgentScheduledTaskId,
    ): CommandResult<BackendAgentScheduledTask> => {
      const task = getOwnedTask(context, taskId)

      if (!task.ok) {
        return task
      }

      return ok(toBackendTask(context, task.value))
    },
    getTaskRun: (
      context: CommandContext,
      taskId: AgentScheduledTaskId,
      taskRunId: AgentScheduledTaskRunId,
    ): CommandResult<BackendAgentScheduledTaskRun> => {
      const task = getOwnedTask(context, taskId)

      if (!task.ok) {
        return task
      }

      const taskRun = createAgentScheduledTaskRunRepository(context.db).getById(
        context.tenantScope,
        taskRunId,
      )

      if (!taskRun.ok) {
        return taskRun
      }

      if (taskRun.value.taskId !== taskId) {
        return err({
          message: `task run ${taskRunId} does not belong to task ${taskId}`,
          type: 'not_found',
        })
      }

      return ok(toBackendTaskRun(taskRun.value, loadRuntimeRun(context, taskRun.value)))
    },
    listTaskRuns: (
      context: CommandContext,
      taskId: AgentScheduledTaskId,
      options: { limit?: number } = {},
    ): CommandResult<BackendAgentScheduledTaskRun[]> => {
      const task = getOwnedTask(context, taskId)

      if (!task.ok) {
        return task
      }

      const taskRuns = createAgentScheduledTaskRunRepository(context.db).listByTaskId(
        context.tenantScope,
        {
          limit: options.limit,
          taskId,
        },
      )

      if (!taskRuns.ok) {
        return taskRuns
      }

      return ok(
        taskRuns.value.map((taskRun) =>
          toBackendTaskRun(taskRun, loadRuntimeRun(context, taskRun)),
        ),
      )
    },
    listTasks: (
      context: CommandContext,
      filters: {
        agentId?: string
        status?: AgentScheduledTaskStatus
      } = {},
    ): CommandResult<BackendAgentScheduledTask[]> => {
      const tasks = createAgentScheduledTaskRepository(context.db).listOwnerTasks(
        context.tenantScope,
        {
          agentId: filters.agentId ? asAgentId(filters.agentId) : undefined,
          status: filters.status,
        },
      )

      if (!tasks.ok) {
        return tasks
      }

      return ok(tasks.value.map((task) => toBackendTask(context, task)))
    },
    pauseTask: (
      context: CommandContext,
      taskId: AgentScheduledTaskId,
    ): CommandResult<BackendAgentScheduledTask> => {
      const task = getOwnedTask(context, taskId)

      if (!task.ok) {
        return task
      }

      if (task.value.status !== 'active') {
        return err({
          message: `scheduled task ${taskId} is not active`,
          type: 'conflict',
        })
      }

      const now = context.services.clock.nowIso()
      const paused = createAgentScheduledTaskRepository(context.db).update(context.tenantScope, {
        expectedVersion: task.value.version,
        nextRunAt: null,
        pausedAt: now,
        status: 'paused',
        taskId,
        updatedAt: now,
        updatedByAccountId: context.tenantScope.accountId,
      })

      if (!paused.ok) {
        return paused
      }

      return ok(toBackendTask(context, paused.value))
    },
    previewSchedule: (
      input: PreviewAgentTaskScheduleInput,
      nowIso: string,
    ): CommandResult<PreviewAgentScheduledTaskScheduleOutput> => {
      const preview = previewRunTimes({
        count: input.count,
        cronExpression: input.cronExpression,
        from: input.from ?? nowIso,
        timezone: input.timezone,
      })

      if (!preview.ok) {
        return preview
      }

      return ok({ nextRunTimes: preview.value })
    },
    resumeTask: (
      context: CommandContext,
      taskId: AgentScheduledTaskId,
    ): CommandResult<BackendAgentScheduledTask> => {
      const task = getOwnedTask(context, taskId)

      if (!task.ok) {
        return task
      }

      if (task.value.status !== 'paused' && task.value.status !== 'archived') {
        return err({
          message: `scheduled task ${taskId} is not paused`,
          type: 'conflict',
        })
      }

      const now = context.services.clock.nowIso()
      const next = computeNextRunAt({
        cronExpression: task.value.cronExpression,
        from: now,
        timezone: task.value.timezone,
      })

      if (!next.ok) {
        return next
      }

      const resumed = createAgentScheduledTaskRepository(context.db).update(context.tenantScope, {
        archivedAt: null,
        expectedVersion: task.value.version,
        lastErrorJson: null,
        nextRunAt: next.value,
        pausedAt: null,
        status: 'active',
        taskId,
        updatedAt: now,
        updatedByAccountId: context.tenantScope.accountId,
      })

      if (!resumed.ok) {
        return resumed
      }

      return ok(toBackendTask(context, resumed.value))
    },
    runTaskNow: (
      context: CommandContext,
      taskId: AgentScheduledTaskId,
    ): CommandResult<RunAgentScheduledTaskNowOutput> => {
      const task = getOwnedTask(context, taskId)

      if (!task.ok) {
        return task
      }

      const fired = fireAgentScheduledTask(
        {
          config: context.config,
          db: context.db,
          services: context.services,
        },
        {
          task: task.value,
          trigger: 'manual',
        },
      )

      if (!fired.ok) {
        return fired
      }

      if (!fired.value.taskRun) {
        return err({
          message: `failed to start scheduled task ${taskId}`,
          type: 'conflict',
        })
      }

      return ok({
        taskRun: toBackendTaskRun(
          fired.value.taskRun,
          loadRuntimeRun(context, fired.value.taskRun),
        ),
      })
    },
    updateTask: (
      context: CommandContext,
      taskId: AgentScheduledTaskId,
      input: UpdateAgentTaskInput,
    ): CommandResult<BackendAgentScheduledTask> => {
      const task = getOwnedTask(context, taskId)

      if (!task.ok) {
        return task
      }

      const cronExpression = input.cronExpression ?? task.value.cronExpression
      const timezone = input.timezone ?? task.value.timezone
      const scheduleChanged =
        cronExpression !== task.value.cronExpression || timezone !== task.value.timezone
      const schedule = validateCronSchedule({ cronExpression, timezone })

      if (!schedule.ok) {
        return schedule
      }

      if (input.agentId && input.agentId !== task.value.agentId) {
        const agentAccess = validateAgentAccess(context, input.agentId)

        if (!agentAccess.ok) {
          return agentAccess
        }
      }

      const now = context.services.clock.nowIso()
      const nextStatus = input.status ?? task.value.status
      let nextRunAt: string | null | undefined

      if (nextStatus === 'active' && (scheduleChanged || task.value.status !== 'active')) {
        const next = computeNextRunAt({
          cronExpression: schedule.value.cronExpression,
          from: now,
          timezone: schedule.value.timezone,
        })

        if (!next.ok) {
          return next
        }

        nextRunAt = next.value
      } else if (nextStatus !== 'active') {
        nextRunAt = null
      }

      const updated = createAgentScheduledTaskRepository(context.db).update(context.tenantScope, {
        agentId: input.agentId ? asAgentId(input.agentId) : undefined,
        archivedAt: nextStatus === 'archived' ? now : task.value.archivedAt ? null : undefined,
        content: input.content,
        cronExpression: input.cronExpression ? schedule.value.cronExpression : undefined,
        description: input.description,
        expectedVersion: task.value.version,
        name: input.name,
        nextRunAt,
        pausedAt:
          nextStatus === 'paused'
            ? (task.value.pausedAt ?? now)
            : task.value.pausedAt
              ? null
              : undefined,
        status: input.status,
        taskId,
        timezone: input.timezone ? schedule.value.timezone : undefined,
        updatedAt: now,
        updatedByAccountId: context.tenantScope.accountId,
      })

      if (!updated.ok) {
        return updated
      }

      return ok(toBackendTask(context, updated.value))
    },
  }
}
