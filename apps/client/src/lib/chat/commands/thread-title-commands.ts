import type { BackendThread, ThreadId } from '@wonderlands/contracts/chat'

interface ThreadTitleCommandsDependencies<Lease> {
  applyThreadTitle: (thread: Pick<BackendThread, 'title'>) => void
  captureViewLease: () => Lease
  ensureThreadEventStream: (threadId: ThreadId, lease: Lease) => Promise<void>
  getThreadId: () => ThreadId | null
  isBusy: () => boolean
  isThreadLeaseCurrent: (lease: Lease, threadId: ThreadId) => boolean
  isThreadNaming: () => boolean
  persistState: () => void
  regenerateThreadTitle: (threadId: ThreadId) => Promise<void>
  renameThread: (threadId: ThreadId, title: string) => Promise<BackendThread>
  setError: (message: string | null) => void
  setStreamPulse: () => void
  setThreadNaming: (value: boolean) => void
  toDisplayError: (error: unknown, fallback: string) => string
}

export const createThreadTitleCommands = <Lease>(
  dependencies: ThreadTitleCommandsDependencies<Lease>,
) => {
  const renameCurrentThread = async (title: string, currentTitle: string | null) => {
    const threadId = dependencies.getThreadId()
    if (!threadId) {
      return
    }

    const trimmedTitle = title.trim()
    if (!trimmedTitle || trimmedTitle === (currentTitle?.trim() ?? '')) {
      return
    }

    dependencies.setError(null)

    try {
      const updatedThread = await dependencies.renameThread(threadId, trimmedTitle)
      dependencies.applyThreadTitle(updatedThread)
      dependencies.setThreadNaming(false)
      dependencies.persistState()
      dependencies.setStreamPulse()
    } catch (error) {
      dependencies.setError(
        dependencies.toDisplayError(error, 'Failed to rename the conversation.'),
      )
    }
  }

  const regenerateCurrentThreadTitle = async () => {
    const threadId = dependencies.getThreadId()
    if (!threadId || dependencies.isBusy() || dependencies.isThreadNaming()) {
      return
    }

    dependencies.setError(null)
    dependencies.setThreadNaming(true)
    dependencies.persistState()
    dependencies.setStreamPulse()

    const viewLease = dependencies.captureViewLease()
    void dependencies.ensureThreadEventStream(threadId, viewLease).catch((error) => {
      if (dependencies.isThreadLeaseCurrent(viewLease, threadId)) {
        dependencies.setError(
          dependencies.toDisplayError(error, 'Failed to connect to the event stream.'),
        )
      }
    })

    try {
      await dependencies.regenerateThreadTitle(threadId)
    } catch (error) {
      if (dependencies.isThreadLeaseCurrent(viewLease, threadId)) {
        dependencies.setThreadNaming(false)
        dependencies.setError(
          dependencies.toDisplayError(error, 'Failed to regenerate the conversation name.'),
        )
        dependencies.persistState()
        dependencies.setStreamPulse()
      }
    }
  }

  return {
    regenerateCurrentThreadTitle,
    renameCurrentThread,
  }
}
