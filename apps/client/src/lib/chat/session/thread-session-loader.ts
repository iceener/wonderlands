import type {
  BackendRun,
  BackendThread,
  BackendThreadMessage,
  MessageAttachment,
  MessageId,
  RunId,
  ThreadId,
} from '@wonderlands/contracts/chat'
import type { ThreadBudgetSnapshot } from '../../services/api'

interface ThreadSessionLoaderDependencies<Lease, RunLease, Budget, Message> {
  applyThreadTitle: (thread: BackendThread) => void
  bindActiveRun: (runId: RunId) => void
  bootstrapActiveRunTranscriptFromBackend: (
    run: BackendRun,
    lease: Lease,
    runLease: RunLease,
  ) => Promise<void>
  captureRunLease: (runId: RunId) => RunLease
  ensureThreadEventStream: (threadId: ThreadId, lease: Lease) => Promise<void>
  getIsWaiting: () => boolean
  getLocalAttachments: (messageId: MessageId) => MessageAttachment[]
  getRun: (runId: RunId) => Promise<BackendRun>
  getRunStatus: () => BackendRun['status'] | null
  getThreadBudget: (threadId: ThreadId) => Promise<ThreadBudgetSnapshot | null>
  isTerminalRunStatus: (status: BackendRun['status']) => boolean
  isThreadLeaseCurrent: (lease: Lease, threadId: ThreadId | null) => boolean
  listThreadMessages: (threadId: ThreadId) => Promise<BackendThreadMessage[]>
  mapThreadMessage: (message: BackendThreadMessage, attachments: MessageAttachment[]) => Message
  persistState: () => void
  refreshThreadMessages: (threadId: ThreadId, lease: Lease) => Promise<void>
  releaseLiveAssistantAfterTerminal: (runId: RunId) => void
  replaceDurableMessages: (messages: Message[]) => void
  resolveHydratedRun: (run: BackendRun, threadId: ThreadId, lease: Lease) => Promise<BackendRun>
  setContextBudget: (budget: Budget | null) => void
  setError: (message: string) => void
  setEventCursorForThread: (threadId: ThreadId) => void
  setSessionId: (sessionId: BackendThread['sessionId']) => void
  setThreadId: (threadId: ThreadId) => void
  setThreadNaming: (isThreadNaming: boolean) => void
  syncRunStateFromBackend: (run: BackendRun, lease: Lease, runLease: RunLease) => Promise<unknown>
  toContextBudget: (budget: ThreadBudgetSnapshot) => Budget
  toDisplayError: (error: unknown, fallback: string) => string
}

export const createThreadSessionLoader = <Lease, RunLease, Budget, Message>(
  dependencies: ThreadSessionLoaderDependencies<Lease, RunLease, Budget, Message>,
) => {
  const loadThread = async (thread: BackendThread, lease: Lease) => {
    dependencies.setSessionId(thread.sessionId)
    dependencies.setThreadId(thread.id)
    dependencies.setEventCursorForThread(thread.id)
    dependencies.applyThreadTitle(thread)
    dependencies.setThreadNaming(false)

    const [messages, budget] = await Promise.all([
      dependencies.listThreadMessages(thread.id),
      dependencies.getThreadBudget(thread.id).catch(() => null),
    ])

    if (!dependencies.isThreadLeaseCurrent(lease, thread.id)) {
      return
    }

    dependencies.setContextBudget(budget ? dependencies.toContextBudget(budget) : null)
    dependencies.replaceDurableMessages(
      messages.map((message) =>
        dependencies.mapThreadMessage(message, dependencies.getLocalAttachments(message.id)),
      ),
    )
    dependencies.persistState()
  }

  const hydrateThreadRunFromRootJob = async (thread: BackendThread, lease: Lease) => {
    const currentRunId = thread.rootJob?.currentRunId

    if (!currentRunId) {
      return
    }

    const currentRun = await dependencies.getRun(currentRunId)
    if (!dependencies.isThreadLeaseCurrent(lease, thread.id)) {
      return
    }

    const run = await dependencies.resolveHydratedRun(currentRun, thread.id, lease)
    if (!dependencies.isThreadLeaseCurrent(lease, thread.id)) {
      return
    }

    dependencies.bindActiveRun(run.id)
    await dependencies.syncRunStateFromBackend(run, lease, dependencies.captureRunLease(run.id))
    if (
      !dependencies.isThreadLeaseCurrent(lease, thread.id) ||
      dependencies.isTerminalRunStatus(run.status)
    ) {
      return
    }

    if (run.status === 'running' || run.status === 'pending') {
      await dependencies.bootstrapActiveRunTranscriptFromBackend(
        run,
        lease,
        dependencies.captureRunLease(run.id),
      )
      if (!dependencies.isThreadLeaseCurrent(lease, thread.id)) {
        return
      }

      const currentRunStatus = dependencies.getRunStatus()
      if (currentRunStatus && dependencies.isTerminalRunStatus(currentRunStatus)) {
        await dependencies.refreshThreadMessages(thread.id, lease).catch((error) => {
          if (dependencies.isThreadLeaseCurrent(lease, thread.id)) {
            dependencies.setError(
              dependencies.toDisplayError(error, 'Failed to refresh thread messages.'),
            )
          }
        })
        if (!dependencies.getIsWaiting() && dependencies.isThreadLeaseCurrent(lease, thread.id)) {
          dependencies.releaseLiveAssistantAfterTerminal(run.id)
        }
        return
      }
    }

    void dependencies.ensureThreadEventStream(thread.id, lease).catch((error) => {
      if (dependencies.isThreadLeaseCurrent(lease, thread.id)) {
        dependencies.setError(
          dependencies.toDisplayError(error, 'Failed to connect to the event stream.'),
        )
      }
    })
  }

  return {
    hydrateThreadRunFromRootJob,
    loadThread,
  }
}
