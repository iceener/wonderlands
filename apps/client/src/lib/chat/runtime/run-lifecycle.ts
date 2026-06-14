import type {
  BackendRun,
  Block,
  MessageAttachment,
  MessageFinishReason,
  MessageId,
  RunId,
  ThreadId,
} from '@wonderlands/contracts/chat'
import type { RunTranscriptState, UiMessage } from '../types'
import type { RunLease, ViewLease } from './leases'

interface RunLifecycleDependencies {
  captureRunLease: (runId: RunId | null) => RunLease
  captureViewLease: () => ViewLease
  clearRunReplayGuard: (runId?: RunId | null) => void
  ensurePendingWaitBlocks: (createdAt: string) => void
  ensureRunTranscript: (
    runId: RunId,
    createdAt: string,
    options: {
      preferredMessageId?: MessageId
      source: 'durableSnapshot' | 'liveStream'
    },
  ) => RunTranscriptState
  extractSandboxOutputAttachments: (blocks: readonly Block[]) => MessageAttachment[]
  getChatStoreDebugSnapshot: () => unknown
  getRunTranscript: (runId: RunId) => RunTranscriptState | null
  getLiveAssistantMessage: () => UiMessage | null
  getRun: (runId: RunId) => Promise<BackendRun>
  getRunId: () => RunId | null
  getRunStatus: () => BackendRun['status'] | null
  getThreadId: () => ThreadId | null
  hydrateAssistantTranscriptFromRunSnapshot: (run: BackendRun) => boolean
  hydratePendingWaitState: (run: BackendRun) => void
  isRunLeaseCurrent: (lease: RunLease) => boolean
  isTerminalRunStatus: (
    status: BackendRun['status'] | null,
  ) => status is 'completed' | 'failed' | 'cancelled'
  isViewLeaseCurrent: (lease: ViewLease) => boolean
  logDebug: (scope: string, event: string, payload: unknown) => void
  mergeAttachments: (
    existing: MessageAttachment[],
    incoming: MessageAttachment[],
  ) => MessageAttachment[]
  nowIso: () => string
  persistState: () => void
  primeRunReplayGuardFromSnapshot: (run: BackendRun) => void
  refreshThreadBudget: (threadId: ThreadId, lease?: ViewLease) => Promise<void>
  refreshThreadMessages: (threadId: ThreadId, lease?: ViewLease) => Promise<void>
  releaseLiveAssistantAfterTerminal: (runId: RunId) => void
  resolveTranscriptProjectionMessageId: (runId: RunId) => MessageId
  runReconcileDelayMs: number
  setActiveRunId: (runId: RunId | null) => void
  setError: (message: string | null) => void
  setIsCancelling: (value: boolean) => void
  setIsResolvingWait: (value: boolean) => void
  setIsStreaming: (value: boolean) => void
  setIsWaiting: (value: boolean) => void
  setLastTerminalRunId: (runId: RunId | null) => void
  setRunStatus: (status: BackendRun['status']) => void
  settleBlocksForRunTerminalState: (
    blocks: Block[],
    input: {
      createdAt: string
      runId: string | null
      status: 'completed' | 'failed' | 'cancelled' | 'waiting'
    },
  ) => void
  syncLiveAssistantProjectionFromTranscript: (
    runId: RunId,
    createdAt: string,
    input?: { preferredId?: MessageId },
  ) => UiMessage | null
  syncProjectedMessages: () => void
  threadStreamAbort: () => void
  toDisplayError: (error: unknown, fallback: string) => string
  rememberRunTranscriptFromMessage: (message: UiMessage, source: 'liveStream') => void
  updateLiveAssistantMessage: (updater: (message: UiMessage) => void) => void
  bindActiveRun: (runId: RunId) => void
  clearPendingWaits: () => void
}

export const finishReasonForRunStatus = (
  status: BackendRun['status'],
): MessageFinishReason | null => {
  switch (status) {
    case 'waiting':
      return 'waiting'
    case 'failed':
      return 'error'
    case 'cancelled':
      return 'cancelled'
    case 'completed':
      return 'stop'
    default:
      return null
  }
}

