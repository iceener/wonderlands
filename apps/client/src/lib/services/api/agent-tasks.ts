import type {
  BackendAgentScheduledTask,
  BackendAgentScheduledTaskRun,
  CreateAgentScheduledTaskInput,
  ListAgentScheduledTasksFilters,
  PreviewAgentScheduledTaskScheduleInput,
  PreviewAgentScheduledTaskScheduleOutput,
  RunAgentScheduledTaskNowOutput,
  UpdateAgentScheduledTaskInput,
} from '@wonderlands/contracts/chat'
import { apiRequest } from '../backend'

export const listAgentTasks = (
  filters: ListAgentScheduledTasksFilters = {},
): Promise<BackendAgentScheduledTask[]> => {
  const searchParams = new URLSearchParams()

  if (filters.agentId) {
    searchParams.set('agentId', filters.agentId)
  }

  if (filters.status) {
    searchParams.set('status', filters.status)
  }

  const query = searchParams.toString()

  return apiRequest<BackendAgentScheduledTask[]>(`/agent-tasks${query ? `?${query}` : ''}`)
}

export const getAgentTask = (taskId: string): Promise<BackendAgentScheduledTask> =>
  apiRequest<BackendAgentScheduledTask>(`/agent-tasks/${encodeURIComponent(taskId)}`)

export const createAgentTask = (
  input: CreateAgentScheduledTaskInput,
): Promise<BackendAgentScheduledTask> =>
  apiRequest<BackendAgentScheduledTask>('/agent-tasks', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const updateAgentTask = (
  taskId: string,
  input: UpdateAgentScheduledTaskInput,
): Promise<BackendAgentScheduledTask> =>
  apiRequest<BackendAgentScheduledTask>(`/agent-tasks/${encodeURIComponent(taskId)}`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PUT',
  })

export const deleteAgentTask = (taskId: string): Promise<BackendAgentScheduledTask> =>
  apiRequest<BackendAgentScheduledTask>(`/agent-tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  })

export const pauseAgentTask = (taskId: string): Promise<BackendAgentScheduledTask> =>
  apiRequest<BackendAgentScheduledTask>(`/agent-tasks/${encodeURIComponent(taskId)}/pause`, {
    method: 'POST',
  })

export const resumeAgentTask = (taskId: string): Promise<BackendAgentScheduledTask> =>
  apiRequest<BackendAgentScheduledTask>(`/agent-tasks/${encodeURIComponent(taskId)}/resume`, {
    method: 'POST',
  })

export const runAgentTaskNow = (taskId: string): Promise<RunAgentScheduledTaskNowOutput> =>
  apiRequest<RunAgentScheduledTaskNowOutput>(`/agent-tasks/${encodeURIComponent(taskId)}/run-now`, {
    method: 'POST',
  })

export const listAgentTaskRuns = (
  taskId: string,
  options: { limit?: number } = {},
): Promise<BackendAgentScheduledTaskRun[]> => {
  const searchParams = new URLSearchParams()

  if (options.limit !== undefined) {
    searchParams.set('limit', String(options.limit))
  }

  const query = searchParams.toString()

  return apiRequest<BackendAgentScheduledTaskRun[]>(
    `/agent-tasks/${encodeURIComponent(taskId)}/runs${query ? `?${query}` : ''}`,
  )
}

export const getAgentTaskRun = (
  taskId: string,
  taskRunId: string,
): Promise<BackendAgentScheduledTaskRun> =>
  apiRequest<BackendAgentScheduledTaskRun>(
    `/agent-tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(taskRunId)}`,
  )

export const previewAgentTaskSchedule = (
  input: PreviewAgentScheduledTaskScheduleInput,
): Promise<PreviewAgentScheduledTaskScheduleOutput> =>
  apiRequest<PreviewAgentScheduledTaskScheduleOutput>('/agent-tasks/preview-schedule', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })
