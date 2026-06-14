import type { MessageAttachment, MessageId } from '@wonderlands/contracts/chat'
import { asMessageId } from '@wonderlands/contracts/chat'
import type { MessageEditDraft, UiMessage } from '../types'

interface PendingOptimisticOwnerSnapshot {
  submitId: number
  viewEpoch: number
}

interface LocalMessageStateDependencies {
  cloneAttachments: (attachments: MessageAttachment[]) => MessageAttachment[]
  getLocalAttachmentsMap: () => Map<string, MessageAttachment[]>
  getMessageEditDraft: () => MessageEditDraft | null
  getOptimisticMessages: () => UiMessage[]
  getPendingOptimisticMessageId: () => MessageId | null
  logDebug: (scope: string, event: string, payload: unknown) => void
  nowIso: () => string
  persistState: () => void
  randomUUID: () => string
  rememberStableUiKey: (messageId: MessageId, uiKey: string) => void
  setMessageEditDraft: (draft: MessageEditDraft | null) => void
  setOptimisticMessages: (messages: UiMessage[]) => void
  setPendingOptimisticOwnership: (
    messageId: MessageId | null,
    owner: PendingOptimisticOwnerSnapshot | null,
  ) => void
  summarizeMessage: (message: UiMessage) => unknown
  syncProjectedMessages: (options?: { pulse?: boolean }) => void
}

export const createLocalMessageStateCoordinator = ({
  cloneAttachments,
  getLocalAttachmentsMap,
  getMessageEditDraft,
  getOptimisticMessages,
  getPendingOptimisticMessageId,
  logDebug,
  nowIso,
  persistState,
  randomUUID,
  rememberStableUiKey,
  setMessageEditDraft,
  setOptimisticMessages,
  setPendingOptimisticOwnership,
  summarizeMessage,
  syncProjectedMessages,
}: LocalMessageStateDependencies) => {
  const getLocalAttachments = (messageId: MessageId): MessageAttachment[] =>
    cloneAttachments(getLocalAttachmentsMap().get(messageId) ?? [])

  const cloneMessageEditDraft = (draft: MessageEditDraft | null): MessageEditDraft | null =>
    draft
      ? {
          ...draft,
          attachments: cloneAttachments(draft.attachments),
        }
      : null

  const updateMessageEditDraft = (input: {
    attachments: MessageAttachment[]
    messageId: MessageId
    text: string
  }) => {
    const draft = getMessageEditDraft()
    if (draft?.messageId !== input.messageId) {
      return
    }

    setMessageEditDraft({
      ...draft,
      attachments: cloneAttachments(input.attachments),
      text: input.text,
    })
  }

  const restoreMessageEditDraft = (input: {
    activeEditDraft: MessageEditDraft | null
    activeEditMessageId: MessageId | null
    attachments: MessageAttachment[]
    visiblePrompt: string
  }) => {
    if (!input.activeEditMessageId) {
      return
    }

    if (input.activeEditDraft?.messageId === input.activeEditMessageId) {
      setMessageEditDraft({
        ...input.activeEditDraft,
        attachments: cloneAttachments(input.attachments),
        text: input.visiblePrompt,
      })
      return
    }

    updateMessageEditDraft({
      attachments: input.attachments,
      messageId: input.activeEditMessageId,
      text: input.visiblePrompt,
    })
  }

  const clearMessageEditDraft = () => {
    setMessageEditDraft(null)
  }

  const setLocalAttachments = (messageId: MessageId, attachments: MessageAttachment[]) => {
    const localAttachmentsByMessageId = getLocalAttachmentsMap()
    if (attachments.length === 0) {
      localAttachmentsByMessageId.delete(messageId)
      persistState()
      return
    }

    localAttachmentsByMessageId.set(messageId, cloneAttachments(attachments))
    persistState()
  }

  const clearPendingOptimisticOwnershipIfCurrent = (messageId: MessageId | null): boolean => {
    const shouldDrop = messageId != null && getPendingOptimisticMessageId() === messageId

    if (shouldDrop) {
      setPendingOptimisticOwnership(null, null)
    }

    return shouldDrop
  }

  const bindPendingOptimisticOwnership = (
    messageId: MessageId,
    ownership: PendingOptimisticOwnerSnapshot,
  ) => {
    setPendingOptimisticOwnership(messageId, ownership)
  }

  const replaceMessageId = (currentId: MessageId, nextId: MessageId) => {
    logDebug('store', 'replaceMessageId', { currentId, nextId })

    const localAttachmentsByMessageId = getLocalAttachmentsMap()
    const attachments = localAttachmentsByMessageId.get(currentId)
    if (attachments) {
      localAttachmentsByMessageId.delete(currentId)
      setLocalAttachments(nextId, attachments)
    }

    const draft = getMessageEditDraft()
    if (draft?.messageId === currentId) {
      setMessageEditDraft({
        ...draft,
        attachments: getLocalAttachments(nextId),
        messageId: nextId,
      })
    }

    const optimisticMessages = getOptimisticMessages()
    const optimisticIndex = optimisticMessages.findIndex((message) => message.id === currentId)
    if (optimisticIndex === -1) {
      if (getPendingOptimisticMessageId() === currentId) {
        setPendingOptimisticOwnership(null, null)
      }
      return
    }

    const nextOptimisticMessages = [...optimisticMessages]
    const message = nextOptimisticMessages[optimisticIndex]!
    const stableUiKey = message.uiKey ?? message.id
    nextOptimisticMessages[optimisticIndex] = {
      ...message,
      attachments: getLocalAttachments(nextId),
      id: nextId,
      uiKey: stableUiKey,
    }
    rememberStableUiKey(nextId, stableUiKey)
    setOptimisticMessages(nextOptimisticMessages)
    syncProjectedMessages({ pulse: true })

    if (getPendingOptimisticMessageId() === currentId) {
      setPendingOptimisticOwnership(null, null)
    }
  }

  const appendOptimisticUserMessage = (
    text: string,
    attachments: MessageAttachment[] = [],
  ): MessageId => {
    const token = randomUUID()
    const id = asMessageId(`tmp:${token}`)
    setLocalAttachments(id, attachments)
    const message: UiMessage = {
      id,
      uiKey: `pending-user:${token}`,
      role: 'user',
      status: 'complete',
      createdAt: nowIso(),
      text,
      attachments: getLocalAttachments(id),
      blocks: [],
      finishReason: null,
      runId: null,
      sequence: null,
    }

    setOptimisticMessages([...getOptimisticMessages(), message])
    logDebug('store', 'appendOptimisticUserMessage', summarizeMessage(message))
    syncProjectedMessages({ pulse: true })
    return id
  }

  return {
    appendOptimisticUserMessage,
    bindPendingOptimisticOwnership,
    clearMessageEditDraft,
    clearPendingOptimisticOwnershipIfCurrent,
    cloneMessageEditDraft,
    getLocalAttachments,
    replaceMessageId,
    restoreMessageEditDraft,
    setLocalAttachments,
    updateMessageEditDraft,
  }
}
