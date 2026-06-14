import type { MessageAttachment, MessageId } from '@wonderlands/contracts/chat'
import type { SubmitConversationTargetResolution } from './submit-target'

export interface SubmitLeaseOwnership {
  submitId: number
  viewEpoch: number
}

interface SubmitLifecycleDependencies {
  appendOptimisticUserMessage: (text: string, attachments: MessageAttachment[]) => MessageId
  bindPendingOptimisticOwnership: (messageId: MessageId, ownership: SubmitLeaseOwnership) => void
  ensureStreamingAssistantShell: (createdAt: string) => void
  enterStreamingSubmitState: () => void
  prepareAssistantLaneForSubmit: () => void
  primeLiveAssistantMessageId: () => MessageId
  resetRunState: () => void
  setResolvedConversationTarget: (target: SubmitConversationTargetResolution) => void
}

export const createSubmitLifecycle = (dependencies: SubmitLifecycleDependencies) => {
  const prepare = (input: {
    activeEditMessageId: MessageId | null
    attachments: MessageAttachment[]
    createdAt: string
    replyablePendingWait: boolean
    resolvedTarget: SubmitConversationTargetResolution | null
    submitLease: SubmitLeaseOwnership
    visiblePrompt: string
    wasTerminalRun: boolean
  }): {
    optimisticUserMessageId: MessageId | null
  } => {
    const optimisticUserMessageId =
      input.activeEditMessageId == null
        ? dependencies.appendOptimisticUserMessage(input.visiblePrompt, input.attachments)
        : null

    if (optimisticUserMessageId) {
      dependencies.bindPendingOptimisticOwnership(optimisticUserMessageId, input.submitLease)
    }

    if (input.replyablePendingWait || input.resolvedTarget == null) {
      return {
        optimisticUserMessageId,
      }
    }

    dependencies.setResolvedConversationTarget(input.resolvedTarget)
    if (input.wasTerminalRun) {
      dependencies.prepareAssistantLaneForSubmit()
      dependencies.resetRunState()
    } else {
      dependencies.prepareAssistantLaneForSubmit()
    }
    dependencies.enterStreamingSubmitState()
    dependencies.primeLiveAssistantMessageId()
    dependencies.ensureStreamingAssistantShell(input.createdAt)

    return {
      optimisticUserMessageId,
    }
  }

  return {
    prepare,
  }
}
