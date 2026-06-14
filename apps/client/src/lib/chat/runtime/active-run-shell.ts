import type { MessageAttachment, MessageId, RunId } from '@wonderlands/contracts/chat'
import { asMessageId } from '@wonderlands/contracts/chat'
import type { UiMessage } from '../types'

interface ActiveRunShellDependencies {
  bumpRunEpoch: () => void
  clearActiveSubmit: () => void
  clearActiveTransport: () => void
  clearLocalAttachments: () => void
  clearPendingWaits: () => void
  clearRenderedMessageCaches: () => void
  clearResolvingWaits: () => void
  clearRunReconcileTimer: () => void
  clearRunReplayGuard: () => void
  clearRunTranscripts: () => void
  clearTypewriterPlaybackAll: () => void
  defaultTitle: string
  getIsWaiting: () => boolean
  getLiveAssistantLane: () => {
    ensureLiveAssistantMessage: (createdAt: string, expectedRunId?: RunId | null) => UiMessage
    ensureStreamingAssistantShell: (createdAt: string) => void
    getLiveAssistantMessageId: () => MessageId
    prepareFreshLiveAssistantLane: () => void
    primeLiveAssistantMessageId: () => MessageId
    pruneLiveAssistantAfterThreadRefresh: () => void
    releaseLiveAssistantAfterTerminal: (endedRunId: RunId) => void
    removeLiveAssistantMessage: () => void
  } | null
  getLiveAssistantMessage: () => UiMessage | null
  getLiveAssistantMessageIdState: () => MessageId | null
  getNow: () => number
  getRandomUUID: () => string
  getRunId: () => RunId | null
  setContextBudget: (budget: null) => void
  setError: (message: string | null) => void
  setEventCursor: (cursor: number) => void
  setIsCancelling: (value: boolean) => void
  setIsLoading: (value: boolean) => void
  setIsReconnecting: (value: boolean) => void
  setIsResolvingWait: (value: boolean) => void
  setIsStreaming: (value: boolean) => void
  setIsThreadNaming: (value: boolean) => void
  setIsWaiting: (value: boolean) => void
  setLiveAssistantMessage: (message: UiMessage | null) => void
  setLiveAssistantMessageIdState: (messageId: MessageId | null) => void
  setMemoryActivity: (value: 'idle') => void
  setMessageEditDraft: (draft: null) => void
  setOptimisticMessages: (messages: UiMessage[]) => void
  setPendingOptimisticOwnership: (
    messageId: MessageId | null,
    owner: { submitId: number; viewEpoch: number } | null,
  ) => void
  setRetainedAssistantMessages: (messages: UiMessage[]) => void
  setRunId: (runId: RunId | null) => void
  setRunStatus: (status: null) => void
  setSessionId: (sessionId: null) => void
  setStreamPulse: (pulse: number) => void
  setThreadId: (threadId: null) => void
  setThreadTitle: (title: null) => void
  setTitle: (title: string) => void
  setDurableMessages: (messages: UiMessage[]) => void
  syncProjectedMessages: (options?: { pulse?: boolean }) => void
  syncProjectedMessagesIfLiveAssistantProjected: (options?: { pulse?: boolean }) => void
  setLastTerminalRunId: (runId: RunId | null) => void
}

