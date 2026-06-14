import type { BackendRun, MessageId, RunId } from '@wonderlands/contracts/chat'
import type { RunTranscriptSources, UiMessage } from '../types'
import { projectThreadMessages } from './project-thread-messages'

export const hasKeepWorthyMessageContent = (
  message: Pick<UiMessage, 'blocks' | 'finishReason' | 'text'> | null | undefined,
): boolean =>
  !!message &&
  (message.text.trim().length > 0 ||
    message.blocks.length > 0 ||
    message.finishReason === 'cancelled')

interface RenderedMessageStateDependencies {
  bumpStreamPulse: () => void
  getDurableMessages: () => UiMessage[]
  getIsStreaming: () => boolean
  getIsWaiting: () => boolean
  getLiveAssistantMessage: () => UiMessage | null
  getOptimisticMessages: () => UiMessage[]
  getRetainedAssistantMessages: () => UiMessage[]
  getRunStatus: () => BackendRun['status'] | null
  getMessages: () => UiMessage[]
  isTerminalRunStatus: (status: BackendRun['status'] | null) => boolean
  logDebug: (scope: string, event: string, payload: unknown) => void
  projectAssistantMessageFromRunTranscript: (message: UiMessage) => UiMessage
  rememberRunTranscriptFromMessage: (message: UiMessage, source: keyof RunTranscriptSources) => void
  setDurableMessages: (messages: UiMessage[]) => void
  setLiveAssistantMessage: (message: UiMessage | null) => void
  setLiveAssistantMessageIdState: (messageId: MessageId | null) => void
  setMessages: (messages: UiMessage[]) => void
  setOptimisticMessages: (messages: UiMessage[]) => void
  setRetainedAssistantMessages: (messages: UiMessage[]) => void
  summarizeMessage: (message: UiMessage) => unknown
  toDurableThreadMessageRow: (message: UiMessage) => UiMessage
}

