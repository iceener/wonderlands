import type {
  BackendModelsCatalog,
  BackendPendingWait,
  BackendRun,
  ChatModel,
  ChatReasoningMode,
  MessageAttachment,
  MessageId,
  ThreadId,
} from '@wonderlands/contracts/chat'
import type { ConversationTargetMode } from '../types'
import { normalizeSubmitInput, resolveSubmitPreflight } from './submit-preflight'
import {
  buildSubmitInteractionOptions,
  resolveSubmitConversationTarget,
  type SubmitAgentSelection,
} from './submit-target'

interface SubmitEditDraft {
  activationId: string
  attachments: MessageAttachment[]
  messageId: MessageId
  text: string
}

interface SubmitStateSnapshot {
  activeAgentId: string | null
  activeAgentName: string | null
  activeEditDraft: SubmitEditDraft | null
  activeEditMessageId: MessageId | null
  chatModel: ChatModel
  chatReasoningMode: ChatReasoningMode
  isLoading: boolean
  isStreaming: boolean
  isWaiting: boolean
  modelsCatalog: BackendModelsCatalog | null
  runStatus: BackendRun['status'] | null
  targetMode: ConversationTargetMode
  threadId: ThreadId | null
}

interface SubmitLifecycleInput<SubmitLease> {
  activeEditMessageId: MessageId | null
  attachments: MessageAttachment[]
  createdAt: string
  replyablePendingWait: boolean
  resolvedTarget: {
    nextActiveAgentId: string | null
    nextActiveAgentName: string | null
    nextTargetMode: ConversationTargetMode
    target?: Parameters<typeof buildSubmitInteractionOptions>[0]['target']
  } | null
  submitLease: SubmitLease
  visiblePrompt: string
  wasTerminalRun: boolean
}

interface SubmitCommandDependencies<ViewLease, SubmitLease> {
  beginSubmitLease: () => SubmitLease
  buildViewLease: (submitLease: SubmitLease) => ViewLease
  defaultModelValue: ChatModel
  defaultReasoningValue: ChatReasoningMode
  finalizeCurrentSubmitState: (submitStillCurrent: boolean) => void
  getReplyablePendingWait: () => BackendPendingWait | null
  getStateSnapshot: () => SubmitStateSnapshot
  isSubmitLeaseCurrent: (submitLease: SubmitLease) => boolean
  logSubmitStart: (input: {
    activeEditMessageId: MessageId | null
    attachmentCount: number
    promptLength: number
    threadId: ThreadId | null
  }) => void
  nowIso: () => string
  prepareSubmitLifecycle: (input: SubmitLifecycleInput<SubmitLease>) => {
    optimisticUserMessageId: MessageId | null
  }
  recoverSubmitFailure: (input: {
    activeEditDraft: SubmitEditDraft | null
    activeEditMessageId: MessageId | null
    attachments: MessageAttachment[]
    currentThreadId: ThreadId | null
    error: unknown
    optimisticUserMessageId: MessageId | null
    viewLease: ViewLease
    visiblePrompt: string
  }) => Promise<boolean>
  releaseSubmitLease: (submitLease: SubmitLease) => void
  replyToPendingWait: (input: {
    optimisticUserMessageId: MessageId | null
    submittedPrompt: string
    threadId: ThreadId
    viewLease: ViewLease
    wait: BackendPendingWait
  }) => Promise<void>
  rerunEditedMessage: (input: {
    activeEditMessageId: MessageId
    attachments: MessageAttachment[]
    fileIds: string[]
    interaction: ReturnType<typeof buildSubmitInteractionOptions>
    isCurrentSubmit: () => boolean
    submittedPrompt: string
    threadId: ThreadId
    viewLease: ViewLease
    visiblePrompt: string
  }) => Promise<boolean>
  setError: (message: string | null) => void
  shouldTreatRunStatusAsTerminal: (status: BackendRun['status'] | null) => boolean
  startInExistingThread: (input: {
    attachments: MessageAttachment[]
    fileIds: string[]
    interaction: ReturnType<typeof buildSubmitInteractionOptions>
    isCurrentSubmit: () => boolean
    optimisticUserMessageId: MessageId | null
    submittedPrompt: string
    threadId: ThreadId
    viewLease: ViewLease
  }) => Promise<boolean>
  startInNewThread: (input: {
    attachments: MessageAttachment[]
    fileIds: string[]
    interaction: ReturnType<typeof buildSubmitInteractionOptions>
    isCurrentSubmit: () => boolean
    optimisticUserMessageId: MessageId | null
    onThreadReady: (threadId: ThreadId) => void
    submittedPrompt: string
    viewLease: ViewLease
  }) => Promise<boolean>
  submitFinalizeSuccess: (input: {
    currentThreadId: ThreadId | null
    isCurrentSubmit: () => boolean
    viewLease: ViewLease
  }) => Promise<boolean>
}

