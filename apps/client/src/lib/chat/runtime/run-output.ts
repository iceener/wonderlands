import type {
  AcceptedThreadInteractionOutput,
  BackendPendingWait,
  BackendRun,
  MessageFinishReason,
  ResumeRunOutput,
  RunId,
  StartThreadInteractionOutput,
  ThreadId,
} from '@wonderlands/contracts/chat'

interface RunOutputCoordinatorDependencies {
  bindActiveRun: (runId: RunId) => void
  clearPendingWaits: () => void
  ensurePendingWaitBlocks: (createdAt: string) => void
  ensureStreamingAssistantShell: (createdAt: string) => void
  finalizeRun: (
    status: BackendRun['status'],
    finishReason: MessageFinishReason | null,
    options?: { runId?: RunId | null },
  ) => void
  getRunId: () => RunId | null
  getRunStatus: () => BackendRun['status'] | null
  getThreadId: () => ThreadId | null
  hasActiveStream: () => boolean
  isTerminalRunStatus: (
    status: BackendRun['status'] | null,
  ) => status is 'completed' | 'failed' | 'cancelled'
  mergePendingWaitsForRun: (
    waits: BackendPendingWait[],
    ownerRunId?: RunId | string | null,
  ) => BackendPendingWait[]
  nowIso: () => string
  persistState: () => void
  refreshThreadBudget: (threadId: ThreadId) => Promise<void>
  scheduleCompletedResponseSettle: (runId: RunId, delayMs?: number) => void
  scheduleRunReconciliation: (runId: RunId) => void
  setIsStreaming: (value: boolean) => void
  setIsWaiting: (value: boolean) => void
  setPendingWaits: (waits: BackendPendingWait[], ownerRunId?: RunId | string | null) => void
  setRunStatus: (status: BackendRun['status']) => void
  setSessionId: (sessionId: AcceptedThreadInteractionOutput['sessionId']) => void
  setThreadId: (threadId: ThreadId) => void
  threadStreamAbort: () => void
  durableHasAssistantForRun: (runId: RunId | null) => boolean
}

export const createRunOutputCoordinator = ({
  bindActiveRun,
  clearPendingWaits,
  durableHasAssistantForRun,
  ensurePendingWaitBlocks,
  ensureStreamingAssistantShell,
  finalizeRun,
  getRunId,
  getRunStatus,
  getThreadId,
  hasActiveStream,
  isTerminalRunStatus,
  mergePendingWaitsForRun,
  nowIso,
  persistState,
  refreshThreadBudget,
  scheduleCompletedResponseSettle,
  scheduleRunReconciliation,
  setIsStreaming,
  setIsWaiting,
  setPendingWaits,
  setRunStatus,
  setSessionId,
  setThreadId,
  threadStreamAbort,
}: RunOutputCoordinatorDependencies) => {
  const applyAcceptedResumeRunOutput = (
    output: AcceptedThreadInteractionOutput | Extract<ResumeRunOutput, { status: 'accepted' }>,
  ) => {
    if (isTerminalRunStatus(getRunStatus()) && getRunId() === null) {
      return
    }

    bindActiveRun(output.runId)
    setRunStatus('running')
    setIsStreaming(true)
    setIsWaiting(false)
    ensureStreamingAssistantShell(nowIso())
    scheduleRunReconciliation(output.runId)
    persistState()
  }

  const applyRunExecutionOutput = (
    output: {
      pendingWaits?: BackendPendingWait[]
      runId: RunId
      status: 'completed' | 'waiting'
    },
    options: {
      settleDelayMs?: number
    } = {},
  ) => {
    if (isTerminalRunStatus(getRunStatus()) && getRunId() === null) {
      return
    }

    bindActiveRun(output.runId)
    setRunStatus(output.status)
    setIsStreaming(false)
    setIsWaiting(output.status === 'waiting')

    if (output.status === 'waiting') {
      setPendingWaits(mergePendingWaitsForRun(output.pendingWaits ?? [], output.runId))
      ensurePendingWaitBlocks(output.pendingWaits?.[0]?.createdAt ?? nowIso())
      scheduleRunReconciliation(output.runId)
      persistState()
      const threadId = getThreadId()
      if (threadId) {
        void refreshThreadBudget(threadId).catch(() => undefined)
      }
      return
    }

    clearPendingWaits()

    if (hasActiveStream()) {
      bindActiveRun(output.runId)
      setRunStatus('running')
      setIsStreaming(true)
      setIsWaiting(false)
      ensureStreamingAssistantShell(nowIso())
      scheduleRunReconciliation(output.runId)
      persistState()
      scheduleCompletedResponseSettle(output.runId, options.settleDelayMs)
      return
    }

    finalizeRun('completed', 'stop', { runId: output.runId })
    threadStreamAbort()
  }

  const applyResumeRunOutput = (output: ResumeRunOutput) => {
    if (output.status === 'accepted') {
      applyAcceptedResumeRunOutput(output)
      return
    }

    applyRunExecutionOutput(output)
  }

  const applyThreadInteractionStart = (output: StartThreadInteractionOutput) => {
    if (output.status === 'accepted') {
      if (isTerminalRunStatus(getRunStatus()) && getRunId() === null) {
        return
      }

      setSessionId(output.sessionId)
      setThreadId(output.threadId)

      if (getRunId() === output.runId && getRunStatus() && getRunStatus() !== 'pending') {
        return
      }

      bindActiveRun(output.runId)
      setRunStatus('pending')
      setIsStreaming(true)
      setIsWaiting(false)
      scheduleRunReconciliation(output.runId)
      persistState()
      return
    }

    setSessionId(output.sessionId)

    if (output.status === 'completed' && durableHasAssistantForRun(output.runId)) {
      return
    }

    applyRunExecutionOutput(output)
  }

  return {
    applyResumeRunOutput,
    applyRunExecutionOutput,
    applyThreadInteractionStart,
  }
}
