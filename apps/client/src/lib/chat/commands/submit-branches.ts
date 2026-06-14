import type {
  BackendPendingWait,
  BackendSession,
  BackendThread,
  ConversationTargetInput,
  EditThreadMessageInput,
  MessageAttachment,
  MessageId,
  ProviderName,
  ReasoningEffort,
  ThreadId,
} from '@wonderlands/contracts/chat'

interface SubmitInteractionOptions {
  model?: string
  provider?: ProviderName
  reasoning?: {
    effort: ReasoningEffort
  }
  target?: ConversationTargetInput
}

interface SubmitBranchDependencies<Lease> {
  applyThreadTitle: (thread: BackendThread) => void
  clearMessageEditDraft: () => void
  clearPendingOptimisticOwnershipIfCurrent: (messageId: MessageId | null) => boolean
  createSession: () => Promise<BackendSession>
  createSessionThread: (sessionId: BackendSession['id']) => Promise<BackendThread>
  editThreadMessage: (
    threadId: ThreadId,
    messageId: MessageId,
    input: EditThreadMessageInput,
  ) => Promise<unknown>
  getThread: (threadId: ThreadId) => Promise<BackendThread>
  pendingWaitSubmitReply: (
    input: {
      optimisticUserMessageId: MessageId | null
      text: string
      threadId: ThreadId
      wait: BackendPendingWait
    },
    viewLease: Lease,
  ) => Promise<void>
  persistState: () => void
  pruneLiveAssistantAfterThreadRefresh: () => void
  refreshThreadMessages: (threadId: ThreadId, lease: Lease) => Promise<void>
  removeLiveAssistantMessage: () => void
  removeMessage: (messageId: MessageId) => void
  resetRunState: () => void
  restoreMessageEditDraft: (input: {
    activeEditDraft: {
      activationId: string
      attachments: MessageAttachment[]
      messageId: MessageId
      text: string
    } | null
    activeEditMessageId: MessageId | null
    attachments: MessageAttachment[]
    visiblePrompt: string
  }) => void
  setError: (message: string) => void
  setLocalAttachments: (messageId: MessageId, attachments: MessageAttachment[]) => void
  setSessionId: (sessionId: BackendSession['id']) => void
  setThreadId: (threadId: ThreadId) => void
  startThreadInteraction: (input: {
    interactionInput: {
      fileIds?: string[]
      messageId?: MessageId
      metadata?: { attachments: MessageAttachment[] }
      model?: string
      provider?: ProviderName
      reasoning?: {
        effort: ReasoningEffort
      }
      target?: ConversationTargetInput
      text?: string
    }
    isCurrentSubmit: () => boolean
    optimisticUserMessageId?: MessageId | null
    threadId: ThreadId
    viewLease: Lease
  }) => Promise<boolean>
  stopActiveStream: () => Promise<void>
  streamAbortError: (error: unknown) => boolean
  toDisplayError: (error: unknown, fallback: string) => string
  updateMessageEditDraft: (input: {
    attachments: MessageAttachment[]
    messageId: MessageId
    text: string
  }) => void
}

