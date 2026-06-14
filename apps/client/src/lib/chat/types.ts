import type {
  BackendAccountPreferences,
  BackendModelsCatalog,
  Block,
  ChatModel,
  ChatReasoningMode,
  MessageAttachment,
  MessageFinishReason,
  MessageId,
  MessageRole,
  MessageStatus,
  RunId,
} from '@wonderlands/contracts/chat'

export interface UiMessage {
  id: MessageId
  uiKey?: string
  role: MessageRole
  status: MessageStatus
  createdAt: string
  text: string
  attachments: MessageAttachment[]
  blocks: Block[]
  finishReason: MessageFinishReason | null
  runId: RunId | null
  sequence: number | null
}

export interface MessageEditDraft {
  activationId: string
  attachments: MessageAttachment[]
  messageId: MessageId
  text: string
}

export interface ContextBudget {
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

export interface RunTranscriptSources {
  durableMessage: boolean
  durableSnapshot: boolean
  liveStream: boolean
  localCache: boolean
}

export interface RunTranscriptState {
  attachments: MessageAttachment[]
  blocks: Block[]
  createdAt: string
  finishReason: MessageFinishReason | null
  messageId: MessageId | null
  runId: RunId
  sequence: number | null
  sources: RunTranscriptSources
  status: MessageStatus
  text: string
}

export type ConversationTargetMode = 'default' | 'assistant' | 'agent'

export interface ChatReasoningModeOption {
  id: ChatReasoningMode
  label: string
}

export interface ChatPreferencesState {
  activeAgentId: string | null
  activeAgentName: string | null
  availableModels: readonly ChatModel[]
  availableReasoningModes: readonly ChatReasoningModeOption[]
  chatModel: ChatModel
  chatReasoningMode: ChatReasoningMode
  contextWindow: number | null
  defaultTarget: BackendAccountPreferences['defaultTarget'] | null
  defaultTargetAgentName: string | null
  modelsCatalog: BackendModelsCatalog | null
  targetMode: ConversationTargetMode
}

export interface PersistedRunTranscriptState {
  attachments: MessageAttachment[]
  blocks: Block[]
  createdAt: string
  finishReason: MessageFinishReason | null
  messageId: MessageId | null
  runId: RunId
  sequence: number | null
  status: MessageStatus
  text: string
}
