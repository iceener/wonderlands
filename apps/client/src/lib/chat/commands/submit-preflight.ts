import type {
  BackendPendingWait,
  MessageAttachment,
  MessageId,
  ThreadId,
} from '@wonderlands/contracts/chat'
import { stripLargeTextPasteHiddenMetadata } from '../../prompt-editor/large-paste'

export interface SubmitNormalizedInput {
  fileIds: string[]
  submittedPrompt: string
  visiblePrompt: string
}

export const normalizeSubmitInput = (
  prompt: string,
  attachments: MessageAttachment[],
  referencedFileIds: string[],
): SubmitNormalizedInput => ({
  fileIds: [
    ...new Set(
      [...attachments.map((attachment) => attachment.id), ...referencedFileIds]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ],
  submittedPrompt: prompt.trim(),
  visiblePrompt: stripLargeTextPasteHiddenMetadata(prompt).trim(),
})

export const resolveSubmitPreflight = (input: {
  activeEditMessageId: MessageId | null
  fileIds: string[]
  isLoading: boolean
  isStreaming: boolean
  isWaiting: boolean
  replyablePendingWait: BackendPendingWait | null
  submittedPrompt: string
  threadId: ThreadId | null
}):
  | { ok: true }
  | {
      error?: string
      ok: false
    } => {
  if (
    input.isLoading ||
    input.isStreaming ||
    (input.isWaiting && input.replyablePendingWait === null) ||
    (input.activeEditMessageId
      ? !input.submittedPrompt && input.fileIds.length === 0
      : !input.submittedPrompt)
  ) {
    return { ok: false }
  }

  if (!input.replyablePendingWait) {
    return { ok: true }
  }

  if (!input.threadId) {
    return { ok: false }
  }

  if (input.activeEditMessageId) {
    return {
      error: 'Editing a previous message is unavailable while replying to a suspended run.',
      ok: false,
    }
  }

  if (input.fileIds.length > 0) {
    return {
      error: 'Attachments and file references are not supported while replying to a suspended run.',
      ok: false,
    }
  }

  return { ok: true }
}