export const createRenderedMessageStateCoordinator = ({
  bumpStreamPulse,
  getDurableMessages,
  getIsStreaming,
  getIsWaiting,
  getLiveAssistantMessage,
  getMessages,
  getOptimisticMessages,
  getRetainedAssistantMessages,
  getRunStatus,
  isTerminalRunStatus,
  logDebug,
  projectAssistantMessageFromRunTranscript,
  rememberRunTranscriptFromMessage,
  setDurableMessages,
  setLiveAssistantMessage,
  setLiveAssistantMessageIdState,
  setMessages,
  setOptimisticMessages,
  setRetainedAssistantMessages,
  summarizeMessage,
  toDurableThreadMessageRow,
}: RenderedMessageStateDependencies) => {
  const messageIndexById = new Map<string, number>()
  const toolIndexByMessageId = new Map<string, Map<string, number>>()
  const stableUiKeyByMessageId = new Map<MessageId, string>()

  const durableHasAssistantForRun = (runId: RunId | null): boolean =>
    !!runId &&
    getDurableMessages().some((message) => message.role === 'assistant' && message.runId === runId)

  const liveAssistantHasBlocksForRun = (runId: RunId | null): boolean => {
    const liveAssistantMessage = getLiveAssistantMessage()
    return (
      !!runId &&
      !!liveAssistantMessage &&
      liveAssistantMessage.runId === runId &&
      liveAssistantMessage.blocks.length > 0
    )
  }

  const retainedAssistantHasRun = (runId: RunId | null): boolean =>
    !!runId && getRetainedAssistantMessages().some((message) => message.runId === runId)

  const rememberStableUiKey = (messageId: MessageId, uiKey: string) => {
    stableUiKeyByMessageId.set(messageId, uiKey)
  }

  const resolveStableUiKey = (message: Pick<UiMessage, 'id' | 'uiKey'>): string =>
    stableUiKeyByMessageId.get(message.id) ?? message.uiKey ?? message.id

  const withStableUiKey = (message: UiMessage): UiMessage => {
    const uiKey = resolveStableUiKey(message)
    return message.uiKey === uiKey ? message : { ...message, uiKey }
  }

  const rebuildToolIndexForMessage = (message: Pick<UiMessage, 'blocks' | 'id'>): void => {
    const toolIndex = new Map<string, number>()

    for (let index = 0; index < message.blocks.length; index += 1) {
      const block = message.blocks[index]
      if (block?.type === 'tool_interaction') {
        toolIndex.set(block.toolCallId, index)
      }
    }

    if (toolIndex.size === 0) {
      toolIndexByMessageId.delete(message.id)
      return
    }

    toolIndexByMessageId.set(message.id, toolIndex)
  }

  const buildProjectedMessages = (): UiMessage[] => {
    return projectThreadMessages({
      durableMessages: getDurableMessages(),
      durableHasAssistantForRun,
      hasKeepWorthyMessageContent,
      isStreaming: getIsStreaming(),
      isTerminalRunStatus,
      isWaiting: getIsWaiting(),
      liveAssistantMessage: getLiveAssistantMessage(),
      optimisticMessages: getOptimisticMessages(),
      projectAssistantMessage: projectAssistantMessageFromRunTranscript,
      retainedAssistantMessages: getRetainedAssistantMessages(),
      runStatus: getRunStatus(),
      withStableUiKey,
    })
  }

  const rebuildMessageIndex = () => {
    messageIndexById.clear()
    const messages = getMessages()
    for (let index = 0; index < messages.length; index += 1) {
      messageIndexById.set(messages[index].id, index)
    }
  }

  const rebuildToolBlockIndexes = () => {
    toolIndexByMessageId.clear()
    for (const message of getMessages()) {
      rebuildToolIndexForMessage(message)
    }
  }

  const flushProjectedMessages = (options: { pulse?: boolean } = {}) => {
    setMessages(buildProjectedMessages())
    rebuildMessageIndex()
    rebuildToolBlockIndexes()
    logDebug('store', 'syncProjectedMessages', {
      durableMessages: getDurableMessages().map(summarizeMessage),
      eventCursor: null,
      liveAssistantMessage: getLiveAssistantMessage()
        ? summarizeMessage(getLiveAssistantMessage()!)
        : null,
      messages: getMessages().map(summarizeMessage),
      optimisticMessages: getOptimisticMessages().map(summarizeMessage),
      retainedAssistantMessages: getRetainedAssistantMessages().map(summarizeMessage),
    })
    if (options.pulse) {
      bumpStreamPulse()
    }
  }

  const syncProjectedMessages = (options: { pulse?: boolean } = {}) => {
    flushProjectedMessages(options)
  }

  const syncProjectedMessagesIfLiveAssistantProjected = (options: { pulse?: boolean } = {}) => {
    const liveAssistantMessage = getLiveAssistantMessage()
    if (!liveAssistantMessage) {
      return
    }

    if (!getMessages().some((message) => message.id === liveAssistantMessage.id)) {
      return
    }

    syncProjectedMessages(options)
  }

  const replaceDurableMessages = (messages: UiMessage[]) => {
    logDebug('store', 'replaceDurableMessages:input', messages.map(summarizeMessage))

    const nextDurableMessages = messages.map((message) => {
      const nextMessage = {
        ...message,
        uiKey: message.id,
      }

      rememberRunTranscriptFromMessage(nextMessage, 'durableMessage')
      return toDurableThreadMessageRow(nextMessage)
    })

    const liveAssistantMessage = getLiveAssistantMessage()
    if (liveAssistantMessage) {
      const durableAssistant = nextDurableMessages.find(
        (message) =>
          message.role === 'assistant' &&
          message.runId != null &&
          message.runId === liveAssistantMessage.runId,
      )

      if (durableAssistant) {
        const existingStableUiKey = resolveStableUiKey(durableAssistant)
        const stableUiKey =
          existingStableUiKey !== durableAssistant.id
            ? existingStableUiKey
            : (liveAssistantMessage.uiKey ?? liveAssistantMessage.id)
        rememberStableUiKey(durableAssistant.id, stableUiKey)
      }
    }

    for (const retainedAssistant of getRetainedAssistantMessages()) {
      const durableAssistant = nextDurableMessages.find(
        (message) =>
          message.role === 'assistant' &&
          message.runId != null &&
          message.runId === retainedAssistant.runId,
      )

      if (durableAssistant) {
        const existingStableUiKey = resolveStableUiKey(durableAssistant)
        const stableUiKey =
          existingStableUiKey !== durableAssistant.id
            ? existingStableUiKey
            : (retainedAssistant.uiKey ?? retainedAssistant.id)
        rememberStableUiKey(durableAssistant.id, stableUiKey)
      }
    }

    const stableDurableMessages = nextDurableMessages.map(withStableUiKey)
    setDurableMessages(stableDurableMessages)
    setRetainedAssistantMessages(
      getRetainedAssistantMessages().filter(
        (message) =>
          message.runId == null ||
          !stableDurableMessages.some(
            (durable) => durable.role === 'assistant' && durable.runId === message.runId,
          ),
      ),
    )
    setOptimisticMessages(
      getOptimisticMessages().filter(
        (message) => !stableDurableMessages.some((durable) => durable.id === message.id),
      ),
    )

    if (
      liveAssistantMessage &&
      stableDurableMessages.some(
        (message) =>
          message.role === 'assistant' &&
          message.runId != null &&
          message.runId === liveAssistantMessage.runId,
      )
    ) {
      setLiveAssistantMessage(null)
      setLiveAssistantMessageIdState(null)
    }

    syncProjectedMessages({ pulse: true })
  }

  const clearCaches = () => {
    messageIndexById.clear()
    toolIndexByMessageId.clear()
    stableUiKeyByMessageId.clear()
  }

  const getMessageIndex = (messageId: MessageId | string): number | undefined =>
    messageIndexById.get(String(messageId))

  return {
    clearCaches,
    durableHasAssistantForRun,
    getMessageIndex,
    hasKeepWorthyMessageContent,
    liveAssistantHasBlocksForRun,
    messageIndexById,
    rebuildToolIndexForMessage,
    rememberStableUiKey,
    replaceDurableMessages,
    resolveStableUiKey,
    retainedAssistantHasRun,
    syncProjectedMessages,
    syncProjectedMessagesIfLiveAssistantProjected,
    toolIndexByMessageId,
    withStableUiKey,
  }
}
