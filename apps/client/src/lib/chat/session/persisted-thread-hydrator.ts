import type {
  BackendRun,
  BackendThread,
  MessageId,
  RunId,
  ThreadId,
} from '@wonderlands/contracts/chat'
import type { PersistedRunTranscriptState, RunTranscriptState } from '../types'

interface PersistedThreadHydratorDependencies<Lease, RunLease, PersistedState> {
  applyPersistedStateSnapshot: (persistedState: PersistedState | null) => ThreadId | null
  awaitStreamOutcome: (
    streamPromise: Promise<void>,
    runId: RunId,
    viewLease: Lease,
    runLease: RunLease,
  ) => Promise<void>
  bindActiveRun: (runId: RunId) => void
  bootstrapActiveRunTranscriptFromBackend: (
    run: BackendRun,
    lease: Lease,
    runLease: RunLease,
  ) => Promise<void>
  captureRunLease: (runId: RunId) => RunLease
  connectThreadEventStream: (threadId: ThreadId, lease: Lease) => Promise<void>
  ensurePendingWaitBlocks: (createdAt: string) => void
  ensureRunTranscript: (
    runId: RunId,
    createdAt: string,
    input: {
      preferredMessageId?: MessageId
      source: 'durableSnapshot'
    },
  ) => RunTranscriptState
  finalizeRun: (
    status: BackendRun['status'],
    finishReason: ReturnType<
      PersistedThreadHydratorDependencies<
        Lease,
        RunLease,
        PersistedState
      >['finishReasonForRunStatus']
    >,
    input: { runId: RunId },
  ) => void
  finishReasonForRunStatus: (
    status: BackendRun['status'],
  ) => 'waiting' | 'error' | 'cancelled' | 'stop' | null
  getIsWaiting: () => boolean
  getRun: (runId: RunId) => Promise<BackendRun>
  getRunId: () => RunId | null
  getRunStatus: () => BackendRun['status'] | null
  getThread: (threadId: ThreadId) => Promise<BackendThread>
  getThreadId: () => ThreadId | null
  hydrateAssistantTranscriptFromRunSnapshot: (run: BackendRun) => boolean
  hydratePendingWaitState: (run: BackendRun) => void
  isTerminalRunStatus: (status: BackendRun['status']) => boolean
  isThreadLeaseCurrent: (lease: Lease, threadId: ThreadId | null) => boolean
  isViewLeaseCurrent: (lease: Lease) => boolean
  loadThread: (thread: BackendThread, lease: Lease) => Promise<void>
  primeRunReplayGuardFromSnapshot: (run: BackendRun) => void
  readPersistedState: () => PersistedState | null
  refreshThreadMessages: (threadId: ThreadId, lease: Lease) => Promise<void>
  releaseLiveAssistantAfterTerminal: (runId: RunId) => void
  resetRunState: () => void
  resetState: () => void
  resolveHydratedRun: (run: BackendRun, threadId: ThreadId, lease: Lease) => Promise<BackendRun>
  resolveTranscriptProjectionMessageId: (runId: RunId) => MessageId | null
  restorePersistedRunTranscript: (transcript: PersistedRunTranscriptState | null) => void
  scheduleRunReconciliation: (runId: RunId, lease: Lease, runLease: RunLease) => void
  setError: (message: string) => void
  setIsStreaming: (value: boolean) => void
  setIsWaiting: (value: boolean) => void
  setRunStatus: (status: BackendRun['status']) => void
  stopActiveStream: () => Promise<void>
  syncLiveAssistantProjectionFromTranscript: (
    runId: RunId,
    createdAt: string,
    input: { preferredId?: MessageId },
  ) => unknown
  toDisplayError: (error: unknown, fallback: string) => string
  getPersistedRunTranscript: (
    persistedState: PersistedState | null,
  ) => PersistedRunTranscriptState | null
}

