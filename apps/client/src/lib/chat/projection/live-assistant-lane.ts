import type {
  Block,
  MessageAttachment,
  MessageId,
  MessageStatus,
  RunId,
} from '@wonderlands/contracts/chat'
import { asMessageId } from '@wonderlands/contracts/chat'
import type { RunTranscriptSources, RunTranscriptState, UiMessage } from '../types'

interface LiveAssistantLaneDependencies {
  clearTypewriterPlaybackForMessage: (message: UiMessage | null | undefined) => void
  cloneAttachments: (attachments: MessageAttachment[]) => MessageAttachment[]
  cloneBlocks: (blocks: Block[]) => Block[]
  cloneUiMessage: (message: UiMessage) => UiMessage
  durableHasAssistantForRun: (runId: RunId | null) => boolean
  ensureRunTranscript: (
    runId: RunId,
    createdAt: string,
    options?: {
      preferredMessageId?: MessageId
      source?: keyof RunTranscriptSources
      status?: MessageStatus
    },
  ) => RunTranscriptState
  getActiveRunId: () => RunId | null
  getIsWaiting: () => boolean
  getLiveAssistantMessage: () => UiMessage | null
  getLiveAssistantMessageIdState: () => MessageId | null
  getMessageIndexById: (messageId: MessageId) => number | undefined
  getRetainedAssistantMessages: () => UiMessage[]
  getRunTranscript: (runId: RunId) => RunTranscriptState | null
  hasKeepWorthyMessageContent: (
    message: Pick<UiMessage, 'blocks' | 'finishReason' | 'text'> | null | undefined,
  ) => boolean
  logDebug: (scope: string, event: string, payload: unknown) => void
  projectAssistantMessageFromRunTranscript: (message: UiMessage) => UiMessage
  randomUUID: () => string
  rebuildToolIndexForMessage: (message: Pick<UiMessage, 'blocks' | 'id'>) => void
  rememberStableUiKey: (messageId: MessageId, uiKey: string) => void
  setLiveAssistantMessage: (message: UiMessage | null) => void
  setLiveAssistantMessageIdState: (messageId: MessageId | null) => void
  setRetainedAssistantMessages: (messages: UiMessage[]) => void
  setStreamPulse: () => void
  summarizeMessage: (message: UiMessage) => unknown
  syncProjectedMessages: (options?: { pulse?: boolean }) => void
  syncProjectedMessagesIfLiveAssistantProjected: (options?: { pulse?: boolean }) => void
  withStableUiKey: (message: UiMessage) => UiMessage
}

