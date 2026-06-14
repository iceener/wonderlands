import type {
  BackendAccountPreferences,
  BackendPendingWait,
  BackendThread,
  ChatModel,
  ChatReasoningMode,
  MessageAttachment,
  MessageId,
  RunId,
  SessionId,
  ThreadId,
} from '@wonderlands/contracts/chat'
import type { SubmitAgentSelection } from './commands/submit-target'
import type {
  ChatReasoningModeOption,
  ConversationTargetMode,
  MessageEditDraft,
  UiMessage,
} from './types'

type MemoryActivity = 'idle' | 'observing' | 'reflecting'

interface ContextBudget {
  actualInputTokens: number | null
  actualOutputTokens: number | null
  actualTotalTokens: number | null
  cachedInputTokens: number | null
  contextWindow?: number | null
  estimatedInputTokens: number
  liveOutputTokens: number
  liveOutputText: string
  measuredAt: string | null
  model: string | null
  provider: string | null
  reasoningTokens: number | null
  reservedOutputTokens: number | null
  stablePrefixTokens: number | null
  turn: number | null
  volatileSuffixTokens: number | null
}

interface ChatStoreFacadeDependencies {
  getActiveAgentId: () => string | null
  getActiveAgentName: () => string | null
  getAvailableModels: () => readonly ChatModel[]
  getAvailableReasoningModes: () => readonly ChatReasoningModeOption[]
  getCanCancel: () => boolean
  getCanReplyToPendingWait: () => boolean
  getChatModel: () => ChatModel
  getChatReasoningMode: () => ChatReasoningMode
  getContextBudget: () => ContextBudget | null
  getContextWindow: () => number | null
  getCurrentThreadTitle: () => string | null
  getDefaultTarget: () => BackendAccountPreferences['defaultTarget'] | null
  getDefaultTargetAgentName: () => string | null
  getError: () => string | null
  getIsCancelling: () => boolean
  getIsLoading: () => boolean
  getIsReconnecting: () => boolean
  getIsResolvingWait: () => boolean
  getIsStreaming: () => boolean
  getIsThreadNaming: () => boolean
  getIsWaiting: () => boolean
  getMemoryActivity: () => MemoryActivity
  getMessageEditDraft: () => MessageEditDraft | null
  getMessages: () => readonly Readonly<UiMessage>[]
  getPendingToolConfirmation: () => Readonly<BackendPendingWait> | null
  getResolvingWaitIds: () => ReadonlySet<string>
  getRunId: () => RunId | null
  getSessionId: () => SessionId | null
  getStreamPulse: () => number
  getTargetMode: () => ConversationTargetMode
  getThreadId: () => ThreadId | null
  getTitle: () => string
  getWaitIds: () => readonly string[]
  approvePendingWait: (waitId?: string, ownerRunId?: RunId | string) => Promise<void>
  beginMessageEdit: (messageId: MessageId | string) => boolean
  branchFromMessage: (messageId: MessageId | string) => Promise<boolean>
  cancel: () => Promise<void>
  cancelMessageEdit: () => void
  clearError: () => void
  deleteCurrentThread: () => Promise<void>
  dispose: () => void
  hydrate: (historyCount?: number) => Promise<void>
  primeFromPersistedState: () => void
  refreshAccountPreferences: () => Promise<void>
  refreshCurrentThread: () => Promise<void>
  regenerateCurrentThreadTitle: () => Promise<void>
  rejectPendingWait: (waitId?: string, ownerRunId?: RunId | string) => Promise<void>
  renameCurrentThread: (title: string) => Promise<void>
  replaceMessageAttachment: (
    messageId: MessageId | string,
    attachmentId: string,
    next: MessageAttachment,
  ) => boolean
  reset: (options?: { clearTargetSelection?: boolean }) => Promise<void>
  setChatModel: (model: ChatModel) => void
  setChatReasoningMode: (mode: ChatReasoningMode) => void
  setTargetAgent: (input: { agentId: string; agentName?: string | null }) => void
  setTargetMode: (mode: ConversationTargetMode) => void
  submit: (
    prompt: string,
    attachments?: MessageAttachment[],
    referencedFileIds?: string[],
    agentSelection?: SubmitAgentSelection,
  ) => Promise<boolean>
  switchToThread: (thread: BackendThread) => Promise<void>
  trustPendingWait: (waitId?: string, ownerRunId?: RunId | string) => Promise<void>
}

