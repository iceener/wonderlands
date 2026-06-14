import type {
  BackendRun,
  MessageAttachment,
  RunId,
  SessionId,
  ThreadId,
} from '@wonderlands/contracts/chat'
import { asRunId, asSessionId, asThreadId } from '@wonderlands/contracts/chat'
import type { PersistedChatState } from '../persistence/chat-persistence'
import type { PersistedRunTranscriptState, RunTranscriptState } from '../types'

interface PersistedSnapshotDependencies {
  bindActiveRun: (runId: RunId | null) => void
  cloneAttachments: (attachments: MessageAttachment[]) => MessageAttachment[]
  cloneBlocks: PersistedSnapshotCloneBlocks
  getRunId: () => RunId | null
  getRunStatus: () => BackendRun['status'] | null
  getRunTranscript: (runId: RunId) => RunTranscriptState | null
  isTerminalRunStatus: (
    status: BackendRun['status'] | null,
  ) => status is 'completed' | 'failed' | 'cancelled'
  resolveThreadEventCursor: (threadId: ThreadId | null) => number
  restorePersistedRunTranscript: (transcript: PersistedRunTranscriptState | null) => void
  restoreThreadEventCursorIndex: (persistedState: PersistedChatState | null) => void
  setAttachmentsByMessageId: (attachmentsByMessageId: Record<string, MessageAttachment[]>) => void
  setEventCursor: (eventCursor: number) => void
  setIsCancelling: (value: boolean) => void
  setIsReconnecting: (value: boolean) => void
  setIsResolvingWait: (value: boolean) => void
  setIsStreaming: (value: boolean) => void
  setIsWaiting: (value: boolean) => void
  setRunStatus: (status: BackendRun['status'] | null) => void
  setSessionId: (sessionId: SessionId | null) => void
  setThreadId: (threadId: ThreadId | null) => void
  syncProjectedMessages: (options?: { pulse?: boolean }) => void
}

type PersistedSnapshotCloneBlocks = (
  transcript: RunTranscriptState['blocks'],
) => RunTranscriptState['blocks']

const inferPersistedRunStatus = (
  persistedState: PersistedChatState | null,
): BackendRun['status'] | null => {
  if (!persistedState?.runId) {
    return null
  }

  const transcript = persistedState.activeRunTranscript
  if (!transcript || transcript.runId !== asRunId(persistedState.runId)) {
    return 'running'
  }

  switch (transcript.status) {
    case 'complete':
      switch (transcript.finishReason) {
        case 'stop':
          return 'completed'
        case 'cancelled':
          return 'cancelled'
        case 'error':
          return 'failed'
        case 'waiting':
          return 'waiting'
        default:
          return 'completed'
      }
    case 'streaming':
      return 'running'
    case 'waiting':
      return 'waiting'
    case 'error':
      return transcript.finishReason === 'cancelled' ? 'cancelled' : 'failed'
    default:
      return 'running'
  }
}

export const createPersistedSnapshotHandler = ({
  bindActiveRun,
  cloneAttachments,
  cloneBlocks,
  getRunId,
  getRunStatus,
  getRunTranscript,
  isTerminalRunStatus,
  resolveThreadEventCursor,
  restorePersistedRunTranscript,
  restoreThreadEventCursorIndex,
  setAttachmentsByMessageId,
  setEventCursor,
  setIsCancelling,
  setIsReconnecting,
  setIsResolvingWait,
  setIsStreaming,
  setIsWaiting,
  setRunStatus,
  setSessionId,
  setThreadId,
  syncProjectedMessages,
}: PersistedSnapshotDependencies) => {
  const applyPersistedStateSnapshot = (
    persistedState: PersistedChatState | null,
  ): ThreadId | null => {
    restoreThreadEventCursorIndex(persistedState)

    if (!persistedState?.threadId) {
      return null
    }

    const persistedThreadId = asThreadId(persistedState.threadId)
    setEventCursor(resolveThreadEventCursor(persistedThreadId))
    setSessionId(persistedState.sessionId ? asSessionId(persistedState.sessionId) : null)
    setThreadId(persistedThreadId)
    bindActiveRun(persistedState.runId ? asRunId(persistedState.runId) : null)
    setAttachmentsByMessageId(persistedState.attachmentsByMessageId ?? {})

    return persistedThreadId
  }

  const applyPersistedActiveRunSnapshot = (
    persistedState: PersistedChatState | null,
    options: { pulse?: boolean } = {},
  ) => {
    const persistedRunStatus = inferPersistedRunStatus(persistedState)
    setRunStatus(persistedRunStatus)
    setIsCancelling(false)
    setIsReconnecting(false)
    setIsResolvingWait(false)
    setIsWaiting(persistedRunStatus === 'waiting')
    setIsStreaming(persistedRunStatus === 'running' || persistedRunStatus === 'pending')

    if (persistedState?.activeRunTranscript) {
      restorePersistedRunTranscript(persistedState.activeRunTranscript)
      return
    }

    if (options.pulse) {
      syncProjectedMessages({ pulse: true })
    }
  }

  const getPersistedActiveRunTranscript = (): PersistedRunTranscriptState | null => {
    const runId = getRunId()
    if (!runId) {
      return null
    }

    const transcript = getRunTranscript(runId)
    if (!transcript) {
      return null
    }

    if (isTerminalRunStatus(getRunStatus())) {
      return null
    }

    return {
      attachments: cloneAttachments(transcript.attachments),
      blocks: cloneBlocks(transcript.blocks),
      createdAt: transcript.createdAt,
      finishReason: transcript.finishReason,
      messageId: transcript.messageId,
      runId: transcript.runId,
      sequence: transcript.sequence,
      status: transcript.status,
      text: transcript.text,
    }
  }

  return {
    applyPersistedActiveRunSnapshot,
    applyPersistedStateSnapshot,
    getPersistedActiveRunTranscript,
  }
}
