import type { AgentScheduledTaskRunDisplayStatus } from '@wonderlands/contracts'

import type { AgentScheduledTaskRunRecord } from '../../domain/agent-tasks/agent-scheduled-task-run-repository'
import type { RunRecord } from '../../domain/runtime/run-repository'

export const RUNTIME_NON_TERMINAL_RUN_STATUSES: readonly RunRecord['status'][] = [
  'pending',
  'running',
  'cancelling',
  'waiting',
]

export const isRuntimeRunActive = (run: Pick<RunRecord, 'status'> | null): boolean =>
  run !== null && RUNTIME_NON_TERMINAL_RUN_STATUSES.includes(run.status)

export const toDisplayStatus = (
  taskRun: Pick<AgentScheduledTaskRunRecord, 'status'>,
  runtimeRun: Pick<RunRecord, 'status'> | null,
): AgentScheduledTaskRunDisplayStatus => {
  if (taskRun.status === 'skipped') {
    return 'skipped'
  }

  if (!runtimeRun) {
    return taskRun.status === 'failed' ? 'failed' : 'starting'
  }

  switch (runtimeRun.status) {
    case 'pending':
      return 'queued'
    case 'running':
      return 'running'
    case 'waiting':
      return 'waiting'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
    case 'cancelling':
      return 'cancelled'
  }
}
