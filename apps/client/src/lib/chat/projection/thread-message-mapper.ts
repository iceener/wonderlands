import type {
  BackendThreadMessage,
  MessageAttachment,
  MessageFinishReason,
} from '@wonderlands/contracts/chat'
import {
  parseLargeTextPasteMetadata,
  stripLargeTextPasteHiddenMetadata,
} from '../../prompt-editor/large-paste'
import {
  materializePersistedAssistantBlocks,
  settleBlocksForRunTerminalState,
} from '../../runtime/materialize'
import { extractSandboxOutputAttachments } from '../../sandbox/output-attachments'
import type { UiMessage } from '../types'

interface ThreadMessageMapperDependencies {
  cloneAttachments: (attachments: MessageAttachment[]) => MessageAttachment[]
  mergeAttachments: (
    existing: MessageAttachment[],
    incoming: MessageAttachment[],
  ) => MessageAttachment[]
  extractAttachmentsFromMetadata: (metadata: unknown) => MessageAttachment[]
}

const messageTextFromParts = (message: BackendThreadMessage): string =>
  message.content
    .map((part) => part.text)
    .join('\n')
    .trim()

const isMessageFinishReason = (value: unknown): value is MessageFinishReason =>
  value === 'stop' || value === 'cancelled' || value === 'error' || value === 'waiting'

const readPersistedMessageFinishReason = (metadata: unknown): MessageFinishReason | null => {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return null
  }

  const record = metadata as Record<string, unknown>
  return isMessageFinishReason(record.finishReason) ? record.finishReason : null
}

export const createThreadMessageMapper = ({
  cloneAttachments,
  mergeAttachments,
  extractAttachmentsFromMetadata,
}: ThreadMessageMapperDependencies) => {
  const toUiMessage = (
    message: BackendThreadMessage,
    attachments: MessageAttachment[] = [],
  ): UiMessage => {
    const role = message.authorKind === 'assistant' ? 'assistant' : 'user'
    const rawText = messageTextFromParts(message)
    const text = role === 'user' ? stripLargeTextPasteHiddenMetadata(rawText) : rawText

    let resolvedAttachments = cloneAttachments(attachments)
    if (resolvedAttachments.length === 0) {
      const metadataAttachments = extractAttachmentsFromMetadata(message.metadata)
      if (metadataAttachments.length > 0) {
        resolvedAttachments = metadataAttachments
      } else if (role === 'user') {
        const pasteEntries = parseLargeTextPasteMetadata(rawText)
        for (const entry of pasteEntries) {
          resolvedAttachments.push({
            id: entry.fileId,
            name: entry.fileName,
            size: entry.characterCount,
            mime: entry.fileName.endsWith('.md') ? 'text/markdown' : 'text/plain',
            kind: 'file',
            url: '',
          })
        }
      }
    }

    const blocks =
      role === 'assistant'
        ? materializePersistedAssistantBlocks(text, message.createdAt, message.metadata)
        : []
    const finishReason =
      role === 'assistant' ? readPersistedMessageFinishReason(message.metadata) : null

    if (
      blocks.length > 0 &&
      finishReason != null &&
      (finishReason === 'cancelled' || finishReason === 'error')
    ) {
      settleBlocksForRunTerminalState(blocks, {
        createdAt: message.createdAt,
        runId: message.runId ? String(message.runId) : null,
        status: finishReason === 'cancelled' ? 'cancelled' : 'failed',
      })
    }

    return {
      attachments: resolvedAttachments,
      blocks,
      createdAt: message.createdAt,
      finishReason,
      id: message.id,
      role,
      runId: message.runId,
      sequence: message.sequence,
      status: 'complete',
      text,
      uiKey: message.id,
    }
  }

  const syncSandboxAttachmentsFromBlocks = (
    message: UiMessage,
    options: { force?: boolean; reveal?: boolean } = {},
  ): void => {
    if (
      message.role !== 'assistant' ||
      message.blocks.length === 0 ||
      (!options.force && !options.reveal && message.status === 'streaming')
    ) {
      return
    }

    const derived = extractSandboxOutputAttachments(message.blocks)
    if (derived.length === 0) {
      return
    }

    message.attachments = mergeAttachments(message.attachments, derived)
  }

  return {
    syncSandboxAttachmentsFromBlocks,
    toUiMessage,
  }
}
