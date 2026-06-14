import type { BackendRun, RunId } from '@wonderlands/contracts/chat'
import type { UiMessage } from '../types'

interface ProjectThreadMessagesInput {
  durableMessages: UiMessage[]
  durableHasAssistantForRun: (runId: RunId | null) => boolean
  hasKeepWorthyMessageContent: (
    message: Pick<UiMessage, 'blocks' | 'finishReason' | 'text'> | null | undefined,
  ) => boolean
  isStreaming: boolean
  isTerminalRunStatus: (status: BackendRun['status'] | null) => boolean
  isWaiting: boolean
  liveAssistantMessage: UiMessage | null
  optimisticMessages: UiMessage[]
  projectAssistantMessage: (message: UiMessage) => UiMessage
  retainedAssistantMessages: UiMessage[]
  runStatus: BackendRun['status'] | null
  withStableUiKey: (message: UiMessage) => UiMessage
}

export const projectThreadMessages = ({
  durableMessages,
  durableHasAssistantForRun,
  hasKeepWorthyMessageContent,
  isStreaming,
  isTerminalRunStatus,
  isWaiting,
  liveAssistantMessage,
  optimisticMessages,
  projectAssistantMessage,
  retainedAssistantMessages,
  runStatus,
  withStableUiKey,
}: ProjectThreadMessagesInput): UiMessage[] => {
  const durableIds = new Set(durableMessages.map((message) => message.id))
  const projected = durableMessages.map((message) =>
    withStableUiKey(projectAssistantMessage(message)),
  )

  for (const message of retainedAssistantMessages) {
    if (message.runId != null && durableHasAssistantForRun(message.runId)) {
      continue
    }

    projected.push(withStableUiKey(projectAssistantMessage(message)))
  }

  for (const message of optimisticMessages) {
    if (!durableIds.has(message.id)) {
      projected.push(withStableUiKey(message))
    }
  }

  const shouldProjectLiveAssistant =
    !!liveAssistantMessage &&
    !durableHasAssistantForRun(liveAssistantMessage.runId) &&
    (isStreaming ||
      isWaiting ||
      hasKeepWorthyMessageContent(liveAssistantMessage) ||
      (isTerminalRunStatus(runStatus) && liveAssistantMessage.runId != null))

  if (shouldProjectLiveAssistant && liveAssistantMessage) {
    projected.push(withStableUiKey(projectAssistantMessage(liveAssistantMessage)))
  }

  return projected
}
