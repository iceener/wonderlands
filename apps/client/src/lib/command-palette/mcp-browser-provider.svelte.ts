import type { BackendMcpServerEntry } from '../services/api'
import { humanizeErrorMessage } from '../services/response-errors'
import { searchCommands } from './search'
import type { CommandItem, PaletteProvider, ScoredCommandItem } from './types'

export interface McpBrowserProviderDeps {
  listMcpServers: () => Promise<BackendMcpServerEntry[]>
  onEditServer: (entry: BackendMcpServerEntry) => void
  onConnectNew: () => void
  onRefreshServer: (entry: BackendMcpServerEntry) => void
  onDeleteServer: (entry: BackendMcpServerEntry) => void
  onAuthorizeServer: (entry: BackendMcpServerEntry) => void
  onOpenTools: (entry: BackendMcpServerEntry) => void
}

const statusToGroup = (entry: BackendMcpServerEntry): string => {
  if (entry.source === 'static') return 'Built-in Servers'
  switch (entry.snapshot?.status) {
    case 'ready':
      return 'Connected'
    case 'degraded':
      return 'Degraded'
    case 'authorization_required':
      return 'Needs Authorization'
    default:
      return 'MCP Servers'
  }
}

const groupOrder = (entry: BackendMcpServerEntry): number => {
  if (entry.source === 'static') return 0
  switch (entry.snapshot?.status) {
    case 'ready':
      return 1
    case 'authorization_required':
      return 2
    case 'degraded':
      return 3
    default:
      return 4
  }
}

export const createMcpBrowserProvider = ({
  listMcpServers,
  onEditServer: _onEditServer,
  onConnectNew,
  onRefreshServer: _onRefreshServer,
  onDeleteServer: _onDeleteServer,
  onAuthorizeServer: _onAuthorizeServer,
  onOpenTools,
}: McpBrowserProviderDeps): PaletteProvider => {
  let cached = $state<BackendMcpServerEntry[] | null>(null)
  let isLoading = $state(false)
  let loadError = $state<string | null>(null)
  let inflight = $state<Promise<void> | null>(null)

  const resetCache = (): void => {
    cached = null
    isLoading = false
    loadError = null
    inflight = null
  }

  const loadServers = async (force = false): Promise<void> => {
    if (inflight) {
      await inflight
      return
    }

    if (!force && cached) return

    isLoading = true
    loadError = null

    const request = listMcpServers()
      .then((entries) => {
        cached = entries
        loadError = null
      })
      .catch((error) => {
        cached = null
        loadError =
          error instanceof Error
            ? humanizeErrorMessage(error.message)
            : 'Failed to load MCP servers.'
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
        id: 'mcp.connect-new',
        label: 'Connect New MCP',
        group: 'Actions',
        keywords: ['new', 'connect', 'add', 'create'],
        enabled: () => true,
        run: () => onConnectNew(),
      },
    ]

    const orderedEntries = [...(cached ?? [])].sort((left, right) => {
      const orderDelta = groupOrder(left) - groupOrder(right)
      if (orderDelta !== 0) return orderDelta
      const labelDelta = left.label.localeCompare(right.label)
      return labelDelta !== 0 ? labelDelta : left.id.localeCompare(right.id)
    })

    for (const entry of orderedEntries) {
      const summary =
        entry.kind === 'streamable_http'
          ? ((entry.config.url as string | undefined) ?? '')
          : ((entry.config.command as string | undefined) ?? '')

      items.push({
        id: `mcp.server.${entry.id}`,
        label: entry.label,
        group: statusToGroup(entry),
        shortcutHint: entry.snapshot?.status ?? 'unknown',
        keywords: [entry.label, summary, entry.kind, entry.snapshot?.status ?? ''].filter(Boolean),
        enabled: () => true,
        run: () => {
          onOpenTools(entry)
        },
      })
    }

    return items
  }

  const toStaticResults = (items: CommandItem[]): ScoredCommandItem[] =>
    items
      .filter((item) => item.enabled())
      .map((item, index) => ({ item, matchRanges: [], score: 100 - index }))

  return {
    id: 'mcp-browser',
    mode: 'command',
    getItems(query) {
      if (!cached && !isLoading && !inflight) {
        void loadServers()
      }

      if (loadError) {
        return toStaticResults([
          {
            id: 'mcp.retry',
            label: `Failed: ${loadError} — click to retry`,
            group: 'MCP',
            keywords: ['retry'],
            enabled: () => true,
            run: () => {
              void loadServers(true)
            },
          },
        ])
      }

      if (isLoading && !cached) {
        return toStaticResults([
          {
            id: 'mcp.loading',
            label: 'Loading MCP servers…',
            group: 'MCP',
            keywords: ['loading'],
            enabled: () => true,
            run: () => undefined,
          },
        ])
      }

      return searchCommands(query, getBaseItems())
    },
    onOpen() {
      void loadServers(true)
    },
    onSelect(item) {
      void item.run()
    },
    onDismiss() {
      resetCache()
    },
  }
}
