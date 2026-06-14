import type { MessageAttachment, MessageId, ThreadId } from '@wonderlands/contracts/chat'
import type { UiMessage } from '../types'

interface ThreadMessageSyncDependencies<Lease, ThreadMessage, ThreadBudget, BudgetValue> {
  clearMessageEditDraft: () => void
  getDefaultLease: () => Lease
  getLocalAttachments: (messageId: MessageId) => MessageAttachment[]
  getMessageEditDraftMessageId: () => MessageId | null
  getPendingOptimisticMessageId: () => MessageId | null
  getThreadId: () => ThreadId | null
  getThreadLeaseCurrent: (lease: Lease, threadId: ThreadId | null) => boolean
  getThreadBudget: (threadId: ThreadId) => Promise<ThreadBudget | null>
  getLiveAssistantMessageIdState: () => MessageId | null
  getOptimisticMessages: () => UiMessage[]
  getRetainedAssistantMessages: () => UiMessage[]
  listThreadMessages: (threadId: ThreadId) => Promise<readonly ThreadMessage[] | ThreadMessage[]>
  mapThreadMessage: (message: ThreadMessage) => UiMessage
  replaceDurableMessages: (messages: UiMessage[]) => void
  setContextBudget: (budget: BudgetValue | null) => void
  setLiveAssistantMessage: (message: UiMessage | null) => void
  setLiveAssistantMessageIdState: (messageId: MessageId | null) => void
  setOptimisticMessages: (messages: UiMessage[]) => void
  setPendingOptimisticOwnership: (
    messageId: MessageId | null,
    owner: { submitId: number; viewEpoch: number } | null,
  ) => void
  setRetainedAssistantMessages: (messages: UiMessage[]) => void
  syncProjectedMessages: (options?: { pulse?: boolean }) => void
  toContextBudget: (budget: ThreadBudget) => BudgetValue
  removeLocalAttachments: (messageId: MessageId) => void
}

export const createThreadMessageSyncCoordinator = <
  Lease,
  ThreadMessage,
  ThreadBudget,
  BudgetValue,
>({
  clearMessageEditDraft,
  getDefaultLease,
  getLocalAttachments,
  getMessageEditDraftMessageId,
  getPendingOptimisticMessageId,
  getThreadId,
  getThreadBudget,
  getThreadLeaseCurrent,
  getLiveAssistantMessageIdState,
  getOptimisticMessages,
  getRetainedAssistantMessages,
  listThreadMessages,
  mapThreadMessage,
  replaceDurableMessages,
  removeLocalAttachments,
  setContextBudget,
  setLiveAssistantMessage,
  setLiveAssistantMessageIdState,
  setOptimisticMessages,
  setPendingOptimisticOwnership,
  setRetainedAssistantMessages,
  syncProjectedMessages,
  toContextBudget,
}: ThreadMessageSyncDependencies<Lease, ThreadMessage, ThreadBudget, BudgetValue>) => {
  const removeMessage = (messageId: MessageId) => {
    removeLocalAttachments(messageId)

    if (getMessageEditDraftMessageId() === messageId) {
      clearMessageEditDraft()
    }

    const optimisticMessages = getOptimisticMessages()
    const optimisticIndex = optimisticMessages.findIndex((message) => message.id === messageId)
    if (optimisticIndex >= 0) {
      const nextOptimisticMessages = [...optimisticMessages]
      nextOptimisticMessages.splice(optimisticIndex, 1)
      setOptimisticMessages(nextOptimisticMessages)
      syncProjectedMessages()
    }

    const retainedAssistantMessages = getRetainedAssistantMessages()
    const nextRetainedMessages = retainedAssistantMessages.filter(
      (message) => message.id !== messageId,
    )
    if (nextRetainedMessages.length !== retainedAssistantMessages.length) {
      setRetainedAssistantMessages(nextRetainedMessages)
      syncProjectedMessages()
    }

    if (getLiveAssistantMessageIdState() === messageId) {
      setLiveAssistantMessage(null)
      setLiveAssistantMessageIdState(null)
      syncProjectedMessages()
    }

    if (getPendingOptimisticMessageId() === messageId) {
      setPendingOptimisticOwnership(null, null)
    }
  }

  const refreshThreadMessages = async (
    threadId: ThreadId | null = getThreadId(),
    lease: Lease = getDefaultLease(),
  ) => {
    if (!threadId) {
      return
    }

    const messages = await listThreadMessages(threadId)
    if (!getThreadLeaseCurrent(lease, threadId)) {
      return
    }

    replaceDurableMessages(messages.map((message) => mapThreadMessage(message)))
  }

  const refreshThreadBudget = async (
    threadId: ThreadId | null = getThreadId(),
    lease: Lease = getDefaultLease(),
  ) => {
    if (!threadId) {
      return
    }

    const budget = await getThreadBudget(threadId)
    if (!getThreadLeaseCurrent(lease, threadId)) {
      return
    }

    setContextBudget(budget ? toContextBudget(budget) : null)
  }

  return {
    refreshThreadBudget,
    refreshThreadMessages,
    removeMessage,
  }
}
