import type {
  AgentId,
  AgentKind,
  AgentStatus,
  AgentVisibility,
  BackendAgentDetail,
  BackendAgentSummary,
  BackendModelsCatalog,
  CreateAgentApiInput,
  UpdateAgentApiInput,
} from '@wonderlands/contracts/chat'
import { apiRequest } from '../backend'

export const getSupportedModels = (): Promise<BackendModelsCatalog> =>
  apiRequest<BackendModelsCatalog>('/system/models')

export const listAgents = async (
  options: {
    kind?: AgentKind
    limit?: number
    status?: AgentStatus
    visibility?: AgentVisibility
  } = {},
): Promise<BackendAgentSummary[]> => {
  const searchParams = new URLSearchParams()

  searchParams.set('limit', String(options.limit ?? 50))
  searchParams.set('status', options.status ?? 'active')

  if (options.kind) {
    searchParams.set('kind', options.kind)
  }

  if (options.visibility) {
    searchParams.set('visibility', options.visibility)
  }

  return apiRequest<BackendAgentSummary[]>(`/agents?${searchParams.toString()}`)
}

export const getAgent = (agentId: AgentId): Promise<BackendAgentDetail> =>
  apiRequest<BackendAgentDetail>(`/agents/${encodeURIComponent(agentId)}`)

export const createAgent = (input: CreateAgentApiInput): Promise<BackendAgentDetail> =>
  apiRequest<BackendAgentDetail>('/agents', {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

export const updateAgent = (
  agentId: AgentId,
  input: UpdateAgentApiInput,
): Promise<BackendAgentDetail> =>
  apiRequest<BackendAgentDetail>(`/agents/${encodeURIComponent(agentId)}`, {
    body: JSON.stringify(input),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PUT',
  })

export const renameAgent = (agentId: AgentId, name: string): Promise<BackendAgentSummary> =>
  apiRequest<BackendAgentSummary>(`/agents/${encodeURIComponent(agentId)}`, {
    body: JSON.stringify({ name }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PATCH',
  })

export const deleteAgent = (agentId: AgentId): Promise<void> =>
  apiRequest<{ agentId: AgentId; deleted: true }>(`/agents/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
  }).then(() => undefined)

export const getAgentMarkdown = (
  agentId: AgentId,
): Promise<{ agentId: string; markdown: string; revisionId: string }> =>
  apiRequest<{ agentId: string; markdown: string; revisionId: string }>(
    `/agents/${encodeURIComponent(agentId)}/markdown`,
  )

export const updateAgentMarkdown = (
  agentId: AgentId,
  markdown: string,
): Promise<BackendAgentDetail> =>
  apiRequest<BackendAgentDetail>(`/agents/${encodeURIComponent(agentId)}/markdown`, {
    body: JSON.stringify({ markdown }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'PUT',
  })