export const createPersistedThreadHydrator = <Lease, RunLease, PersistedState>(
  dependencies: PersistedThreadHydratorDependencies<Lease, RunLease, PersistedState>,
) => {
  const hydrate = async (viewLease: Lease) => {
    try {
      await dependencies.stopActiveStream()
      if (!dependencies.isViewLeaseCurrent(viewLease)) {
        return
      }

      const persistedState = dependencies.readPersistedState()
      const persistedThreadId = dependencies.applyPersistedStateSnapshot(persistedState)

      if (!persistedThreadId) {
        dependencies.resetState()
        return
      }

      const thread = await dependencies.getThread(persistedThreadId)
      if (!dependencies.isThreadLeaseCurrent(viewLease, persistedThreadId)) {
        return
      }
      await dependencies.loadThread(thread, viewLease)

      const activeRunId = dependencies.getRunId()
      if (!activeRunId) {
        dependencies.resetRunState()
        return
      }

      const persistedRun = await dependencies.getRun(activeRunId)
      if (!dependencies.isThreadLeaseCurrent(viewLease, persistedThreadId)) {
        return
      }
      const run = await dependencies.resolveHydratedRun(persistedRun, persistedThreadId, viewLease)
      if (!dependencies.isThreadLeaseCurrent(viewLease, persistedThreadId)) {
        return
      }

      dependencies.bindActiveRun(run.id)
      dependencies.setRunStatus(run.status)
      dependencies.setIsWaiting(run.status === 'waiting')
      dependencies.setIsStreaming(run.status === 'running' || run.status === 'pending')
      dependencies.hydratePendingWaitState(run)

      if (dependencies.isTerminalRunStatus(run.status)) {
        const didHydrateSnapshot = dependencies.hydrateAssistantTranscriptFromRunSnapshot(run)
        if (!didHydrateSnapshot) {
          dependencies.restorePersistedRunTranscript(
            dependencies.getPersistedRunTranscript(persistedState),
          )
        }
        dependencies.primeRunReplayGuardFromSnapshot(run)
        dependencies.finalizeRun(run.status, dependencies.finishReasonForRunStatus(run.status), {
          runId: run.id,
        })

        const activeThreadId = dependencies.getThreadId()
        if (activeThreadId) {
          await dependencies.refreshThreadMessages(activeThreadId, viewLease).catch((error) => {
            if (dependencies.isViewLeaseCurrent(viewLease)) {
              dependencies.setError(
                dependencies.toDisplayError(error, 'Failed to refresh thread messages.'),
              )
            }
          })
        }
        if (!dependencies.getIsWaiting() && dependencies.isViewLeaseCurrent(viewLease)) {
          dependencies.releaseLiveAssistantAfterTerminal(run.id)
        }
        return
      }

      const didHydrateSnapshot = dependencies.hydrateAssistantTranscriptFromRunSnapshot(run)

      if (run.status === 'waiting') {
        if (!didHydrateSnapshot) {
          dependencies.restorePersistedRunTranscript(
            dependencies.getPersistedRunTranscript(persistedState),
          )
        }
        dependencies.primeRunReplayGuardFromSnapshot(run)
        const preferredMessageId =
          dependencies.resolveTranscriptProjectionMessageId(run.id) ?? undefined
        const transcript = dependencies.ensureRunTranscript(run.id, run.updatedAt, {
          ...(preferredMessageId ? { preferredMessageId } : {}),
          source: 'durableSnapshot',
        })
        transcript.status = 'waiting'
        transcript.finishReason = 'waiting'
        dependencies.syncLiveAssistantProjectionFromTranscript(run.id, run.updatedAt, {
          ...(preferredMessageId ? { preferredId: preferredMessageId } : {}),
        })
        dependencies.ensurePendingWaitBlocks(run.updatedAt)
        dependencies.scheduleRunReconciliation(
          run.id,
          viewLease,
          dependencies.captureRunLease(run.id),
        )
        void dependencies.connectThreadEventStream(persistedThreadId, viewLease).catch((error) => {
          if (dependencies.isViewLeaseCurrent(viewLease)) {
            dependencies.setError(
              dependencies.toDisplayError(error, 'Failed to connect to the event stream.'),
            )
          }
        })
        return
      }

      if (run.status === 'running' || run.status === 'pending') {
        await dependencies.bootstrapActiveRunTranscriptFromBackend(
          run,
          viewLease,
          dependencies.captureRunLease(run.id),
        )
        if (!dependencies.isThreadLeaseCurrent(viewLease, persistedThreadId)) {
          return
        }

        const currentRunStatus = dependencies.getRunStatus()
        if (currentRunStatus && dependencies.isTerminalRunStatus(currentRunStatus)) {
          const activeThreadId = dependencies.getThreadId()
          if (activeThreadId) {
            await dependencies.refreshThreadMessages(activeThreadId, viewLease).catch((error) => {
              if (dependencies.isViewLeaseCurrent(viewLease)) {
                dependencies.setError(
                  dependencies.toDisplayError(error, 'Failed to refresh thread messages.'),
                )
              }
            })
          }
          if (!dependencies.getIsWaiting() && dependencies.isViewLeaseCurrent(viewLease)) {
            dependencies.releaseLiveAssistantAfterTerminal(run.id)
          }
          return
        }
      }

      dependencies.scheduleRunReconciliation(
        run.id,
        viewLease,
        dependencies.captureRunLease(run.id),
      )
      const streamPromise = dependencies.connectThreadEventStream(persistedThreadId, viewLease)
      await dependencies.awaitStreamOutcome(
        streamPromise,
        run.id,
        viewLease,
        dependencies.captureRunLease(run.id),
      )
    } catch (error) {
      if (dependencies.isViewLeaseCurrent(viewLease)) {
        dependencies.setError(
          dependencies.toDisplayError(error, 'Failed to load the conversation.'),
        )
      }
    }
  }

  return {
    hydrate,
  }
}
