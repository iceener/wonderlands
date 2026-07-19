import type { AppConfig } from '../../app/config'
import type { AppServices } from '../../app/runtime'
import type { AppDatabase } from '../../db/client'
import { createAgentScheduledTaskRepository } from '../persistence/repositories'
import { createPollingWorker } from '../polling-worker'
import { fireAgentScheduledTask } from './fire-agent-task'

export interface AgentTaskWorker {
  processDueTasks: () => Promise<number>
  start: () => void
  stop: () => Promise<void>
  wake: () => void
}

export const createAgentTaskWorker = (input: {
  config: AppConfig
  db: AppDatabase
  services: AppServices
}): AgentTaskWorker => {
  const logger = input.services.logger.child({
    subsystem: 'agent_task_worker',
  })
  const taskRepository = createAgentScheduledTaskRepository(input.db)

  const processDueTasks = async (): Promise<number> => {
    const dueTasks = taskRepository.listDueTasks({
      limit: input.config.agentTasks.worker.batchSize,
      now: input.services.clock.nowIso(),
    })

    if (!dueTasks.ok) {
      throw new Error(dueTasks.error.message)
    }

    let firedCount = 0

    for (const task of dueTasks.value) {
      const fired = fireAgentScheduledTask(
        {
          config: input.config,
          db: input.db,
          services: input.services,
        },
        {
          task,
          trigger: 'scheduled',
        },
      )

      if (!fired.ok) {
        logger.warn('Scheduled task fire failed', {
          error: fired.error.message,
          taskId: task.id,
          tenantId: task.tenantId,
        })
        continue
      }

      if (fired.value.outcome === 'queued') {
        firedCount += 1
      }

      logger.info('Scheduled task occurrence processed', {
        outcome: fired.value.outcome,
        taskId: task.id,
        taskRunId: fired.value.taskRun?.id ?? null,
        tenantId: task.tenantId,
      })
    }

    return firedCount
  }

  const lifecycle = createPollingWorker<number>({
    computeNextDelay: ({ result, wakeRequested }) =>
      wakeRequested || (result && result > 0) ? 0 : input.config.agentTasks.worker.pollIntervalMs,
    onError: (error) => {
      logger.error('Unhandled agent task worker failure', {
        message: error instanceof Error ? error.message : 'Unknown agent task worker failure',
      })
    },
    runOnce: processDueTasks,
    supportsWake: true,
  })

  return {
    processDueTasks,
    start: lifecycle.start,
    stop: lifecycle.stop,
    wake: lifecycle.wake,
  }
}
