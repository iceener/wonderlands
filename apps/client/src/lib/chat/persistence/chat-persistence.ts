import type {
  Block,
  MessageAttachment,
  MessageFinishReason,
  MessageStatus,
  RunId,
  SessionId,
  ThreadId,
} from '@wonderlands/contracts/chat'
import { asMessageId, asRunId, asSessionId, asThreadId } from '@wonderlands/contracts/chat'
import type { PersistedRunTranscriptState } from '../types'

export interface PersistedChatState {
  attachmentsByMessageId?: Record<string, MessageAttachment[]>
  activeRunTranscript?: PersistedRunTranscriptState | null
  eventCursor: number
  runId: string | null
  sessionId: string | null
  threadEventCursors?: Record<string, number>
  threadId: string | null
}

export interface StorageLike {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

interface ChatPersistenceDependencies {
  cloneAttachments: (attachments: MessageAttachment[]) => MessageAttachment[]
  cloneBlocks: (blocks: Block[]) => Block[]
  getTenantId: () => string | null | undefined
  scopeKey: string
  scopeSeparator: string
  storage?: StorageLike | null
}

const getStorage = (storage: StorageLike | null | undefined): StorageLike | null => {
  if (storage !== undefined) {
    return storage
  }

  if (typeof localStorage === 'undefined') {
    return null
  }

  return localStorage
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isMessageAttachment = (value: unknown): value is MessageAttachment => {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.size === 'number' &&
    typeof value.mime === 'string' &&
    (value.kind === 'image' || value.kind === 'file') &&
    typeof value.url === 'string' &&
    (value.thumbnailUrl === undefined || typeof value.thumbnailUrl === 'string')
  )
}

const isMessageFinishReason = (value: unknown): value is MessageFinishReason =>
  value === 'stop' || value === 'cancelled' || value === 'error' || value === 'waiting'

const parsePersistedAttachments = (value: unknown): Record<string, MessageAttachment[]> => {
  if (!isRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([messageId, attachments]) => {
      if (!Array.isArray(attachments)) {
        return []
      }

      const normalized = attachments
        .filter(isMessageAttachment)
        .map((attachment) => ({ ...attachment }))
      return normalized.length > 0 ? [[messageId, normalized]] : []
    }),
  )
}

const normalizeThreadEventCursors = (value: unknown): Record<string, number> | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const entries = Object.entries(value).flatMap(([threadId, eventCursor]) =>
    threadId.trim().length > 0 &&
    typeof eventCursor === 'number' &&
    Number.isFinite(eventCursor) &&
    eventCursor >= 0
      ? [[threadId, eventCursor] as const]
      : [],
  )

  return Object.fromEntries(entries)
}

const isValidEventCursor = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

