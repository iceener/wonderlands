import type { AppDatabase } from '../../db/client'
import {
  createFileRepository,
  type MessageLinkedFileRecord,
} from '../../domain/files/file-repository'
import type { ItemRecord } from '../../domain/runtime/item-repository'
import type { SessionMessageRecord } from '../../domain/sessions/session-message-repository'
import type { DomainError } from '../../shared/errors'
import type { FileId, SessionMessageId } from '../../shared/ids'
import { ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { CommandContext, CommandResult } from '../commands/command-context'
import { readMessageAttachmentFileIds } from './attachment-metadata'
import { toAttachmentInternalPath } from './attachment-storage'

export type AttachmentRefKind = 'file' | 'image'
export type AttachmentRefMessageState = 'live' | 'sealed'

export interface AttachmentRefDescriptor {
  fileId: FileId
  indexInMessageAll: number
  indexInMessageByKind: number
  internalPath: string
  kind: AttachmentRefKind
  messageCreatedAt: string
  messageId: SessionMessageId
  messageSequence: number
  mimeType: string | null
  name: string | null
  ref: string
  renderUrl: string
  sourceMessageState: AttachmentRefMessageState
}

interface BuildAttachmentRefDescriptorsInput {
  apiBasePath: string
  linkedFiles: MessageLinkedFileRecord[]
  liveMessageIds?: ReadonlySet<SessionMessageId>
  visibleMessages: SessionMessageRecord[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readProjectedSessionMessageId = (item: ItemRecord): SessionMessageId | null => {
  if (item.type !== 'message') {
    return null
  }

  const payload = isRecord(item.providerPayload) ? item.providerPayload : null

  return payload?.source === 'session_message_projection' &&
    typeof payload.sessionMessageId === 'string' &&
    payload.sessionMessageId.length > 0
    ? (payload.sessionMessageId as SessionMessageId)
    : null
}

const toRef = (messageId: SessionMessageId, kind: AttachmentRefKind, index: number): string =>
  `{{attachment:msg_${messageId}:kind:${kind}:index:${index}}}`

const compareFallbackFileOrder = (
  left: MessageLinkedFileRecord['file'],
  right: MessageLinkedFileRecord['file'],
): number => {
  const createdAtDelta = left.createdAt.localeCompare(right.createdAt)

  if (createdAtDelta !== 0) {
    return createdAtDelta
  }

  return left.id.localeCompare(right.id)
}

const sortLinkedFilesForMessage = (
  message: SessionMessageRecord,
  linkedFiles: MessageLinkedFileRecord[],
): MessageLinkedFileRecord[] => {
  const orderedIds = readMessageAttachmentFileIds(message.metadata)
  const orderById = new Map(orderedIds.map((fileId, index) => [fileId, index]))

  return [...linkedFiles].sort((left, right) => {
    const leftIndex = orderById.get(left.file.id)
    const rightIndex = orderById.get(right.file.id)

    if (leftIndex !== undefined || rightIndex !== undefined) {
      if (leftIndex === undefined) {
        return 1
      }

      if (rightIndex === undefined) {
        return -1
      }

      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex
      }
    }

    return compareFallbackFileOrder(left.file, right.file)
  })
}

export const collectLiveSessionMessageIds = (items: ItemRecord[]): Set<SessionMessageId> => {
  const messageIds = new Set<SessionMessageId>()

  for (const item of items) {
    const messageId = readProjectedSessionMessageId(item)

    if (messageId) {
      messageIds.add(messageId)
    }
  }

  return messageIds
}

export const buildAttachmentRefDescriptors = (
  input: BuildAttachmentRefDescriptorsInput,
): AttachmentRefDescriptor[] => {
  const linkedFilesByMessageId = new Map<SessionMessageId, MessageLinkedFileRecord[]>()

  for (const linkedFile of input.linkedFiles) {
    const entries = linkedFilesByMessageId.get(linkedFile.messageId) ?? []
    entries.push(linkedFile)
    linkedFilesByMessageId.set(linkedFile.messageId, entries)
  }

  const descriptors: AttachmentRefDescriptor[] = []

  for (const message of input.visibleMessages) {
    const linkedFiles = linkedFilesByMessageId.get(message.id) ?? []

    if (linkedFiles.length === 0) {
      continue
    }

    const orderedFiles = sortLinkedFilesForMessage(message, linkedFiles)
    let imageIndex = 0
    let fileIndex = 0

    for (const [index, linkedFile] of orderedFiles.entries()) {
      const kind: AttachmentRefKind = linkedFile.file.mimeType?.startsWith('image/')
        ? 'image'
        : 'file'
      const nextKindIndex = kind === 'image' ? imageIndex + 1 : fileIndex + 1

      if (kind === 'image') {
        imageIndex = nextKindIndex
      } else {
        fileIndex = nextKindIndex
      }

      descriptors.push({
        fileId: linkedFile.file.id,
        indexInMessageAll: index + 1,
        indexInMessageByKind: nextKindIndex,
        internalPath: toAttachmentInternalPath(linkedFile.file.storageKey),
        kind,
        messageCreatedAt: message.createdAt,
        messageId: message.id,
        messageSequence: message.sequence,
        mimeType: linkedFile.file.mimeType,
        name: linkedFile.file.originalFilename ?? linkedFile.file.title ?? linkedFile.file.id,
        ref: toRef(message.id, kind, nextKindIndex),
        renderUrl: `${input.apiBasePath}/files/${linkedFile.file.id}/content`,
        sourceMessageState:
          input.liveMessageIds && !input.liveMessageIds.has(message.id) ? 'sealed' : 'live',
      })
    }
  }

  return descriptors
}

export const loadAttachmentRefDescriptors = (
  db: AppDatabase,
  scope: TenantScope,
  input: {
    apiBasePath: string
    liveMessageIds?: ReadonlySet<SessionMessageId>
    visibleMessages: SessionMessageRecord[]
  },
): Result<AttachmentRefDescriptor[], DomainError> => {
  const linkedFiles = createFileRepository(db).listByMessageIds(
    scope,
    input.visibleMessages.map((message) => message.id),
  )

  if (!linkedFiles.ok) {
    return linkedFiles
  }

  return ok(
    buildAttachmentRefDescriptors({
      apiBasePath: input.apiBasePath,
      linkedFiles: linkedFiles.value,
      liveMessageIds: input.liveMessageIds,
      visibleMessages: input.visibleMessages,
    }),
  )
}

export const loadThreadAttachmentRefs = (
  context: CommandContext,
  input: {
    liveTailItems: ItemRecord[]
    visibleMessages: SessionMessageRecord[]
  },
): CommandResult<AttachmentRefDescriptor[]> =>
  loadAttachmentRefDescriptors(context.db, context.tenantScope, {
    apiBasePath: context.config.api.basePath,
    liveMessageIds: collectLiveSessionMessageIds(input.liveTailItems),
    visibleMessages: input.visibleMessages,
  })
