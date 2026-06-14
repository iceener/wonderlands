import type { BackendAgentSummary } from '@wonderlands/contracts/chat'
import { searchCommands } from './search'
import type { CommandItem, PaletteProvider, ScoredCommandItem } from './types'

export interface AgentProviderDeps {
  listAgents: (options?: { limit?: number }) => Promise<BackendAgentSummary[]>
  onSelectAgent: (agent: BackendAgentSummary) => void | Promise<void>
  limit?: number
}

const visibilityToGroup = (visibility: BackendAgentSummary['visibility']): string => {
  switch (visibility) {
    case 'tenant_shared':
      return 'Shared Agents'
    case 'system':
      return 'System'
    default:
      return 'My Agents'
  }
}

const toStaticResults = (items: readonly CommandItem[], score = 0): ScoredCommandItem[] =>
  items
    .filter((item) => item.enabled())
    .map((item, index) => ({
      item,
      matchRanges: [],
      score: score - index,
    }))

export const createAgentProvider = ({
  listAgents,
  onSelectAgent,
  limit = 50,
}: AgentProviderDeps): PaletteProvider => {
  let cachedAgents = $state<BackendAgentSummary[] | null>(null)
  let isLoading = $state(false)
  let loadError = $state<string | null>(null)
  let inflight = $state<Promise<void> | null>(null)

  const resetCache = (): void => {
    cachedAgents = null
    isLoading = false
    loadError = null
    inflight = null
  }

  const loadAgents = async (force = false): Promise<void> => {
    if (inflight) {
      await inflight
      return
    }

    if (!force && cachedAgents) {
      return
    }

    isLoading = true
    loadError = null

    const request = listAgents({ limit })
      .then((agents) => {
        cachedAgents = agents
        loadError = null
      })
      .catch((error) => {
        cachedAgents = null
        loadError = error instanceof Error ? error.message : 'Failed to load agents.'
      })
      .finally(() => {
        isLoading = false
        inflight = null
      })

    inflight = request
    await request
  }

  const getBaseItems = (): CommandItem[] =>
    (cachedAgents ?? []).map((agent) => ({
      id: agent.id,
      label: agent.name,
      group: visibilityToGroup(agent.visibility),
      keywords: [agent.slug, agent.kind, agent.visibility.replaceAll('_', ' ')],
      shortcutHint: agent.isDefaultForAccount ? 'default' : undefined,
      enabled: () => true,
      run: async () => {
        await onSelectAgent(agent)
      },
    }))

  return {
    id: 'agents',
    mode: 'mention',
    getItems(query) {
      if (!cachedAgents && !isLoading && !inflight) {
        void loadAgents()
      }

      if (loadError) {
        return toStaticResults(
          [
            {
              id: 'agents.retry',
              label: `Failed to load agents — click to retry`,
              group: 'Agents',
              keywords: ['retry', 'reload', 'agents'],
              enabled: () => true,
              run: () => {
                void loadAgents(true)
              },
            },
          ],
          100,
        )
      }

      if (isLoading && !cachedAgents) {
        return toStaticResults(
          [
            {
              id: 'agents.loading',
              label: 'Loading agents...',
              group: 'Agents',
              keywords: ['loading', 'agents'],
              enabled: () => true,
              run: () => undefined,
            },
          ],
          100,
        )
      }

      return searchCommands(query, getBaseItems())
    },
    onOpen() {
      void loadAgents(true)
    },
    onSelect(item) {
      void item.run()
    },
    onDismiss() {
      resetCache()
    },
  }
}
