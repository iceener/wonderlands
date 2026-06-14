import type { BackendAgentSummary } from '@wonderlands/contracts/chat'
import { humanizeErrorMessage } from '../services/response-errors'
import { searchCommands } from './search'
import type { CommandItem, PaletteProvider, ScoredCommandItem } from './types'

export interface AgentBrowserProviderDeps {
  listAgents: (options?: { limit?: number }) => Promise<BackendAgentSummary[]>
  onEditAgent: (agent: BackendAgentSummary) => void
  onCreateNew: () => void
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

export const createAgentBrowserProvider = ({
  listAgents,
  onEditAgent,
  onCreateNew,
  limit = 200,
}: AgentBrowserProviderDeps): PaletteProvider => {
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

    if (!force && cachedAgents) return

    isLoading = true
    loadError = null

    const request = listAgents({ limit })
      .then((agents) => {
        cachedAgents = agents
        loadError = null
      })
      .catch((error) => {
        cachedAgents = null
        loadError =
          error instanceof Error ? humanizeErrorMessage(error.message) : 'Failed to load agents.'
      })
      .finally(() => {
        isLoading = false
        inflight = null
      })

    inflight = request
    await request
  }

  const getBaseItems = (): CommandItem[] => {
    const items: CommandItem[] = [
      {
        id: 'agent-browser.create',
        label: 'New Agent',
        group: 'Actions',
        keywords: ['new', 'create', 'add', 'agent'],
        enabled: () => true,
        run: () => onCreateNew(),
      },
    ]

    for (const agent of cachedAgents ?? []) {
      const canEdit = agent.visibility !== 'system'

      items.push({
        id: `agent-browser.${agent.id}`,
        label: agent.name,
        group: visibilityToGroup(agent.visibility),
        shortcutHint: agent.isDefaultForAccount ? 'default' : undefined,
        keywords: [agent.slug, agent.kind, agent.visibility.replaceAll('_', ' ')],
        enabled: () => canEdit,
        run: () => onEditAgent(agent),
      })
    }

    return items
  }

  return {
    id: 'agent-browser',
    mode: 'command',
    getItems(query) {
      if (!cachedAgents && !isLoading && !inflight) {
        void loadAgents()
      }

      if (loadError) {
        return toStaticResults(
          [
            {
              id: 'agent-browser.retry',
              label: 'Retry loading agents',
              group: 'Agents',
              keywords: ['retry', 'reload'],
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
              id: 'agent-browser.loading',
              label: 'Loading agents…',
              group: 'Agents',
              keywords: ['loading'],
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
