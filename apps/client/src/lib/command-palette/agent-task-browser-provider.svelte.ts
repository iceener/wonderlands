import type { BackendAgentScheduledTask } from '@wonderlands/contracts/chat'
import { searchCommands } from './search'
import type { CommandItem, PaletteProvider, ScoredCommandItem } from './types'

export interface AgentTaskBrowserProviderDeps {
  listAgentTasks: () => Promise<BackendAgentScheduledTask[]>
  onCreateNew: () => void
  onEditTask: (task: BackendAgentScheduledTask) => void
}

const statusToGroup = (task: BackendAgentScheduledTask): string => {
  switch (task.status) {
    case 'active':
      return 'Active Scheduled Tasks'
    case 'paused':
      return 'Paused Scheduled Tasks'
    case 'archived':
      return 'Archived Scheduled Tasks'
    default:
      return 'Scheduled Tasks'
  }
}

const toStaticResults = (items: readonly CommandItem[]): ScoredCommandItem[] =>
  items
    .filter((item) => item.enabled())
    .map((item, index) => ({
      item,
      matchRanges: [],
      score: 100 - index,
    }))

export const createAgentTaskBrowserProvider = ({
  listAgentTasks,
  onCreateNew,
  onEditTask,
}: AgentTaskBrowserProviderDeps): PaletteProvider => {
  let cachedTasks = $state<BackendAgentScheduledTask[] | null>(null)
  let isLoading = $state(false)
  let loadError = $state<string | null>(null)
  let inflight = $state<Promise<void> | null>(null)

  const resetCache = (): void => {
    cachedTasks = null
    isLoading = false
    loadError = null
    inflight = null
  }

  const loadTasks = async (force = false): Promise<void> => {
    if (inflight) {
      await inflight
      return
    }

    if (!force && cachedTasks) {
      return
    }

    isLoading = true
    loadError = null

    const request = listAgentTasks()
      .then((tasks) => {
        cachedTasks = tasks
        loadError = null
      })
      .catch((error) => {
        cachedTasks = null
        loadError = error instanceof Error ? error.message : 'Failed to load scheduled tasks.'
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
        id: 'agent-tasks.new',
        label: 'New Scheduled Task',
        group: 'Actions',
        keywords: ['new', 'create', 'scheduled task', 'cron', 'automation'],
        enabled: () => true,
        run: () => onCreateNew(),
      },
    ]

    for (const task of cachedTasks ?? []) {
      items.push({
        id: task.id,
        label: task.name,
        group: statusToGroup(task),
        keywords: [
          task.status,
          task.cronExpression,
          task.agentName ?? '',
          task.lastDisplayStatus ?? '',
          task.id,
        ],
        shortcutHint: task.lastDisplayStatus ?? task.status,
        enabled: () => true,
        run: () => onEditTask(task),
      })
    }

    return items
  }

  return {
    id: 'agent-task-browser',
    mode: 'command',
    getItems(query) {
      if (!cachedTasks && !isLoading && !inflight) {
        void loadTasks()
      }

      if (loadError) {
        return toStaticResults([
          {
            id: 'agent-tasks.retry',
            label: 'Failed to load scheduled tasks — click to retry',
            group: 'Scheduled Tasks',
            keywords: ['retry', 'reload', 'scheduled tasks'],
            enabled: () => true,
            run: () => {
              void loadTasks(true)
            },
          },
        ])
      }

      if (isLoading && !cachedTasks) {
        return toStaticResults([
          {
            id: 'agent-tasks.loading',
            label: 'Loading scheduled tasks…',
            group: 'Scheduled Tasks',
            keywords: ['loading', 'scheduled tasks'],
            enabled: () => true,
            run: () => undefined,
          },
        ])
      }

      return searchCommands(query, getBaseItems())
    },
    onOpen() {
      void loadTasks(true)
    },
    onSelect(item) {
      void item.run()
    },
    onDismiss() {
      resetCache()
    },
  }
}
