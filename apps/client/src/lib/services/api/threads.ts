import type {
  BackendSession,
  BackendThread,
  BackendThreadMessage,
  BootstrapSessionInput,
  BootstrapSessionOutput,
  BranchThreadInput,
  BranchThreadOutput,
  CreateSessionInput,
  CreateSessionThreadInput,
  EditThreadMessageInput,
  EditThreadMessageOutput,
  MessageId,
  SessionId,
  ThreadId,
} from '@wonderlands/contracts/chat'
import { apiFetch, apiRequest, toApiUrl } from '../backend'

export const bootstrapSession = (input: BootstrapSessionInput): Promise<BootstrapSessionOutput> =>
  apiRequest<BootstrapSessionOutput>('/sessions/bootstrap', {
    body: JSON.stringify({
      ...input,
      execute: true,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const createSession = (input: CreateSessionInput): Promise<BackendSession> =>
  apiRequest<BackendSession>('/sessions', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const createSessionThread = (
  sessionId: SessionId,
  input: CreateSessionThreadInput,
): Promise<BackendThread> =>
  apiRequest<BackendThread>(`/sessions/${sessionId}/threads`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const branchThread = (
  threadId: ThreadId,
  input: BranchThreadInput,
): Promise<BranchThreadOutput> =>
  apiRequest<BranchThreadOutput>(`/threads/${threadId}/branches`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const getThread = (threadId: ThreadId): Promise<BackendThread> =>
  apiRequest<BackendThread>(`/threads/${threadId}`)

export const listThreads = async (
  options: { limit?: number; query?: string } = {},
): Promise<BackendThread[]> => {
  const limit = options.limit ?? 50
  const searchParams = new URLSearchParams()
  searchParams.set('limit', String(limit))

  if (options.query?.trim()) {
    searchParams.set('query', options.query.trim())
  }

  const response = await apiRequest<{ threads: BackendThread[] }>(
    `/threads?${searchParams.toString()}`,
  )

  return response.threads
}

export interface ThreadActivityItem {
  id: string
  title: string | null
  activity: {
    state: 'pending' | 'running' | 'waiting' | 'approval' | 'failed' | 'completed'
    label: string
    updatedAt: string
    completedAt: string | null
  }
}

export const getThreadsActivity = async (
  options: { completedWithinMinutes?: number } = {},
): Promise<ThreadActivityItem[]> => {
  const searchParams = new URLSearchParams()

  if (options.completedWithinMinutes != null) {
    searchParams.set('completed_within_minutes', String(options.completedWithinMinutes))
  }

  const query = searchParams.toString()
  const response = await apiRequest<{ threads: ThreadActivityItem[] }>(
    `/threads/activity${query ? `?${query}` : ''}`,
  )

  return response.threads
}

export const markThreadActivitySeen = async (threadId: ThreadId | string): Promise<void> => {
  const response = await apiFetch(toApiUrl(`/threads/${threadId}/activity/seen`), {
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }
}

export const listThreadMessages = (threadId: ThreadId): Promise<BackendThreadMessage[]> =>
  apiRequest<BackendThreadMessage[]>(`/threads/${threadId}/messages`)

export const editThreadMessage = (
  threadId: ThreadId,
  messageId: MessageId,
  input: EditThreadMessageInput,
): Promise<EditThreadMessageOutput> =>
  apiRequest<EditThreadMessageOutput>(`/threads/${threadId}/messages/${messageId}`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })

export interface ThreadBudgetSnapshot {
  actualInputTokens: number | null
  actualOutputTokens: number | null
  actualTotalTokens: number | null
  cachedInputTokens: number | null
  contextWindow: number | null
  estimatedInputTokens: number
  measuredAt: string | null
  model: string | null
  provider: string | null
  reasoningTokens: number | null
  reservedOutputTokens: number | null
  stablePrefixTokens: number | null
  turn: number | null
  volatileSuffixTokens: number | null
}

export interface ThreadBudgetResponse {
  budget: ThreadBudgetSnapshot | null
}

export interface ThreadObservationItem {
  text: string
}

export interface ThreadObservationContent {
  observations: ThreadObservationItem[]
  source: 'observer_v1'
}

export interface ThreadReflectionContent {
  reflection: string
  source: 'reflector_v1'
}

export interface ThreadMemoryRecord {
  content: ThreadObservationContent
  createdAt: string
  id: string
  kind: 'observation'
  tokenCount: number | null
}

export interface ThreadMemoryReflection {
  content: ThreadReflectionContent
  createdAt: string
  generation: number
  id: string
  kind: 'reflection'
  tokenCount: number | null
}

export interface ThreadMemoryResponse {
  observations: ThreadMemoryRecord[]
  reflection: ThreadMemoryReflection | null
}

export type UpdateThreadMemoryInput =
  | {
      kind: 'observation'
      observations: ThreadObservationItem[]
    }
  | {
      kind: 'reflection'
      reflection: string
    }

export interface ThreadMemoryUpdateResponse {
  record: ThreadMemoryRecord | ThreadMemoryReflection
}

export const getThreadMemory = (threadId: ThreadId): Promise<ThreadMemoryResponse> =>
  apiRequest<ThreadMemoryResponse>(`/threads/${threadId}/memory`)

export const updateThreadMemory = (
  threadId: ThreadId,
  recordId: string,
  input: UpdateThreadMemoryInput,
): Promise<ThreadMemoryRecord | ThreadMemoryReflection> =>
  apiRequest<ThreadMemoryUpdateResponse>(`/threads/${threadId}/memory/${recordId}`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PATCH',
  }).then((response) => response.record)

export const getThreadBudget = async (threadId: ThreadId): Promise<ThreadBudgetSnapshot | null> => {
  const response = await apiRequest<ThreadBudgetResponse>(`/threads/${threadId}/budget`)
  return response.budget
}

export const renameThread = (threadId: ThreadId, title: string): Promise<BackendThread> =>
  apiRequest<BackendThread>(`/threads/${threadId}`, {
    body: JSON.stringify({
      title,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })

export const regenerateThreadTitle = (threadId: ThreadId): Promise<void> =>
  apiRequest<{ accepted: true; threadId: ThreadId }>(`/threads/${threadId}/title/regenerate`, {
    method: 'POST',
  }).then(() => undefined)

export const deleteThread = (threadId: ThreadId): Promise<void> =>
  apiRequest<{ deleted: true; threadId: ThreadId }>(`/threads/${threadId}`, {
    method: 'DELETE',
  }).then(() => undefined)