export const createLiveAssistantLaneCoordinator = ({
  clearTypewriterPlaybackForMessage,
  cloneAttachments,
  cloneBlocks,
  cloneUiMessage,
  durableHasAssistantForRun,
  ensureRunTranscript,
  getActiveRunId,
  getIsWaiting,
  getLiveAssistantMessage,
  getLiveAssistantMessageIdState,
  getMessageIndexById,
  getRetainedAssistantMessages,
  getRunTranscript,
  hasKeepWorthyMessageContent,
  logDebug,
  projectAssistantMessageFromRunTranscript,
  randomUUID,
  rebuildToolIndexForMessage,
  rememberStableUiKey,
  setLiveAssistantMessage,
  setLiveAssistantMessageIdState,
  setRetainedAssistantMessages,
  setStreamPulse,
  summarizeMessage,
  syncProjectedMessages,
  syncProjectedMessagesIfLiveAssistantProjected,
  withStableUiKey,
}: LiveAssistantLaneDependencies) => {
  const getLiveAssistantMessageId = (): MessageId =>
    getLiveAssistantMessageIdState() ?? asMessageId(`live:${getActiveRunId() ?? 'pending'}`)

  const resolveTranscriptProjectionMessageId = (runId: RunId): MessageId => {
    const liveAssistantMessage = getLiveAssistantMessage()
    return liveAssistantMessage?.runId === runId
      ? liveAssistantMessage.id
      : (getLiveAssistantMessageIdState() ?? asMessageId(`live:${String(runId)}`))
  }

  const retainAssistantMessage = (message: UiMessage | null | undefined): boolean => {
    if (!message || message.role !== 'assistant' || message.runId == null) {
      return false
    }

    if (durableHasAssistantForRun(message.runId)) {
      return false
    }

    const projected = withStableUiKey(
      projectAssistantMessageFromRunTranscript(cloneUiMessage(message)),
    )
    if (!hasKeepWorthyMessageContent(projected)) {
      return false
    }

    const retainedAssistantMessages = getRetainedAssistantMessages()
    const retainedIndex = retainedAssistantMessages.findIndex(
      (entry) => entry.runId === projected.runId || entry.id === projected.id,
    )

    if (retainedIndex >= 0) {
      retainedAssistantMessages[retainedIndex] = projected
      setRetainedAssistantMessages([...retainedAssistantMessages])
    } else {
      setRetainedAssistantMessages([...retainedAssistantMessages, projected])
    }

    rememberStableUiKey(projected.id, projected.uiKey ?? projected.id)
    return true
  }

  const retainLiveAssistantForProjectionHandoff = (): boolean =>
    retainAssistantMessage(getLiveAssistantMessage())

  const syncLiveAssistantProjectionFromTranscript = (
    runId: RunId,
    createdAt: string,
    options: { preferredId?: MessageId } = {},
  ): UiMessage | null => {
    const transcript = getRunTranscript(runId)
    if (!transcript) {
      return null
    }

    let liveAssistantMessage = getLiveAssistantMessage()
    if (liveAssistantMessage?.runId && liveAssistantMessage.runId !== runId) {
      retainLiveAssistantForProjectionHandoff()
      setLiveAssistantMessage(null)
      setLiveAssistantMessageIdState(null)
      liveAssistantMessage = null
    }

    if (!liveAssistantMessage) {
      const liveMessageId =
        options.preferredId ?? getLiveAssistantMessageIdState() ?? asMessageId(`live:${runId}`)
      setLiveAssistantMessageIdState(liveMessageId)
      liveAssistantMessage = {
        id: liveMessageId,
        uiKey: liveMessageId,
        role: 'assistant',
        status: transcript.status,
        createdAt,
        text: '',
        attachments: [],
        blocks: [],
        finishReason: transcript.finishReason,
        runId,
        sequence: transcript.sequence,
      }
      setLiveAssistantMessage(liveAssistantMessage)
    } else {
      setLiveAssistantMessageIdState(liveAssistantMessage.id)
      liveAssistantMessage.runId = runId
    }

    liveAssistantMessage.createdAt = transcript.createdAt
    liveAssistantMessage.status = transcript.status
    liveAssistantMessage.text = transcript.text
    liveAssistantMessage.attachments = cloneAttachments(transcript.attachments)
    liveAssistantMessage.blocks = cloneBlocks(transcript.blocks)
    liveAssistantMessage.finishReason = transcript.finishReason
    liveAssistantMessage.sequence = transcript.sequence
    rebuildToolIndexForMessage(liveAssistantMessage)
    return liveAssistantMessage
  }

  const primeLiveAssistantMessageId = (): MessageId => {
    const nextId = asMessageId(`live:${randomUUID()}`)
    setLiveAssistantMessageIdState(nextId)
    return nextId
  }

  const ensureLiveAssistantMessage = (
    createdAt: string,
    expectedRunId: RunId | null = getActiveRunId(),
  ): UiMessage => {
    if (expectedRunId !== null) {
      const transcriptBacked = syncLiveAssistantProjectionFromTranscript(expectedRunId, createdAt)
      if (transcriptBacked) {
        logDebug(
          'store',
          'ensureLiveAssistantMessage:fromTranscript',
          summarizeMessage(transcriptBacked),
        )
        return transcriptBacked
      }
    }

    const liveAssistantMessage = getLiveAssistantMessage()
    if (liveAssistantMessage) {
      if (expectedRunId !== null && liveAssistantMessage.runId == null) {
        liveAssistantMessage.runId = expectedRunId
        syncProjectedMessagesIfLiveAssistantProjected()
      }
      logDebug('store', 'ensureLiveAssistantMessage:reuse', summarizeMessage(liveAssistantMessage))
      return liveAssistantMessage
    }

    const liveMessageId = getLiveAssistantMessageId()
    setLiveAssistantMessageIdState(liveMessageId)

    const message: UiMessage = {
      id: liveMessageId,
      uiKey: liveMessageId,
      role: 'assistant',
      status: getIsWaiting() ? 'waiting' : 'streaming',
      createdAt,
      text: '',
      attachments: [],
      blocks: [],
      finishReason: null,
      runId: expectedRunId,
      sequence: null,
    }

    setLiveAssistantMessage(message)
    logDebug('store', 'ensureLiveAssistantMessage:create', summarizeMessage(message))
    syncProjectedMessages()
    return message
  }

  const prepareFreshLiveAssistantLane = () => {
    const liveAssistantMessage = getLiveAssistantMessage()
    if (!liveAssistantMessage) {
      return
    }

    if (
      liveAssistantMessage.role === 'assistant' &&
      liveAssistantMessage.runId != null &&
      !durableHasAssistantForRun(liveAssistantMessage.runId)
    ) {
      retainLiveAssistantForProjectionHandoff()
    }

    setLiveAssistantMessage(null)
    setLiveAssistantMessageIdState(null)
  }

  const ensureStreamingAssistantShell = (createdAt: string) => {
    const activeRunId = getActiveRunId()
    if (activeRunId != null) {
      const existingTranscript = getRunTranscript(activeRunId)
      const changed =
        !existingTranscript ||
        existingTranscript.status !== 'streaming' ||
        existingTranscript.finishReason !== null
      const transcript = ensureRunTranscript(activeRunId, createdAt, {
        preferredMessageId: resolveTranscriptProjectionMessageId(activeRunId),
        source: 'liveStream',
      })
      transcript.status = 'streaming'
      transcript.finishReason = null
      transcript.sources.liveStream = true
      syncLiveAssistantProjectionFromTranscript(activeRunId, createdAt, {
        preferredId: resolveTranscriptProjectionMessageId(activeRunId),
      })

      if (changed) {
        syncProjectedMessages()
        setStreamPulse()
      }
      return
    }

    const existingIndex = getMessageIndexById(getLiveAssistantMessageId())
    const liveMessage = ensureLiveAssistantMessage(createdAt)
    let changed = existingIndex === undefined

    if (liveMessage.status !== 'streaming') {
      liveMessage.status = 'streaming'
      changed = true
    }

    if (liveMessage.finishReason !== null) {
      liveMessage.finishReason = null
      changed = true
    }

    if (changed) {
      syncProjectedMessages()
      setStreamPulse()
    }
  }

  const removeLiveAssistantMessage = () => {
    const liveAssistantMessage = getLiveAssistantMessage()
    const liveAssistantMessageId = getLiveAssistantMessageIdState()
    if (!liveAssistantMessageId && !liveAssistantMessage) {
      return
    }

    logDebug(
      'store',
      'removeLiveAssistantMessage',
      liveAssistantMessage
        ? summarizeMessage(liveAssistantMessage)
        : { id: liveAssistantMessageId },
    )
    clearTypewriterPlaybackForMessage(liveAssistantMessage)
    setLiveAssistantMessage(null)
    setLiveAssistantMessageIdState(null)
    syncProjectedMessages()
  }

  const releaseLiveAssistantAfterTerminal = (endedRunId: RunId) => {
    if (getIsWaiting()) {
      return
    }

    const liveAssistantMessageId = getLiveAssistantMessageIdState()
    const liveId = liveAssistantMessageId ?? asMessageId(`live:${String(endedRunId)}`)
    const liveMsg = getLiveAssistantMessage()?.id === liveId ? getLiveAssistantMessage() : null

    if (!liveMsg) {
      setLiveAssistantMessageIdState(null)
      setLiveAssistantMessage(null)
      return
    }

    if (liveMsg.role !== 'assistant' || liveMsg.runId !== endedRunId) {
      setLiveAssistantMessageIdState(null)
      setLiveAssistantMessage(null)
      return
    }

    if (durableHasAssistantForRun(endedRunId)) {
      removeLiveAssistantMessage()
      return
    }

    if (hasKeepWorthyMessageContent(liveMsg)) {
      return
    }

    removeLiveAssistantMessage()
  }

  const pruneLiveAssistantAfterThreadRefresh = () => {
    if (getIsWaiting()) {
      return
    }

    const liveAssistantMessage = getLiveAssistantMessage()
    const assistantRunId =
      liveAssistantMessage?.role === 'assistant' && liveAssistantMessage.runId != null
        ? liveAssistantMessage.runId
        : null

    if (assistantRunId) {
      releaseLiveAssistantAfterTerminal(assistantRunId)
      return
    }

    removeLiveAssistantMessage()
  }

  return {
    ensureLiveAssistantMessage,
    ensureStreamingAssistantShell,
    getLiveAssistantMessageId,
    primeLiveAssistantMessageId,
    prepareFreshLiveAssistantLane,
    pruneLiveAssistantAfterThreadRefresh,
    releaseLiveAssistantAfterTerminal,
    removeLiveAssistantMessage,
    resolveTranscriptProjectionMessageId,
    syncLiveAssistantProjectionFromTranscript,
  }
}