export const createRunLifecycleCoordinator = (dependencies: RunLifecycleDependencies) => {
  let activeCompletedResponseTimer: ReturnType<typeof setTimeout> | null = null
  let activeRunReconcileTimer: ReturnType<typeof setTimeout> | null = null

  const clearCompletedResponseSettle = () => {
    if (activeCompletedResponseTimer) {
      clearTimeout(activeCompletedResponseTimer)
      activeCompletedResponseTimer = null
    }
  }

  const clearRunReconcileTimer = () => {
    if (activeRunReconcileTimer) {
      clearTimeout(activeRunReconcileTimer)
      activeRunReconcileTimer = null
    }
  }

  const finalizeRun = (
    status: BackendRun['status'],
    finishReason: MessageFinishReason | null,
    options: { runId?: RunId | null } = {},
  ) => {
    const finalizedRunId = options.runId ?? dependencies.getRunId()
    if (finalizedRunId && dependencies.getRunId() && finalizedRunId !== dependencies.getRunId()) {
      dependencies.logDebug('store', 'finalizeRun:ignoredForeignRun', {
        finalizedRunId,
        stateRunId: dependencies.getRunId(),
        status,
      })
      return
    }

    dependencies.logDebug('store', 'finalizeRun:start', {
      finishReason,
      liveAssistantMessage: dependencies.getLiveAssistantMessage(),
      runId: dependencies.getRunId(),
      runStatus: dependencies.getRunStatus(),
      status,
    })

    clearCompletedResponseSettle()

    dependencies.setRunStatus(status)
    dependencies.setIsStreaming(false)
    dependencies.setIsWaiting(status === 'waiting')
    dependencies.setIsResolvingWait(false)
    if (status !== 'waiting') {
      dependencies.clearPendingWaits()
    }

    const liveAssistantMessage = dependencies.getLiveAssistantMessage()
    const transcriptRunId =
      finalizedRunId ??
      (liveAssistantMessage?.role === 'assistant' && liveAssistantMessage.runId != null
        ? liveAssistantMessage.runId
        : null)
    const transcript =
      transcriptRunId != null ? dependencies.getRunTranscript(transcriptRunId) : null

    if (transcript && transcriptRunId != null) {
      if (
        status === 'cancelled' ||
        status === 'completed' ||
        status === 'failed' ||
        status === 'waiting'
      ) {
        dependencies.settleBlocksForRunTerminalState(transcript.blocks, {
          createdAt: dependencies.nowIso(),
          runId: String(transcriptRunId),
          status,
        })
      }
      transcript.attachments = dependencies.mergeAttachments(
        transcript.attachments,
        dependencies.extractSandboxOutputAttachments(transcript.blocks),
      )
      transcript.finishReason = finishReason
      transcript.status =
        status === 'failed' ? 'error' : status === 'waiting' ? 'waiting' : 'complete'
      dependencies.syncLiveAssistantProjectionFromTranscript(transcriptRunId, transcript.createdAt)
      dependencies.syncProjectedMessages()
    } else if (liveAssistantMessage) {
      dependencies.updateLiveAssistantMessage((message) => {
        if (
          finalizedRunId &&
          (status === 'cancelled' ||
            status === 'completed' ||
            status === 'failed' ||
            status === 'waiting')
        ) {
          dependencies.settleBlocksForRunTerminalState(message.blocks, {
            createdAt: dependencies.nowIso(),
            runId: String(finalizedRunId),
            status,
          })
        }
        message.finishReason = finishReason
        message.status =
          status === 'failed' ? 'error' : status === 'waiting' ? 'waiting' : 'complete'
        dependencies.rememberRunTranscriptFromMessage(message, 'liveStream')
      })
      dependencies.syncProjectedMessages()
    }

    if (dependencies.isTerminalRunStatus(status)) {
      clearRunReconcileTimer()
      dependencies.clearRunReplayGuard(finalizedRunId ?? null)
      if (finalizedRunId != null) {
        dependencies.setLastTerminalRunId(finalizedRunId)
      } else if (dependencies.getRunId() != null) {
        dependencies.setLastTerminalRunId(dependencies.getRunId())
      }
      if (finalizedRunId == null || dependencies.getRunId() === finalizedRunId) {
        dependencies.setActiveRunId(null)
      }
      dependencies.persistState()
    } else {
      dependencies.persistState()
      if (status === 'waiting' && dependencies.getRunId()) {
        scheduleRunReconciliation(
          dependencies.getRunId()!,
          dependencies.captureViewLease(),
          dependencies.captureRunLease(dependencies.getRunId()!),
        )
      }
    }

    if ((status === 'completed' || status === 'waiting') && dependencies.getThreadId()) {
      void dependencies.refreshThreadBudget(dependencies.getThreadId()!).catch(() => undefined)
    }

    dependencies.logDebug('store', 'finalizeRun:end', dependencies.getChatStoreDebugSnapshot())
  }

  const syncRunStateFromBackend = async (
    run: BackendRun,
    viewLease: ViewLease,
    runLease: RunLease,
  ) => {
    if (!dependencies.isViewLeaseCurrent(viewLease) || !dependencies.isRunLeaseCurrent(runLease)) {
      return run
    }

    dependencies.setError(null)
    dependencies.bindActiveRun(run.id)
    dependencies.setRunStatus(run.status)
    dependencies.setIsCancelling(false)
    dependencies.setIsResolvingWait(false)
    dependencies.setIsWaiting(run.status === 'waiting')
    dependencies.setIsStreaming(run.status === 'running' || run.status === 'pending')
    dependencies.hydratePendingWaitState(run)
    const didHydrate = dependencies.hydrateAssistantTranscriptFromRunSnapshot(run)
    if (didHydrate || dependencies.isTerminalRunStatus(run.status)) {
      dependencies.primeRunReplayGuardFromSnapshot(run)
    }

    if (dependencies.isTerminalRunStatus(run.status)) {
      finalizeRun(run.status, finishReasonForRunStatus(run.status), { runId: run.id })
      if (dependencies.getThreadId()) {
        await dependencies
          .refreshThreadMessages(dependencies.getThreadId()!, viewLease)
          .catch((error) => {
            if (dependencies.isViewLeaseCurrent(viewLease)) {
              dependencies.setError(
                dependencies.toDisplayError(error, 'Failed to refresh thread messages.'),
              )
            }
          })
      }
      if (!dependencies.getRunStatus() || !dependencies.isViewLeaseCurrent(viewLease)) {
        return run
      }
      dependencies.releaseLiveAssistantAfterTerminal(run.id)
      return run
    }

    dependencies.persistState()

    if (run.status === 'waiting') {
      const transcript = dependencies.ensureRunTranscript(run.id, run.updatedAt, {
        preferredMessageId: dependencies.resolveTranscriptProjectionMessageId(run.id),
        source: 'durableSnapshot',
      })
      transcript.status = 'waiting'
      transcript.finishReason = 'waiting'
      dependencies.syncLiveAssistantProjectionFromTranscript(run.id, run.updatedAt, {
        preferredId: dependencies.resolveTranscriptProjectionMessageId(run.id),
      })
      dependencies.ensurePendingWaitBlocks(run.updatedAt)
    } else if (run.status === 'running' || run.status === 'pending') {
      const transcript = dependencies.ensureRunTranscript(run.id, run.updatedAt, {
        preferredMessageId: dependencies.resolveTranscriptProjectionMessageId(run.id),
        source: 'liveStream',
      })
      transcript.status = 'streaming'
      transcript.finishReason = null
      dependencies.syncLiveAssistantProjectionFromTranscript(run.id, run.updatedAt, {
        preferredId: dependencies.resolveTranscriptProjectionMessageId(run.id),
      })
      dependencies.syncProjectedMessages()
    }

    scheduleRunReconciliation(run.id, viewLease, runLease)
    return run
  }

  const reconcileRunState = async (runId: RunId, viewLease: ViewLease, runLease: RunLease) => {
    const run = await dependencies.getRun(runId)
    if (!dependencies.isViewLeaseCurrent(viewLease) || !dependencies.isRunLeaseCurrent(runLease)) {
      return run
    }

    return syncRunStateFromBackend(run, viewLease, runLease)
  }

  const reconcileFailedRunState = (runId: RunId | null) => {
    if (!runId) {
      return
    }

    void reconcileRunState(
      runId as RunId,
      dependencies.captureViewLease(),
      dependencies.captureRunLease(runId),
    ).catch((error) => {
      dependencies.setError(dependencies.toDisplayError(error, 'Failed to reconcile run state.'))
    })
  }

  const scheduleRunReconciliation = (runId: RunId, viewLease: ViewLease, runLease: RunLease) => {
    clearRunReconcileTimer()
    activeRunReconcileTimer = setTimeout(() => {
      activeRunReconcileTimer = null

      if (
        !dependencies.isViewLeaseCurrent(viewLease) ||
        !dependencies.isRunLeaseCurrent(runLease) ||
        dependencies.isTerminalRunStatus(dependencies.getRunStatus())
      ) {
        return
      }

      void reconcileRunState(runId, viewLease, runLease).catch(() => {
        if (
          !dependencies.isViewLeaseCurrent(viewLease) ||
          !dependencies.isRunLeaseCurrent(runLease) ||
          dependencies.isTerminalRunStatus(dependencies.getRunStatus())
        ) {
          return
        }

        scheduleRunReconciliation(runId, viewLease, runLease)
      })
    }, dependencies.runReconcileDelayMs)
  }

  const scheduleCompletedResponseSettle = (runId: RunId, delayMs: number) => {
    clearCompletedResponseSettle()

    activeCompletedResponseTimer = setTimeout(() => {
      activeCompletedResponseTimer = null

      if (
        dependencies.getRunId() !== runId ||
        dependencies.isTerminalRunStatus(dependencies.getRunStatus())
      ) {
        return
      }

      finalizeRun('completed', 'stop', { runId })
      dependencies.threadStreamAbort()
    }, delayMs)
  }

  return {
    clearCompletedResponseSettle,
    clearRunReconcileTimer,
    finalizeRun,
    reconcileFailedRunState,
    reconcileRunState,
    scheduleCompletedResponseSettle,
    scheduleRunReconciliation,
    syncRunStateFromBackend,
  }
}
