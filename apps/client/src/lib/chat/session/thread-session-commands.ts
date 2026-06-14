import type { BackendThread, MessageId, ThreadId } from '@wonderlands/contracts/chat'

interface ThreadSessionCommandsDependencies<Lease> {
  beginViewLease: () => Lease
  branchThread: (
    threadId: ThreadId,
    input: {
      sourceMessageId: MessageId
    },
  ) => Promise<BackendThread>
  bumpStreamPulse: () => void
  captureViewLease: () => Lease
  clearPersistedState: () => void
  clearTargetSelectionState: () => void
  clearContextBudget: () => void
  deleteThread: (threadId: ThreadId) => Promise<void>
  getThreadId: () => ThreadId | null
  hydrateThreadRunFromRootJob: (thread: BackendThread, lease: Lease) => Promise<void>
  isThreadLeaseCurrent: (lease: Lease, threadId: ThreadId | null) => boolean
  isViewLeaseCurrent: (lease: Lease) => boolean
  loadThread: (thread: BackendThread, lease: Lease) => Promise<void>
  refreshThreadBudget: (threadId: ThreadId, lease: Lease) => Promise<void>
  refreshThreadMessages: (threadId: ThreadId, lease: Lease) => Promise<void>
  resetState: () => void
  resolveBranchSourceMessageId: (messageId: MessageId | string) => MessageId | null
  setError: (message: string | null) => void
  setIsLoading: (value: boolean) => void
  stopActiveStream: () => Promise<void>
  toDisplayError: (error: unknown, fallback: string) => string
}

export const createThreadSessionCommands = <Lease>(
  dependencies: ThreadSessionCommandsDependencies<Lease>,
) => {
  const reset = async (options: { clearTargetSelection?: boolean } = {}) => {
    dependencies.beginViewLease()
    dependencies.setError(null)
    dependencies.setIsLoading(false)
    dependencies.clearContextBudget()
    await dependencies.stopActiveStream()
    dependencies.clearPersistedState()
    if (options.clearTargetSelection) {
      dependencies.clearTargetSelectionState()
    }
    dependencies.resetState()
  }

  const refreshCurrentThread = async () => {
    const threadId = dependencies.getThreadId()
    if (!threadId) {
      return
    }

    const viewLease = dependencies.captureViewLease()

    try {
      await dependencies.refreshThreadMessages(threadId, viewLease)
      await dependencies.refreshThreadBudget(threadId, viewLease).catch(() => undefined)
      dependencies.bumpStreamPulse()
    } catch (error) {
      if (dependencies.isThreadLeaseCurrent(viewLease, threadId)) {
        dependencies.setError(
          dependencies.toDisplayError(error, 'Failed to refresh the conversation.'),
        )
      }
    }
  }

  const switchToThread = async (thread: BackendThread) => {
    if (dependencies.getThreadId() === thread.id) {
      return
    }

    const viewLease = dependencies.beginViewLease()
    dependencies.setError(null)
    dependencies.setIsLoading(true)

    try {
      await dependencies.stopActiveStream()
      if (!dependencies.isViewLeaseCurrent(viewLease)) {
        return
      }
      dependencies.resetState()
      dependencies.setIsLoading(true)
      await dependencies.loadThread(thread, viewLease)
      await dependencies.hydrateThreadRunFromRootJob(thread, viewLease)
    } catch (error) {
      if (dependencies.isViewLeaseCurrent(viewLease)) {
        dependencies.setError(dependencies.toDisplayError(error, 'Failed to switch conversations.'))
      }
    } finally {
      if (dependencies.isViewLeaseCurrent(viewLease)) {
        dependencies.setIsLoading(false)
        dependencies.bumpStreamPulse()
      }
    }
  }

  const branchFromMessage = async (messageId: MessageId | string): Promise<boolean> => {
    const threadId = dependencies.getThreadId()
    if (!threadId) {
      return false
    }

    const sourceMessageId = dependencies.resolveBranchSourceMessageId(messageId)
    if (!sourceMessageId) {
      return false
    }

    dependencies.setError(null)
    dependencies.setIsLoading(true)
    const viewLease = dependencies.beginViewLease()

    try {
      await dependencies.stopActiveStream()
      if (!dependencies.isViewLeaseCurrent(viewLease)) {
        return true
      }

      const branchedThread = await dependencies.branchThread(threadId, {
        sourceMessageId,
      })
      if (!dependencies.isViewLeaseCurrent(viewLease)) {
        return true
      }

      dependencies.resetState()
      dependencies.setIsLoading(true)
      await dependencies.loadThread(branchedThread, viewLease)
      return true
    } catch (error) {
      if (dependencies.isViewLeaseCurrent(viewLease)) {
        dependencies.setError(
          dependencies.toDisplayError(error, 'Failed to branch the conversation.'),
        )
      }
      return false
    } finally {
      if (dependencies.isViewLeaseCurrent(viewLease)) {
        dependencies.setIsLoading(false)
        dependencies.bumpStreamPulse()
      }
    }
  }

  const deleteCurrentThread = async () => {
    const threadId = dependencies.getThreadId()
    if (!threadId) {
      return
    }

    dependencies.setError(null)

    try {
      await dependencies.deleteThread(threadId)
      dependencies.setIsLoading(false)
      await dependencies.stopActiveStream()
      dependencies.clearPersistedState()
      dependencies.resetState()
    } catch (error) {
      dependencies.setError(
        dependencies.toDisplayError(error, 'Failed to delete the conversation.'),
      )
    }
  }

  return {
    branchFromMessage,
    deleteCurrentThread,
    refreshCurrentThread,
    reset,
    switchToThread,
  }
}
