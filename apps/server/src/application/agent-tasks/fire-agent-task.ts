import type { AppRuntime } from '../../app/runtime'
import { withTransaction } from '../../db/transaction'
import type { AgentScheduledTaskRecord } from '../../domain/agent-tasks/agent-scheduled-task-repository'
import type {
  AgentScheduledTaskRunRecord,
  AgentScheduledTaskRunTrigger,
} from '../../domain/agent-tasks/agent-scheduled-task-run-repository'
import { type DomainError, DomainErrorException } from '../../shared/errors'
import { asAgentScheduledTaskRunId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { resolveRootRunAgentBinding } from '../agents/root-run-agent-binding'
import { runBootstrapSessionTransaction } from '../commands/bootstrap-session'
import { createInternalCommandContext } from '../commands/internal-command-context'
import {
  createAgentScheduledTaskRepository,
  createAgentScheduledTaskRunRepository,
  createRunRepository,
  createTenantMembershipRepository,
} from '../persistence/repositories'
import { computeNextRunAt } from './cron-schedule'
import { isRuntimeRunActive } from './scheduled-task-status'

const STALE_CLAIM_RECOVERY_MS = 5 * 60 * 1000

export type FireAgentScheduledTaskOutcome = 'already_claimed' | 'failed' | 'queued' | 'skipped'

export interface FireAgentScheduledTaskOutput {
  outcome: FireAgentScheduledTaskOutcome
  task: AgentScheduledTaskRecord
  taskRun: AgentScheduledTaskRunRecord | null
}

const isPermanentSchedulerError = (error: DomainError): boolean =>
  error.type === 'validation' ||
  error.type === 'permission' ||
  error.type === 'not_found' ||
  error.type === 'auth'

const toErrorJson = (error: DomainError): Record<string, unknown> => ({
  message: error.message,
  type: error.type,
})

export const fireAgentScheduledTask = (
  runtime: Pick<AppRuntime, 'config' | 'db' | 'services'>,
  input: {
    task: AgentScheduledTaskRecord
    trigger: AgentScheduledTaskRunTrigger
  },
): Result<FireAgentScheduledTaskOutput, DomainError> => {
  const { task, trigger } = input
  const taskRepository = createAgentScheduledTaskRepository(runtime.db)
  const taskRunRepository = createAgentScheduledTaskRunRepository(runtime.db)
  const clock = runtime.services.clock
  const now = clock.nowIso()
  const ownerScope: TenantScope = {
    accountId: task.ownerAccountId,
    role: 'member',
    tenantId: task.tenantId,
  }

  const computeAdvancedNextRunAt = (): string | null => {
    const next = computeNextRunAt({
      cronExpression: task.cronExpression,
      from: clock.nowIso(),
      timezone: task.timezone,
    })

    return next.ok ? next.value : null
  }

  const advanceSchedule = (currentTask: AgentScheduledTaskRecord): void => {
    if (trigger !== 'scheduled') {
      return
    }

    const nextRunAt = computeAdvancedNextRunAt()
    const advanced = taskRepository.update(ownerScope, {
      expectedVersion: currentTask.version,
      nextRunAt,
      taskId: task.id,
      updatedAt: clock.nowIso(),
      updatedByAccountId: task.ownerAccountId,
    })

    if (!advanced.ok) {
      runtime.services.logger.warn('Failed to advance scheduled task next run', {
        error: advanced.error.message,
        taskId: task.id,
      })
    }
  }

  const recordFailure = (
    taskRunId: AgentScheduledTaskRunRecord['id'] | null,
    error: DomainError,
  ): Result<FireAgentScheduledTaskOutput, DomainError> => {
    const failedAt = clock.nowIso()
    const errorJson = toErrorJson(error)
    let failedTaskRun: AgentScheduledTaskRunRecord | null = null

    if (taskRunId) {
      const marked = taskRunRepository.markFailed(ownerScope, {
        errorJson,
        failedAt,
        taskRunId,
      })

      if (marked.ok) {
        failedTaskRun = marked.value
        taskRepository.updateLatestPointers(ownerScope, {
          lastAttemptId: marked.value.id,
          lastErrorJson: errorJson,
          lastJobId: null,
          lastMessageId: null,
          lastRunAt: failedAt,
          lastRunId: null,
          lastSessionId: null,
          lastThreadId: null,
          taskId: task.id,
          updatedAt: failedAt,
        })
      }
    }

    const reloaded = taskRepository.getById(ownerScope, task.id)
    const currentTask = reloaded.ok ? reloaded.value : task

    if (isPermanentSchedulerError(error)) {
      const paused = taskRepository.update(ownerScope, {
        expectedVersion: currentTask.version,
        lastErrorJson: errorJson,
        pausedAt: failedAt,
        status: 'paused',
        taskId: task.id,
        updatedAt: failedAt,
        updatedByAccountId: task.ownerAccountId,
      })

      if (!paused.ok) {
        runtime.services.logger.warn(
          'Failed to auto-pause scheduled task after permanent failure',
          {
            error: paused.error.message,
            taskId: task.id,
          },
        )
      }
    } else {
      advanceSchedule(currentTask)
    }

    return ok({
      outcome: 'failed',
      task: currentTask,
      taskRun: failedTaskRun,
    })
  }

  const scheduledFor = trigger === 'scheduled' ? task.nextRunAt : now

  if (!scheduledFor) {
    return recordFailure(null, {
      message: `scheduled task ${task.id} has no next run instant`,
      type: 'validation',
    })
  }

  if (trigger === 'scheduled' && task.status !== 'active') {
    return err({
      message: `scheduled task ${task.id} is not active`,
      type: 'conflict',
    })
  }

  if (trigger === 'manual' && task.status !== 'active' && task.status !== 'paused') {
    return err({
      message: `scheduled task ${task.id} cannot be run while ${task.status}`,
      type: 'conflict',
    })
  }

  const taskRunId = asAgentScheduledTaskRunId(runtime.services.ids.create('tsr'))
  const idempotencyKey =
    trigger === 'scheduled' ? `scheduled:${scheduledFor}` : `manual:${taskRunId}`

  // Execution-identity checks happen before any task-run row is recorded so a
  // permanently broken task pauses instead of accumulating failed claims.
  const membership = createTenantMembershipRepository(runtime.db).findMembership(
    task.ownerAccountId,
    task.tenantId,
  )

  if (!membership.ok) {
    return recordFailure(null, membership.error)
  }

  if (!membership.value) {
    return recordFailure(null, {
      message: `task owner ${task.ownerAccountId} is no longer a member of tenant ${task.tenantId}`,
      type: 'permission',
    })
  }

  ownerScope.role = membership.value.role

  const context = createInternalCommandContext(runtime, ownerScope)
  const agentBinding = resolveRootRunAgentBinding(runtime.db, ownerScope, {
    agentId: task.agentId,
    useAccountDefaultAgent: false,
  })

  if (!agentBinding.ok) {
    return recordFailure(null, agentBinding.error)
  }

  if (agentBinding.value.targetKind !== 'agent') {
    return recordFailure(null, {
      message: `scheduled task ${task.id} could not resolve agent ${task.agentId}`,
      type: 'not_found',
    })
  }

  const claim = taskRunRepository.claim(ownerScope, {
    claimedAt: now,
    id: taskRunId,
    idempotencyKey,
    scheduledFor,
    taskId: task.id,
    trigger,
  })

  if (!claim.ok) {
    return recordFailure(null, claim.error)
  }

  if (!claim.value) {
    // Another worker or an earlier crashed attempt holds this occurrence.
    const existing = taskRunRepository.findByIdempotencyKey(ownerScope, {
      idempotencyKey,
      taskId: task.id,
    })

    if (!existing.ok || !existing.value) {
      return ok({ outcome: 'already_claimed', task, taskRun: null })
    }

    const existingRun = existing.value
    const claimAgeMs = Date.parse(now) - Date.parse(existingRun.claimedAt)
    const isAbandoned =
      (existingRun.status === 'claimed' || existingRun.status === 'bootstrapping') &&
      claimAgeMs >= STALE_CLAIM_RECOVERY_MS

    if (isAbandoned) {
      return recordFailure(existingRun.id, {
        message: `occurrence ${existingRun.id} was abandoned mid-bootstrap and recovered`,
        type: 'conflict',
      })
    }

    if (
      trigger === 'scheduled' &&
      (existingRun.status === 'queued' ||
        existingRun.status === 'failed' ||
        existingRun.status === 'skipped') &&
      task.nextRunAt === scheduledFor
    ) {
      // The occurrence completed its scheduler lifecycle but the task pointer
      // never advanced (crash between commit points); move the schedule on.
      advanceSchedule(task)
    }

    return ok({ outcome: 'already_claimed', task, taskRun: existingRun })
  }

  const claimedTaskRun = claim.value

  // Overlap policy: skip when the previous occurrence is still bootstrapping or
  // its linked root run is in a non-terminal runtime state.
  const latest = taskRunRepository.findLatestByTaskId(ownerScope, {
    excludeTaskRunId: claimedTaskRun.id,
    taskId: task.id,
  })

  if (latest.ok && latest.value) {
    const previous = latest.value
    let overlapActive = previous.status === 'claimed' || previous.status === 'bootstrapping'

    if (!overlapActive && previous.runId) {
      const previousRun = createRunRepository(runtime.db).getById(ownerScope, previous.runId)
      overlapActive = previousRun.ok && isRuntimeRunActive(previousRun.value)
    }

    if (overlapActive) {
      const skippedAt = clock.nowIso()
      const skipped = taskRunRepository.markSkipped(ownerScope, {
        errorJson: {
          message: `previous occurrence ${previous.id} is still active`,
          reason: 'overlap_policy_skip',
        },
        skippedAt,
        taskRunId: claimedTaskRun.id,
      })
      taskRepository.updateLatestPointers(ownerScope, {
        lastAttemptId: claimedTaskRun.id,
        lastRunAt: skippedAt,
        taskId: task.id,
        updatedAt: skippedAt,
      })

      const reloaded = taskRepository.getById(ownerScope, task.id)
      advanceSchedule(reloaded.ok ? reloaded.value : task)

      const finalTask = taskRepository.getById(ownerScope, task.id)

      return ok({
        outcome: 'skipped',
        task: finalTask.ok ? finalTask.value : task,
        taskRun: skipped.ok ? skipped.value : claimedTaskRun,
      })
    }
  }

  try {
    const queuedTaskRun = withTransaction(runtime.db, (tx) => {
      const txTaskRunRepository = createAgentScheduledTaskRunRepository(tx)
      const txTaskRepository = createAgentScheduledTaskRepository(tx)
      const bootstrapStartedAt = clock.nowIso()

      const bootstrapping = txTaskRunRepository.markBootstrapping(ownerScope, {
        bootstrapStartedAt,
        taskRunId: claimedTaskRun.id,
      })

      if (!bootstrapping.ok) {
        throw new DomainErrorException(bootstrapping.error)
      }

      const bootstrap = runBootstrapSessionTransaction(tx, context, {
        agentBinding: agentBinding.value,
        initialMessage: task.content,
        sourceMetadata: {
          scheduledFor,
          source: 'agent_scheduled_task',
          taskId: task.id,
          taskRunId: claimedTaskRun.id,
          trigger,
        },
        task: task.name,
        threadTitle: task.name,
        title: task.name,
      })

      const bootstrapCompletedAt = clock.nowIso()
      const queued = txTaskRunRepository.markQueued(ownerScope, {
        bootstrapCompletedAt,
        jobId: bootstrap.jobId,
        messageId: bootstrap.messageId,
        runId: bootstrap.runId,
        sessionId: bootstrap.sessionId,
        taskRunId: claimedTaskRun.id,
        threadId: bootstrap.threadId,
      })

      if (!queued.ok) {
        throw new DomainErrorException(queued.error)
      }

      const pointers = txTaskRepository.updateLatestPointers(ownerScope, {
        lastAttemptId: claimedTaskRun.id,
        lastErrorJson: null,
        lastJobId: bootstrap.jobId,
        lastMessageId: bootstrap.messageId,
        lastRunAt: bootstrapCompletedAt,
        lastRunId: bootstrap.runId,
        lastSessionId: bootstrap.sessionId,
        lastThreadId: bootstrap.threadId,
        ...(trigger === 'scheduled' ? { nextRunAt: computeAdvancedNextRunAt() } : {}),
        taskId: task.id,
        updatedAt: bootstrapCompletedAt,
      })

      if (!pointers.ok) {
        throw new DomainErrorException(pointers.error)
      }

      return queued.value
    })

    runtime.services.multiagent.wake()

    const finalTask = taskRepository.getById(ownerScope, task.id)

    return ok({
      outcome: 'queued',
      task: finalTask.ok ? finalTask.value : task,
      taskRun: queuedTaskRun,
    })
  } catch (error) {
    const domainError: DomainError =
      error instanceof DomainErrorException
        ? error.domainError
        : {
            message:
              error instanceof Error ? error.message : 'Unknown scheduled task bootstrap failure',
            type: 'conflict',
          }

    return recordFailure(claimedTaskRun.id, domainError)
  }
}