export const createChatPersistence = ({
  cloneAttachments,
  cloneBlocks,
  getTenantId,
  scopeKey,
  scopeSeparator,
  storage: providedStorage,
}: ChatPersistenceDependencies) => {
  const storage = getStorage(providedStorage)
  const storageKey = (() => {
    const tenantId = getTenantId()?.trim()
    return tenantId ? `${scopeKey}${scopeSeparator}${tenantId}` : scopeKey
  })()
  const threadEventCursorByThreadId = new Map<ThreadId, number>()

  const parsePersistedRunTranscript = (value: unknown): PersistedRunTranscriptState | null => {
    if (!isRecord(value)) {
      return null
    }

    if (
      typeof value.runId !== 'string' ||
      typeof value.status !== 'string' ||
      typeof value.createdAt !== 'string' ||
      typeof value.text !== 'string' ||
      !Array.isArray(value.blocks)
    ) {
      return null
    }

    const attachments = Array.isArray(value.attachments)
      ? value.attachments.filter(isMessageAttachment).map((attachment) => ({ ...attachment }))
      : []

    return {
      attachments,
      blocks: cloneBlocks(value.blocks as Block[]),
      createdAt: value.createdAt,
      finishReason:
        value.finishReason === null || isMessageFinishReason(value.finishReason)
          ? value.finishReason
          : null,
      messageId: typeof value.messageId === 'string' ? asMessageId(value.messageId) : null,
      runId: asRunId(value.runId),
      sequence: typeof value.sequence === 'number' ? value.sequence : null,
      status: value.status as MessageStatus,
      text: value.text,
    }
  }

  const restoreThreadEventCursorIndex = (persistedState: PersistedChatState | null) => {
    threadEventCursorByThreadId.clear()

    for (const [threadId, eventCursor] of Object.entries(
      persistedState?.threadEventCursors ?? {},
    )) {
      threadEventCursorByThreadId.set(asThreadId(threadId), eventCursor)
    }

    if (persistedState?.threadId && isValidEventCursor(persistedState.eventCursor)) {
      threadEventCursorByThreadId.set(
        asThreadId(persistedState.threadId),
        Math.max(
          persistedState.eventCursor,
          threadEventCursorByThreadId.get(asThreadId(persistedState.threadId)) ?? 0,
        ),
      )
    }
  }

  const rememberThreadEventCursor = (threadId: ThreadId | null, eventCursor: number) => {
    if (!threadId || !isValidEventCursor(eventCursor)) {
      return
    }

    const current = threadEventCursorByThreadId.get(threadId) ?? 0
    if (eventCursor > current) {
      threadEventCursorByThreadId.set(threadId, eventCursor)
    }
  }

  return {
    clear() {
      storage?.removeItem(storageKey)
    },

    readState(): PersistedChatState | null {
      if (!storage) {
        return null
      }

      const rawValue = storage.getItem(storageKey)
      if (!rawValue) {
        return null
      }

      try {
        const parsed = JSON.parse(rawValue) as PersistedChatState
        if (!isRecord(parsed) || typeof parsed.eventCursor !== 'number') {
          return null
        }

        return {
          ...parsed,
          activeRunTranscript: parsePersistedRunTranscript(parsed.activeRunTranscript),
          attachmentsByMessageId: parsePersistedAttachments(parsed.attachmentsByMessageId),
          sessionId: parsed.sessionId ? String(asSessionId(parsed.sessionId)) : null,
          threadEventCursors: normalizeThreadEventCursors(parsed.threadEventCursors),
          threadId: parsed.threadId ? String(asThreadId(parsed.threadId)) : null,
        }
      } catch {
        return null
      }
    },

    rememberThreadEventCursor,

    resolveThreadEventCursor(threadId: ThreadId | null): number {
      return threadId ? (threadEventCursorByThreadId.get(threadId) ?? 0) : 0
    },

    restoreThreadEventCursorIndex,

    setThreadEventCursor(threadId: ThreadId | null, eventCursor: number): number | null {
      if (!threadId || !isValidEventCursor(eventCursor)) {
        return null
      }

      threadEventCursorByThreadId.set(threadId, eventCursor)
      return eventCursor
    },

    writeState(input: {
      attachmentsByMessageId: ReadonlyMap<string, MessageAttachment[]>
      activeRunTranscript: PersistedRunTranscriptState | null
      eventCursor: number
      runId: RunId | null
      sessionId: SessionId | null
      threadId: ThreadId | null
    }) {
      if (!storage) {
        return
      }

      rememberThreadEventCursor(input.threadId, input.eventCursor)

      const attachmentsByMessageId = Object.fromEntries(
        Array.from(input.attachmentsByMessageId.entries()).map(([messageId, attachments]) => [
          messageId,
          cloneAttachments(attachments),
        ]),
      )

      storage.setItem(
        storageKey,
        JSON.stringify({
          attachmentsByMessageId,
          activeRunTranscript: input.activeRunTranscript,
          eventCursor: input.eventCursor,
          runId: input.runId,
          sessionId: input.sessionId,
          threadEventCursors: Object.fromEntries(threadEventCursorByThreadId.entries()),
          threadId: input.threadId,
        } satisfies PersistedChatState),
      )
    },
  }
}