export const createChatStoreFacade = (dependencies: ChatStoreFacadeDependencies) => ({
  get activeAgentId() {
    return dependencies.getActiveAgentId()
  },
  get activeAgentName() {
    return dependencies.getActiveAgentName()
  },
  get availableModels() {
    return dependencies.getAvailableModels()
  },
  get availableReasoningModes() {
    return dependencies.getAvailableReasoningModes()
  },
  get canCancel() {
    return dependencies.getCanCancel()
  },
  get canReplyToPendingWait() {
    return dependencies.getCanReplyToPendingWait()
  },
  get chatModel() {
    return dependencies.getChatModel()
  },
  get chatReasoningMode() {
    return dependencies.getChatReasoningMode()
  },
  get contextBudget() {
    return dependencies.getContextBudget()
  },
  get contextWindow() {
    return dependencies.getContextWindow()
  },
  get currentThreadTitle() {
    return dependencies.getCurrentThreadTitle()
  },
  get defaultTarget() {
    return dependencies.getDefaultTarget()
  },
  get defaultTargetAgentName() {
    return dependencies.getDefaultTargetAgentName()
  },
  get error() {
    return dependencies.getError()
  },
  get isCancelling() {
    return dependencies.getIsCancelling()
  },
  get isLoading() {
    return dependencies.getIsLoading()
  },
  get isReconnecting() {
    return dependencies.getIsReconnecting()
  },
  get isResolvingWait() {
    return dependencies.getIsResolvingWait()
  },
  get isStreaming() {
    return dependencies.getIsStreaming()
  },
  get isThreadNaming() {
    return dependencies.getIsThreadNaming()
  },
  get isWaiting() {
    return dependencies.getIsWaiting()
  },
  get memoryActivity() {
    return dependencies.getMemoryActivity()
  },
  get messageEditDraft() {
    return dependencies.getMessageEditDraft()
  },
  get messages() {
    return dependencies.getMessages()
  },
  get pendingToolConfirmation() {
    return dependencies.getPendingToolConfirmation()
  },
  get resolvingWaitIds() {
    return dependencies.getResolvingWaitIds()
  },
  get runId() {
    return dependencies.getRunId()
  },
  get sessionId() {
    return dependencies.getSessionId()
  },
  get streamPulse() {
    return dependencies.getStreamPulse()
  },
  get targetMode() {
    return dependencies.getTargetMode()
  },
  get threadId() {
    return dependencies.getThreadId()
  },
  get title() {
    return dependencies.getTitle()
  },
  get waitIds() {
    return dependencies.getWaitIds()
  },
  approvePendingWait: dependencies.approvePendingWait,
  beginMessageEdit: dependencies.beginMessageEdit,
  branchFromMessage: dependencies.branchFromMessage,
  cancel: dependencies.cancel,
  cancelMessageEdit: dependencies.cancelMessageEdit,
  clearError: dependencies.clearError,
  deleteCurrentThread: dependencies.deleteCurrentThread,
  dispose: dependencies.dispose,
  hydrate: dependencies.hydrate,
  primeFromPersistedState: dependencies.primeFromPersistedState,
  refreshAccountPreferences: dependencies.refreshAccountPreferences,
  refreshCurrentThread: dependencies.refreshCurrentThread,
  regenerateCurrentThreadTitle: dependencies.regenerateCurrentThreadTitle,
  rejectPendingWait: dependencies.rejectPendingWait,
  renameCurrentThread: dependencies.renameCurrentThread,
  replaceMessageAttachment: dependencies.replaceMessageAttachment,
  reset: dependencies.reset,
  setChatModel: dependencies.setChatModel,
  setChatReasoningMode: dependencies.setChatReasoningMode,
  setTargetAgent: dependencies.setTargetAgent,
  setTargetMode: dependencies.setTargetMode,
  submit: dependencies.submit,
  switchToThread: dependencies.switchToThread,
  trustPendingWait: dependencies.trustPendingWait,
})