export const createSubmitBranches = <Lease>(dependencies: SubmitBranchDependencies<Lease>) => {
  const buildBaseInteractionInput = (input: {
    attachments: MessageAttachment[]
    fileIds: string[]
    interaction: SubmitInteractionOptions
    submittedPrompt: string
  }) => ({
    ...(input.fileIds.length > 0 ? { fileIds: input.fileIds } : {}),
    ...(input.attachments.length > 0 ? { metadata: { attachments: input.attachments } } : {}),
    ...(input.interaction.model ? { model: input.interaction.model } : {}),
    ...(input.interaction.provider ? { provider: input.interaction.provider } : {}),
    ...(input.interaction.reasoning ? { reasoning: input.interaction.reasoning } : {}),
    ...(input.interaction.target ? { target: input.interaction.target } : {}),
    text: input.submittedPrompt,
  })

  const replyToPendingWait = async (input: {
    optimisticUserMessageId: MessageId | null
    submittedPrompt: string
    threadId: ThreadId
    viewLease: Lease
    wait: BackendPendingWait
  }) => {
    await dependencies.pendingWaitSubmitReply(
      {
        optimisticUserMessageId: input.optimisticUserMessageId,
        text: input.submittedPrompt,
        threadId: input.threadId,
        wait: input.wait,
      },
      input.viewLease,
    )
  }

  const rerunEditedMessage = async (input: {
    activeEditMessageId: MessageId
    attachments: MessageAttachment[]
    fileIds: string[]
    interaction: SubmitInteractionOptions
    isCurrentSubmit: () => boolean
    submittedPrompt: string
    threadId: ThreadId
    viewLease: Lease
    visiblePrompt: string
  }): Promise<boolean> => {
    dependencies.updateMessageEditDraft({
      attachments: input.attachments,
      messageId: input.activeEditMessageId,
      text: input.visiblePrompt,
    })

    await dependencies.editThreadMessage(input.threadId, input.activeEditMessageId, {
      fileIds: input.fileIds,
      ...(input.attachments.length > 0 ? { metadata: { attachments: input.attachments } } : {}),
      ...(input.submittedPrompt ? { text: input.submittedPrompt } : {}),
    })
    if (!input.isCurrentSubmit()) {
      return false
    }

    dependencies.setLocalAttachments(input.activeEditMessageId, input.attachments)
    dependencies.clearMessageEditDraft()
    await dependencies.refreshThreadMessages(input.threadId, input.viewLease)
    if (!input.isCurrentSubmit()) {
      return false
    }

    return dependencies.startThreadInteraction({
      interactionInput: {
        messageId: input.activeEditMessageId,
        ...(input.interaction.model ? { model: input.interaction.model } : {}),
        ...(input.interaction.provider ? { provider: input.interaction.provider } : {}),
        ...(input.interaction.reasoning ? { reasoning: input.interaction.reasoning } : {}),
        ...(input.interaction.target ? { target: input.interaction.target } : {}),
      },
      isCurrentSubmit: input.isCurrentSubmit,
      threadId: input.threadId,
      viewLease: input.viewLease,
    })
  }

  const startInNewThread = async (input: {
    attachments: MessageAttachment[]
    fileIds: string[]
    interaction: SubmitInteractionOptions
    isCurrentSubmit: () => boolean
    optimisticUserMessageId: MessageId | null
    onThreadReady: (threadId: ThreadId) => void
    submittedPrompt: string
    viewLease: Lease
  }): Promise<boolean> => {
    const createdSession = await dependencies.createSession()
    if (!input.isCurrentSubmit()) {
      return false
    }
    const createdThread = await dependencies.createSessionThread(createdSession.id)
    if (!input.isCurrentSubmit()) {
      return false
    }

    dependencies.setSessionId(createdSession.id)
    dependencies.setThreadId(createdThread.id)
    input.onThreadReady(createdThread.id)
    dependencies.applyThreadTitle(createdThread)
    dependencies.persistState()

    return dependencies.startThreadInteraction({
      interactionInput: buildBaseInteractionInput({
        attachments: input.attachments,
        fileIds: input.fileIds,
        interaction: input.interaction,
        submittedPrompt: input.submittedPrompt,
      }),
      isCurrentSubmit: input.isCurrentSubmit,
      optimisticUserMessageId: input.optimisticUserMessageId,
      threadId: createdThread.id,
      viewLease: input.viewLease,
    })
  }

  const startInExistingThread = async (input: {
    attachments: MessageAttachment[]
    fileIds: string[]
    interaction: SubmitInteractionOptions
    isCurrentSubmit: () => boolean
    optimisticUserMessageId: MessageId | null
    submittedPrompt: string
    threadId: ThreadId
    viewLease: Lease
  }): Promise<boolean> =>
    dependencies.startThreadInteraction({
      interactionInput: buildBaseInteractionInput({
        attachments: input.attachments,
        fileIds: input.fileIds,
        interaction: input.interaction,
        submittedPrompt: input.submittedPrompt,
      }),
      isCurrentSubmit: input.isCurrentSubmit,
      optimisticUserMessageId: input.optimisticUserMessageId,
      threadId: input.threadId,
      viewLease: input.viewLease,
    })

  const finalizeSuccess = async (input: {
    currentThreadId: ThreadId | null
    isCurrentSubmit: () => boolean
    viewLease: Lease
  }): Promise<boolean> => {
    if (!input.currentThreadId) {
      return true
    }

    const thread = await dependencies.getThread(input.currentThreadId)
    if (!input.isCurrentSubmit()) {
      return true
    }

    dependencies.applyThreadTitle(thread)
    await dependencies.refreshThreadMessages(input.currentThreadId, input.viewLease)
    if (!input.isCurrentSubmit()) {
      return true
    }

    dependencies.pruneLiveAssistantAfterThreadRefresh()
    return true
  }

  const recoverFailure = async (input: {
    activeEditDraft: {
      activationId: string
      attachments: MessageAttachment[]
      messageId: MessageId
      text: string
    } | null
    activeEditMessageId: MessageId | null
    attachments: MessageAttachment[]
    currentThreadId: ThreadId | null
    error: unknown
    optimisticUserMessageId: MessageId | null
    visiblePrompt: string
    viewLease: Lease
  }): Promise<boolean> => {
    if (!dependencies.streamAbortError(input.error)) {
      dependencies.setError(
        dependencies.toDisplayError(input.error, 'Message could not be sent. Try again.'),
      )
    }

    const shouldDropPendingOptimisticMessage =
      dependencies.clearPendingOptimisticOwnershipIfCurrent(input.optimisticUserMessageId)

    await dependencies.stopActiveStream().catch(() => undefined)
    if (input.currentThreadId) {
      await dependencies
        .refreshThreadMessages(input.currentThreadId, input.viewLease)
        .catch(() => undefined)
      dependencies.pruneLiveAssistantAfterThreadRefresh()
      if (shouldDropPendingOptimisticMessage && input.optimisticUserMessageId) {
        dependencies.removeMessage(input.optimisticUserMessageId)
      }
    } else {
      if (input.optimisticUserMessageId) {
        dependencies.removeMessage(input.optimisticUserMessageId)
      }
      dependencies.removeLiveAssistantMessage()
    }

    dependencies.restoreMessageEditDraft({
      activeEditDraft: input.activeEditDraft,
      activeEditMessageId: input.activeEditMessageId,
      attachments: input.attachments,
      visiblePrompt: input.visiblePrompt,
    })

    dependencies.resetRunState()
    dependencies.persistState()
    return false
  }

  return {
    finalizeSuccess,
    recoverFailure,
    replyToPendingWait,
    rerunEditedMessage,
    startInExistingThread,
    startInNewThread,
  }
}