export const createSubmitCommand = <ViewLease, SubmitLease>({
  beginSubmitLease,
  buildViewLease,
  defaultModelValue,
  defaultReasoningValue,
  finalizeCurrentSubmitState,
  getReplyablePendingWait,
  getStateSnapshot,
  isSubmitLeaseCurrent,
  logSubmitStart,
  nowIso,
  prepareSubmitLifecycle,
  recoverSubmitFailure,
  releaseSubmitLease,
  replyToPendingWait,
  rerunEditedMessage,
  setError,
  shouldTreatRunStatusAsTerminal,
  startInExistingThread,
  startInNewThread,
  submitFinalizeSuccess,
}: SubmitCommandDependencies<ViewLease, SubmitLease>) => {
  const submit = async (
    prompt: string,
    attachments: MessageAttachment[] = [],
    referencedFileIds: string[] = [],
    agentSelection?: SubmitAgentSelection,
  ): Promise<boolean> => {
    const initialState = getStateSnapshot()

    logSubmitStart({
      activeEditMessageId: initialState.activeEditMessageId,
      attachmentCount: attachments.length,
      promptLength: prompt.length,
      threadId: initialState.threadId,
    })

    const { fileIds, submittedPrompt, visiblePrompt } = normalizeSubmitInput(
      prompt,
      attachments,
      referencedFileIds,
    )
    const replyablePendingWait = initialState.isWaiting ? getReplyablePendingWait() : null

    const preflight = resolveSubmitPreflight({
      activeEditMessageId: initialState.activeEditMessageId,
      fileIds,
      isLoading: initialState.isLoading,
      isStreaming: initialState.isStreaming,
      isWaiting: initialState.isWaiting,
      replyablePendingWait,
      submittedPrompt,
      threadId: initialState.threadId,
    })
    if (!preflight.ok) {
      if (preflight.error) {
        setError(preflight.error)
      }
      return false
    }

    let conversationTarget: ReturnType<typeof resolveSubmitConversationTarget> | null = null
    if (!replyablePendingWait) {
      conversationTarget = resolveSubmitConversationTarget({
        activeAgentId: initialState.activeAgentId,
        activeAgentName: initialState.activeAgentName,
        agentSelection,
        targetMode: initialState.targetMode,
      })

      if (!conversationTarget.ok) {
        setError(conversationTarget.error)
        return false
      }
    }

    setError(null)
    const submitLease = beginSubmitLease()
    const viewLease = buildViewLease(submitLease)
    const isCurrentSubmit = (): boolean => isSubmitLeaseCurrent(submitLease)
    let currentThreadId: ThreadId | null = initialState.threadId
    const { optimisticUserMessageId } = prepareSubmitLifecycle({
      activeEditMessageId: initialState.activeEditMessageId,
      attachments,
      createdAt: nowIso(),
      replyablePendingWait: replyablePendingWait !== null,
      resolvedTarget: conversationTarget?.ok ? conversationTarget.value : null,
      submitLease,
      visiblePrompt,
      wasTerminalRun: shouldTreatRunStatusAsTerminal(initialState.runStatus),
    })

    const interactionOptions = conversationTarget?.ok
      ? buildSubmitInteractionOptions({
          chatModel: initialState.chatModel,
          chatReasoningMode: initialState.chatReasoningMode,
          defaultModelValue,
          defaultReasoningValue,
          modelsCatalog: initialState.modelsCatalog,
          target: conversationTarget.value.target,
        })
      : null

    try {
      if (replyablePendingWait && initialState.threadId) {
        currentThreadId = initialState.threadId
        await replyToPendingWait({
          optimisticUserMessageId,
          submittedPrompt,
          threadId: initialState.threadId,
          viewLease,
          wait: replyablePendingWait,
        })
        if (!isCurrentSubmit()) {
          return true
        }
      } else if (initialState.activeEditMessageId && initialState.threadId && interactionOptions) {
        const threadId = initialState.threadId
        currentThreadId = threadId
        const didCompleteInteraction = await rerunEditedMessage({
          activeEditMessageId: initialState.activeEditMessageId,
          attachments,
          fileIds,
          interaction: interactionOptions,
          isCurrentSubmit,
          submittedPrompt,
          threadId,
          viewLease,
          visiblePrompt,
        })
        if (!didCompleteInteraction) {
          return true
        }
      } else if (!initialState.threadId && interactionOptions) {
        const didCompleteInteraction = await startInNewThread({
          attachments,
          fileIds,
          interaction: interactionOptions,
          isCurrentSubmit,
          optimisticUserMessageId,
          onThreadReady(threadId) {
            currentThreadId = threadId
          },
          submittedPrompt,
          viewLease,
        })
        if (!didCompleteInteraction) {
          return true
        }
      } else if (initialState.threadId && interactionOptions) {
        const threadId = initialState.threadId
        currentThreadId = threadId
        const didCompleteInteraction = await startInExistingThread({
          attachments,
          fileIds,
          interaction: interactionOptions,
          isCurrentSubmit,
          optimisticUserMessageId,
          submittedPrompt,
          threadId,
          viewLease,
        })
        if (!didCompleteInteraction) {
          return true
        }
      } else {
        return false
      }

      await submitFinalizeSuccess({
        currentThreadId,
        isCurrentSubmit,
        viewLease,
      })
      return true
    } catch (error) {
      if (!isCurrentSubmit()) {
        return true
      }

      return recoverSubmitFailure({
        activeEditDraft: initialState.activeEditDraft,
        activeEditMessageId: initialState.activeEditMessageId,
        attachments,
        currentThreadId,
        error,
        optimisticUserMessageId,
        viewLease,
        visiblePrompt,
      })
    } finally {
      const submitStillCurrent = isCurrentSubmit()
      releaseSubmitLease(submitLease)
      finalizeCurrentSubmitState(submitStillCurrent)
    }
  }

  return {
    submit,
  }
}
