import type {
  BackendThread,
  BackendThreadRootJob,
  ThreadActivityState,
  ThreadId,
} from '@wonderlands/contracts/chat'
import type { CommandItem, CommandItemActivity, PaletteProvider, ScoredCommandItem } from './types'

export interface ConversationProviderDeps {
  currentThreadId: () => ThreadId | null
  listThreads: (options?: { limit?: number; query?: string }) => Promise<BackendThread[]>
  onSwitchThread: (thread: BackendThread) => void | Promise<void>
  limit?: number
}

const formatUpdatedAt = (value: string): string | undefined => {
  const date = new Date(value)

  if (Number.isNaN(date.valueOf())) {
    return undefined
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }).format(date)
}

const deriveActivity = (
  rootJob: BackendThreadRootJob | null | undefined,
): CommandItemActivity | undefined => {
  if (!rootJob) return undefined

  const map: Record<
    BackendThreadRootJob['status'],
    { state: ThreadActivityState; label: string } | null
  > = {
    queued: { state: 'pending', label: 'Pending' },
    running: { state: 'running', label: 'Running' },
    waiting: { state: 'waiting', label: 'Waiting' },
    blocked: { state: 'failed', label: 'Failed' },
    completed: null,
    cancelled: null,
    superseded: null,
  }

  return map[rootJob.status] ?? undefined
}

const toThreadLabel = (thread: BackendThread, currentThreadId: ThreadId | null): string => {
  const baseLabel = thread.title?.trim() || 'Untitled'
  return thread.id === currentThreadId ? `Current: ${baseLabel}` : baseLabel
}

export const createConversationProvider = ({
  currentThreadId,
  listThreads,
  onSwitchThread,
  limit = 50,
}: ConversationProviderDeps): PaletteProvider => {
  const cachedThreads = new Map<string, BackendThread[]>()
  const inflightByQuery = new Map<string, Promise<void>>()
  let activeQuery = $state('')
  let desiredQuery = $state('')
  let visibleThreads = $state<BackendThread[]>([])
  let isLoading = $state(false)
  let loadError = $state<string | null>(null)
  let latestRequestId = 0

  const normalizeQuery = (query: string): string => query.trim()

  const resetCache = (): void => {
    cachedThreads.clear()
    inflightByQuery.clear()
    activeQuery = ''
    desiredQuery = ''
    visibleThreads = []
    isLoading = false
    loadError = null
  }

  const hydrateVisibleThreads = (query: string): boolean => {
    const cached = cachedThreads.get(query)

    if (!cached) {
      return false
    }

    desiredQuery = query
    activeQuery = query
    visibleThreads = cached
    loadError = null
    return true
  }

  const loadThreads = (query: string): Promise<void> => {
    if (hydrateVisibleThreads(query)) {
      return Promise.resolve()
    }

    const existingRequest = inflightByQuery.get(query)

    if (existingRequest) {
      return existingRequest
    }

    const requestId = latestRequestId + 1
    latestRequestId = requestId
    desiredQuery = query
    isLoading = true
    loadError = null

    const request = listThreads({
      limit,
      query: query.length > 0 ? query : undefined,
    })
      .then((threads) => {
        if (cachedThreads.size >= 50) {
          cachedThreads.clear()
        }
        cachedThreads.set(query, threads)

        if (latestRequestId !== requestId || desiredQuery !== query) {
          return
        }

        activeQuery = query
        visibleThreads = threads
      })
      .catch((error) => {
        if (latestRequestId !== requestId || desiredQuery !== query) {
          return
        }

        loadError = error instanceof Error ? error.message : 'Failed to load conversations.'
      })
      .finally(() => {
        inflightByQuery.delete(query)

        if (latestRequestId === requestId && desiredQuery === query) {
          isLoading = false
        }
      })

    inflightByQuery.set(query, request)

    return request
  }

  const toCommandItems = (threads: BackendThread[]): CommandItem[] =>
    threads.map((thread) => ({
      id: thread.id,
      label: toThreadLabel(thread, currentThreadId()),
      group: 'Conversations',
      activity: deriveActivity(thread.rootJob),
      keywords: [thread.title?.trim() || 'untitled', thread.id, 'conversation', 'thread'],
      shortcutHint: formatUpdatedAt(thread.updatedAt),
      enabled: () => true,
      run: async () => {
        if (thread.id === currentThreadId()) {
          return
        }

        await onSwitchThread(thread)
      },
    }))

  const toResults = (items: CommandItem[]): ScoredCommandItem[] =>
    items.map((item, index) => ({
      item,
      matchRanges: [],
      score: items.length - index,
    }))

  const syncThreadsForQuery = (query: string): void => {
    desiredQuery = query

    if (activeQuery === query && (visibleThreads.length > 0 || isLoading || loadError)) {
      return
    }

    if (hydrateVisibleThreads(query)) {
      return
    }

    void loadThreads(query)
  }

  const getBaseItems = (query: string): CommandItem[] => {
    if (loadError && desiredQuery === query && visibleThreads.length === 0) {
      return [
        {
          id: 'conversation.retry',
          label: `Failed to load conversations — click to retry`,
          group: 'Conversations',
          keywords: ['retry', 'reload', 'conversations', 'search'],
          enabled: () => true,
          run: () => {
            cachedThreads.delete(query)
            void loadThreads(query)
          },
        },
      ]
    }

    if (isLoading && desiredQuery === query && visibleThreads.length > 0) {
      return toCommandItems(visibleThreads)
    }

    if (isLoading && activeQuery === query && visibleThreads.length === 0) {
      return [
        {
          id: 'conversation.loading',
          label: query.length > 0 ? 'Searching conversations...' : 'Loading conversations...',
          group: 'Conversations',
          keywords: ['loading', 'searching', 'conversations'],
          enabled: () => true,
          run: () => undefined,
        },
      ]
    }

    return activeQuery === query ? toCommandItems(visibleThreads) : []
  }

  return {
    id: 'conversations',
    mode: 'conversation',
    getItems(query) {
      return toResults(getBaseItems(normalizeQuery(query)))
    },
    onQueryChange(query) {
      syncThreadsForQuery(normalizeQuery(query))
    },
    onSelect(item) {
      void item.run()
    },
    onDismiss() {
      resetCache()
    },
  }
}
