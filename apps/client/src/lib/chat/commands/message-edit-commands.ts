import type { MessageAttachment, MessageId } from '@wonderlands/contracts/chat'
import type { MessageEditDraft, UiMessage } from '../types'

interface MessageEditCommandsDependencies {
  cloneAttachments: (attachments: MessageAttachment[]) => MessageAttachment[]
  findMessage: (messageId: MessageId) => UiMessage | null
  getEditDraft: () => MessageEditDraft | null
  isBusy: () => boolean
  randomUUID: () => string
  setError: (message: string | null) => void
  setLocalAttachments: (messageId: MessageId, attachments: MessageAttachment[]) => void
  setMessageEditDraft: (draft: MessageEditDraft | null) => void
  syncMessageAttachments: (messageId: MessageId) => void
}

export const createMessageEditCommands = (dependencies: MessageEditCommandsDependencies) => {
  const beginMessageEdit = (messageId: MessageId): boolean => {
    if (dependencies.isBusy()) {
      return false
    }

    const message = dependencies.findMessage(messageId)
    if (!message || message.role !== 'user') {
      return false
    }

    dependencies.setError(null)
    dependencies.setMessageEditDraft({
      activationId: dependencies.randomUUID(),
      attachments: dependencies.cloneAttachments(message.attachments),
      messageId: message.id,
      text: message.text,
    })
    return true
  }

  const cancelMessageEdit = () => {
    dependencies.setMessageEditDraft(null)
  }

  const replaceMessageAttachment = (
    messageId: MessageId,
    attachmentId: string,
    next: MessageAttachment,
  ): boolean => {
    const message = dependencies.findMessage(messageId)
    const draft = dependencies.getEditDraft()
    const current =
      message?.attachments ?? (draft?.messageId === messageId ? draft.attachments : null)

    if (!current) {
      return false
    }

    const updated = current.map((attachment) =>
      attachment.id === attachmentId ? { ...next } : attachment,
    )

    if (updated.every((attachment) => attachment.id !== next.id)) {
      return false
    }

    dependencies.setLocalAttachments(messageId, updated)
    dependencies.syncMessageAttachments(messageId)
    return true
  }

  return {
    beginMessageEdit,
    cancelMessageEdit,
    replaceMessageAttachment,
  }
}
