import { createAccountPreferencesRepository } from '../../adapters/persistence/sqlite/preferences/account-preferences-repository'
import { createAgentRepository } from '../../domain/agents/agent-repository'
import {
  type AgentRevisionRecord,
  createAgentRevisionRepository,
} from '../../domain/agents/agent-revision-repository'
import type { AiProviderName } from '../../domain/ai/types'
import type { RepositoryDatabase } from '../../domain/database-port'
import type { DomainError } from '../../shared/errors'
import { type AgentId, type AgentRevisionId, asAgentId, type ToolProfileId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { canReadAgent } from './agent-access'
import { resolveRuntimeSettingsFromAgentRevision } from './agent-runtime-policy'

export interface RootRunAgentBinding {
  agentId: AgentId | null
  agentName: string | null
  agentRevisionId: AgentRevisionId | null
  agentSlug: string | null
  targetKind: 'assistant' | 'agent'
  toolProfileId: ToolProfileId | null
  resolvedConfigSnapshot: {
    model: string | null
    modelAlias: string | null
    provider: AiProviderName | null
    reasoning: Record<string, unknown> | null
  }
}

export interface ResolveRootRunAgentBindingInput {
  agentId?: string | null
  useAccountDefaultAgent?: boolean
  overrides?: {
    model?: string | null
    modelAlias?: string | null
    provider?: AiProviderName | null
    reasoning?: Record<string, unknown> | null
  }
}

const resolveReadableAgent = (
  db: RepositoryDatabase,
  scope: TenantScope,
  explicitAgentId: string | null | undefined,
  useAccountDefaultAgent: boolean,
): Result<
  null | {
    agentId: AgentId
    agentName: string
    agentSlug: string
    revision: AgentRevisionRecord
  },
  DomainError
> => {
  const agentRepository = createAgentRepository(db)
  const revisionRepository = createAgentRevisionRepository(db)
  const accountPreferencesRepository = createAccountPreferencesRepository(db)
  let selectedAgentId: AgentId | null = explicitAgentId ? asAgentId(explicitAgentId) : null

  if (!selectedAgentId && useAccountDefaultAgent) {
    const preferences = accountPreferencesRepository.getByAccountId(scope, scope.accountId)

    if (preferences.ok) {
      if (preferences.value.defaultTargetKind === 'agent' && preferences.value.defaultAgentId) {
        selectedAgentId = preferences.value.defaultAgentId
      }
    } else if (preferences.error.type !== 'not_found') {
      return preferences
    }
  }

  if (!selectedAgentId) {
    return ok(null)
  }

  const agent = agentRepository.getById(scope, selectedAgentId)

  if (!agent.ok) {
    return agent
  }

  if (!canReadAgent(scope, agent.value)) {
    return err({
      message: `agent ${selectedAgentId} is not visible to account ${scope.accountId}`,
      type: 'permission',
    })
  }

  if (agent.value.status !== 'active') {
    return err({
      message: `agent ${selectedAgentId} is not active`,
      type: 'conflict',
    })
  }

  if (!agent.value.activeRevisionId) {
    return err({
      message: `agent ${selectedAgentId} has no active revision`,
      type: 'conflict',
    })
  }

  const revision = revisionRepository.getById(scope, agent.value.activeRevisionId)

  if (!revision.ok) {
    return revision
  }

  return ok({
    agentId: agent.value.id,
    agentName: agent.value.name,
    agentSlug: agent.value.slug,
    revision: revision.value,
  })
}

export const resolveRootRunAgentBinding = (
  db: RepositoryDatabase,
  scope: TenantScope,
  input: ResolveRootRunAgentBindingInput,
): Result<RootRunAgentBinding, DomainError> => {
  const selected = resolveReadableAgent(
    db,
    scope,
    input.agentId,
    input.useAccountDefaultAgent !== false,
  )
  const preferences = createAccountPreferencesRepository(db).getByAccountId(scope, scope.accountId)
  const assistantToolProfileId = preferences.ok ? preferences.value.assistantToolProfileId : null

  if (!selected.ok) {
    return selected
  }

  if (!selected.value) {
    return ok({
      agentId: null,
      agentName: null,
      agentRevisionId: null,
      agentSlug: null,
      targetKind: 'assistant',
      toolProfileId: assistantToolProfileId,
      resolvedConfigSnapshot: {
        model: input.overrides?.model ?? null,
        modelAlias: input.overrides?.modelAlias ?? null,
        provider: input.overrides?.provider ?? null,
        reasoning: input.overrides?.reasoning ?? null,
      },
    })
  }

  const runtimeSettings = resolveRuntimeSettingsFromAgentRevision(
    selected.value.revision,
    assistantToolProfileId,
    input.overrides,
  )

  return ok({
    agentId: selected.value.agentId,
    agentName: selected.value.agentName,
    agentRevisionId: selected.value.revision.id,
    agentSlug: selected.value.agentSlug,
    targetKind: 'agent',
    toolProfileId: runtimeSettings.toolProfileId,
    resolvedConfigSnapshot: runtimeSettings.resolvedConfigSnapshot,
  })
}