export const createActiveRunShellCoordinator = ({
  bumpRunEpoch,
  clearActiveSubmit,
  clearActiveTransport,
  clearLocalAttachments,
  clearPendingWaits,
  clearRenderedMessageCaches,
  clearResolvingWaits,
  clearRunReconcileTimer,
  clearRunReplayGuard,
  clearRunTranscripts,
  clearTypewriterPlaybackAll,
  defaultTitle,
  getIsWaiting,
  getLiveAssistantLane,
  getLiveAssistantMessage,
  getLiveAssistantMessageIdState,
  getNow,
  getRandomUUID,
  getRunId,
  setContextBudget,
  setDurableMessages,
  setError,
  setEventCursor,
  setIsCancelling,
  setIsLoading,
  setIsReconnecting,
  setIsResolvingWait,
  setIsStreaming,
  setIsThreadNaming,
  setIsWaiting,
  setLastTerminalRunId,
  setLiveAssistantMessage,
  setLiveAssistantMessageIdState,
  setMemoryActivity,
  setMessageEditDraft,
  setOptimisticMessages,
  setPendingOptimisticOwnership,
  setRetainedAssistantMessages,
  setRunId,
  setRunStatus,
  setSessionId,
  setStreamPulse,
  setThreadId,
  setThreadTitle,
  setTitle,
  syncProjectedMessages,
  syncProjectedMessagesIfLiveAssistantProjected,
}: ActiveRunShellDependencies) => {
  const setActiveRunId = (runId: RunId | null) => {
    if (getRunId() === runId) {
      return
    }

    setRunId(runId)
    bumpRunEpoch()
    if (runId !== null) {
      setLastTerminalRunId(null)
    }
  }

  const bindActiveRun = (runId: RunId | null) => {
    if (!runId) {
      return
    }

    setActiveRunId(runId)

    const liveAssistantMessage = getLiveAssistantMessage()
    if (liveAssistantMessage && liveAssistantMessage.runId == null) {
      liveAssistantMessage.runId = runId
      syncProjectedMessagesIfLiveAssistantProjected()
    }
  }

  const resetRunState = () => {
    clearRunReconcileTimer()
    setIsCancelling(false)
    setIsReconnecting(false)
    setIsResolvingWait(false)
    clearResolvingWaits()
    setIsStreaming(false)
    setIsWaiting(false)
    setActiveRunId(null)
    setLastTerminalRunId(null)
    clearRunReplayGuard()
    setRunStatus(null)
    clearPendingWaits()
  }

  const resetState = () => {
    clearActiveTransport()
    clearTypewriterPlaybackAll()
    setLiveAssistantMessageIdState(null)
    setLiveAssistantMessage(null)
    setPendingOptimisticOwnership(null, null)
    clearActiveSubmit()
    clearRenderedMessageCaches()
    clearLocalAttachments()
    clearRunTranscripts()
    setRetainedAssistantMessages([])
    setEventCursor(0)
    setError(null)
    setIsLoading(false)
    setIsThreadNaming(false)
    setContextBudget(null)
    setMemoryActivity('idle')
    setMessageEditDraft(null)
    resetRunState()
    setDurableMessages([])
    setOptimisticMessages([])
    syncProjectedMessages()
    setSessionId(null)
    setStreamPulse(getNow())
    setThreadTitle(null)
    setThreadId(null)
    setTitle(defaultTitle)
  }

  const getLiveAssistantMessageId = (): MessageId =>
    getLiveAssistantLane()?.getLiveAssistantMessageId() ??
    getLiveAssistantMessageIdState() ??
    asMessageId(`live:${getRunId() ?? 'pending'}`)

  const primeLiveAssistantMessageId = (): MessageId =>
    getLiveAssistantLane()?.primeLiveAssistantMessageId() ?? asMessageId(`live:${getRandomUUID()}`)

  const ensureLiveAssistantMessage = (
    createdAt: string,
    expectedRunId: RunId | null = getRunId(),
  ): UiMessage =>
    getLiveAssistantLane()?.ensureLiveAssistantMessage(createdAt, expectedRunId) ??
    ({
      id: getLiveAssistantMessageId(),
      uiKey: getLiveAssistantMessageId(),
      role: 'assistant',
      status: getIsWaiting() ? 'waiting' : 'streaming',
      createdAt,
      text: '',
      attachments: [] as MessageAttachment[],
      blocks: [],
      finishReason: null,
      runId: expectedRunId,
      sequence: null,
    } as UiMessage)

  const prepareFreshLiveAssistantLane = () => {
    getLiveAssistantLane()?.prepareFreshLiveAssistantLane()
  }

  const ensureStreamingAssistantShell = (createdAt: string) => {
    getLiveAssistantLane()?.ensureStreamingAssistantShell(createdAt)
  }

  const removeLiveAssistantMessage = () => {
    getLiveAssistantLane()?.removeLiveAssistantMessage()
  }

  const releaseLiveAssistantAfterTerminal = (endedRunId: RunId) => {
    getLiveAssistantLane()?.releaseLiveAssistantAfterTerminal(endedRunId)
  }

  const pruneLiveAssistantAfterThreadRefresh = () => {
    getLiveAssistantLane()?.pruneLiveAssistantAfterThreadRefresh()
  }

  return {
    bindActiveRun,
    ensureLiveAssistantMessage,
    ensureStreamingAssistantShell,
    getLiveAssistantMessageId,
    prepareFreshLiveAssistantLane,
    primeLiveAssistantMessageId,
    pruneLiveAssistantAfterThreadRefresh,
    releaseLiveAssistantAfterTerminal,
    removeLiveAssistantMessage,
    resetRunState,
    resetState,
    setActiveRunId,
  }
}
