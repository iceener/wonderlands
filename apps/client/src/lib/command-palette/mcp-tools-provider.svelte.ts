import type { BackendMcpServerTool } from '../services/api'
import { humanizeErrorMessage } from '../services/response-errors'
import { searchCommands } from './search'
import type { CommandItem, PaletteProvider, ScoredCommandItem } from './types'

export interface McpToolsProviderDeps {
  serverId: string
  serverLabel: string
  getMcpServerTools: (serverId: string) => Promise<{ tools: BackendMcpServerTool[] }>
  onToggleTool: (tool: BackendMcpServerTool, selected: boolean) => void
  onSave: () => void
  onBack: () => void
  isToolSelected: (runtimeName: string) => boolean
}

export const createMcpToolsProvider = ({
  serverId,
  serverLabel,
  getMcpServerTools,
  onToggleTool,
  onSave,
  onBack,
  isToolSelected,
}: McpToolsProviderDeps): PaletteProvider => {
  let tools = $state<BackendMcpServerTool[]>([])
  let isLoading = $state(false)
  let loadError = $state<string | null>(null)

  const loadTools = async (): Promise<void> => {
    isLoading = true
    loadError = null

    try {
      const result = await getMcpServerTools(serverId)
      tools = result.tools
    } catch (error) {
      loadError =
        error instanceof Error ? humanizeErrorMessage(error.message) : 'Failed to load tools.'
    } finally {
      isLoading = false
    }
  }

  const getBaseItems = (): CommandItem[] => {
    const items: CommandItem[] = [
      {
        id: 'mcp-tools.back',
        label: '← Back to servers',
        group: 'Navigation',
        keywords: ['back', 'servers', 'list'],
        enabled: () => true,
        run: () => onBack(),
      },
      {
        id: 'mcp-tools.save',
        label: 'Save Tool Access',
        group: 'Actions',
        keywords: ['save', 'apply', 'confirm'],
        enabled: () => true,
        run: () => onSave(),
      },
    ]

    for (const tool of tools.filter((t) => t.modelVisible)) {
      const selected = isToolSelected(tool.runtimeName)
      items.push({
        id: `mcp-tool.${tool.runtimeName}`,
        label: `${selected ? '☑' : '☐'} ${tool.title?.trim() || tool.remoteName}`,
        group: `Tools — ${serverLabel}`,
        shortcutHint: selected ? 'assigned' : undefined,
        keywords: [tool.runtimeName, tool.description ?? '', tool.remoteName],
        enabled: () => true,
        run: () => onToggleTool(tool, !selected),
      })
    }

    return items
  }

  const toStaticResults = (items: CommandItem[]): ScoredCommandItem[] =>
    items
      .filter((item) => item.enabled())
      .map((item, index) => ({ item, matchRanges: [], score: 100 - index }))

  return {
    id: 'mcp-tools',
    mode: 'command',
    getItems(query) {
      if (loadError) {
        return toStaticResults([
          {
            id: 'mcp-tools.retry',
            label: 'Retry loading tools',
            group: 'MCP',
            keywords: ['retry'],
            enabled: () => true,
            run: () => {
              void loadTools()
            },
          },
        ])
      }

      if (isLoading) {
        return toStaticResults([
          {
            id: 'mcp-tools.loading',
            label: `Loading tools for ${serverLabel}…`,
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
      void loadTools()
    },
    onSelect(item) {
      void item.run()
    },
  }
}
