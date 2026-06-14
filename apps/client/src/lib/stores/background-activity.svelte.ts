import type { ThreadActivityState } from '@wonderlands/contracts/chat'
import {
  getThreadsActivity,
  markThreadActivitySeen,
  type ThreadActivityItem,
} from '../services/api'

export interface ActivityThread {
  id: string
  title: string
  state: ThreadActivityState
  label: string
}

const POLL_INTERVAL_MS = 8_000
const seenActivityStates = new Set<ThreadActivityState>(['completed', 'failed'])

export const createBackgroundActivityStore = (deps: {
  currentThreadId: () => string | null
  sessionId: () => string | null
}) => {
  let threads = $state<ActivityThread[]>([])
  let sourceThreads: ThreadActivityItem[] = []
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let boundSessionId: string | null = null
  let listening = false

  const notifySeen = (threadId: string) => {
    void markThreadActivitySeen(threadId).catch(() => {
      // Swallow — the next poll or thread-open action can retry.
    })
  }

  const projectThreads = () => {
    const currentId = deps.currentThreadId()

    if (currentId) {
      const currentThread = sourceThreads.find((thread) => thread.id === currentId)

      if (currentThread && seenActivityStates.has(currentThread.activity.state)) {
        notifySeen(currentId)
      }
    }

    threads = sourceThreads
      .filter((thread) => thread.id !== currentId)
      .map((thread) => ({
        id: thread.id,
        title: thread.title?.trim() || 'Untitled',
        state: thread.activity.state as ThreadActivityState,
        label: thread.activity.label,
      }))
  }

  const poll = async () => {
    if (disposed) return

    const session = deps.sessionId()
    if (!session) {
      sourceThreads = []
      threads = []
      return
    }

    if (session !== boundSessionId) {
      sourceThreads = []
      threads = []
      boundSessionId = session
    }

    try {
      const result = await getThreadsActivity()

      // Guard: session might have changed while awaiting
      if (disposed || deps.sessionId() !== session) return

      sourceThreads = result
      projectThreads()
    } catch {
      // Swallow — don't disrupt the UI on transient failures
    }
  }

  const schedulePoll = () => {
    if (disposed) return
    pollTimer = setTimeout(async () => {
      await poll()
      schedulePoll()
    }, POLL_INTERVAL_MS)
  }

  const handleVisibilityChange = () => {
    if (document.hidden) {
      if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
    } else {
      void poll()
      schedulePoll()
    }
  }

  const start = () => {
    disposed = false
    if (!listening) {
      document.addEventListener('visibilitychange', handleVisibilityChange)
      listening = true
    }
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    boundSessionId = deps.sessionId()
    void poll()
    schedulePoll()
  }

  const stop = () => {
    disposed = true
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    if (listening) {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      listening = false
    }
    threads = []
    boundSessionId = null
  }

  const reset = () => {
    sourceThreads = []
    threads = []
    boundSessionId = null
    if (!disposed) {
      void poll()
    }
  }

  return {
    get threads() {
      return threads
    },
    syncCurrentThread() {
      projectThreads()
    },
    start,
    stop,
    reset,
  }
}
