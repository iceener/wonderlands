import type { MessageAttachment, RunId, SessionId, ThreadId } from '@wonderlands/contracts/chat'
import type { PersistedRunTranscriptState, UiMessage } from '../types'
import type { PersistedChatState } from './chat-persistence'

interface ChatPersistenceShellDependencies {
  clearPersistenceStore: () => void
  getAttachmentsByMessageId: () => ReadonlyMap<string, MessageAttachment[]>
  getDurableMessages: () => UiMessage[]
  getEventCursor: () => number
  getLiveAssistantMessage: () => UiMessage | null
  getOptimisticMessages: () => UiMessage[]
  getPersistedActiveRunTranscript: () => PersistedRunTranscriptState | null
  getRunId: () => RunId | null
  getSessionId: () => SessionId | null
  getThreadId: () => ThreadId | null
  readPersistedState: () => PersistedChatState | null
  resolvePersistedThreadEventCursor: (threadId: ThreadId | null) => number
  restorePersistedThreadEventCursorIndex: (persistedState: PersistedChatState | null) => void
  setEventCursor: (cursor: number) => void
  setPersistedThreadEventCursor: (threadId: ThreadId | null, eventCursor: number) => number | null
  applyPersistedStateSnapshot: (persistedState: PersistedChatState | null) => ThreadId | null
  applyPersistedActiveRunSnapshot: (
    persistedState: PersistedChatState | null,
    options?: { pulse?: boolean },
  ) => void
  writePersistenceStore: (input: {
    attachmentsByMessageId: ReadonlyMap<string, MessageAttachment[]>
    activeRunTranscript: PersistedRunTranscriptState | null
    eventCursor: number
    runId: RunId | null
    sessionId: SessionId | null
    threadId: ThreadId | null
  }) => void
}

export const createChatPersistenceShell = ({
  clearPersistenceStore,
  getAttachmentsByMessageId,
  getDurableMessages,
  getEventCursor,
  getLiveAssistantMessage,
  getOptimisticMessages,
  getPersistedActiveRunTranscript,
  getRunId,
  getSessionId,
  getThreadId,
  readPersistedState,
  resolvePersistedThreadEventCursor,
  restorePersistedThreadEventCursorIndex,
  setEventCursor,
  setPersistedThreadEventCursor,
  applyPersistedStateSnapshot,
  applyPersistedActiveRunSnapshot,
  writePersistenceStore,
}: ChatPersistenceShellDependencies) => {
  const restoreThreadEventCursorIndex = (persistedState: PersistedChatState | null) =>
    restorePersistedThreadEventCursorIndex(persistedState)

  const setThreadEventCursor = (threadId: ThreadId | null, eventCursor: number) => {
    const nextEventCursor = setPersistedThreadEventCursor(threadId, eventCursor)
    if (nextEventCursor != null && getThreadId() === threadId) {
      setEventCursor(nextEventCursor)
    }
  }

  const resolveThreadEventCursor = (threadId: ThreadId | null): number =>
    resolvePersistedThreadEventCursor(threadId)

  const writePersistedState = () => {
    writePersistenceStore({
      attachmentsByMessageId: getAttachmentsByMessageId(),
      activeRunTranscript: getPersistedActiveRunTranscript(),
      eventCursor: getEventCursor(),
      runId: getRunId(),
      sessionId: getSessionId(),
      threadId: getThreadId(),
    })
  }

  const persistState = () => {
    writePersistedState()
  }

  const clearPersistedState = () => {
    clearPersistenceStore()
  }

  const primeFromPersistedState = () => {
    if (
      getThreadId() ||
      getDurableMessages().length > 0 ||
      getOptimisticMessages().length > 0 ||
      getLiveAssistantMessage()
    ) {
      return
    }

    const persistedState = readPersistedState()
    const persistedThreadId = applyPersistedStateSnapshot(persistedState)
    if (!persistedThreadId) {
      return
    }

    applyPersistedActiveRunSnapshot(persistedState, { pulse: true })
  }

  return {
    clearPersistedState,
    persistState,
    primeFromPersistedState,
    resolveThreadEventCursor,
    restoreThreadEventCursorIndex,
    setThreadEventCursor,
    writePersistedState,
  }
}
