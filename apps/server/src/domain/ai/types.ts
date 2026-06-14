export type AiProviderName = 'openai' | 'google' | 'openrouter'
export type AiProviderNativeToolName = 'web_search'
export type AiWebSearchStatus = 'in_progress' | 'searching' | 'completed' | 'failed'

export interface AiWebReference {
  domain: string | null
  title: string | null
  url: string
}

export interface AiWebSearchActivity {
  id: string
  patterns: string[]
  provider: AiProviderName
  queries: string[]
  references: AiWebReference[]
  responseId: string | null
  status: AiWebSearchStatus
  targetUrls: string[]
}

export type AiMessageRole = 'user' | 'assistant' | 'system' | 'developer' | 'tool'
export type AiAssistantPhase = 'commentary' | 'final_answer'
export type AiImageDetail = 'low' | 'high' | 'auto' | 'original'
export type AiServiceTier = 'auto' | 'default' | 'flex' | 'priority' | 'scale'
export type AiReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type AiReasoningSummary = 'auto' | 'concise' | 'detailed'

export interface AiReasoningOptions {
  effort: AiReasoningEffort
  summary?: AiReasoningSummary
}

export interface AiTextContent {
  providerSignature?: string
  thought?: boolean
  thoughtSignature?: string
  text: string
  type: 'text'
}

export interface AiImageUrlContent {
  detail?: AiImageDetail
  mimeType?: string
  type: 'image_url'
  url: string
}

export interface AiImageFileContent {
  detail?: AiImageDetail
  fileId: string
  mimeType?: string
  type: 'image_file'
}

export interface AiFileUrlContent {
  filename?: string
  mimeType?: string
  type: 'file_url'
  url: string
}

export interface AiFileIdContent {
  fileId: string
  filename?: string
  mimeType?: string
  type: 'file_id'
}

export interface AiFunctionCallContent {
  argumentsJson: string
  callId: string
  name: string
  providerSignature?: string
  thoughtSignature?: string
  type: 'function_call'
}

export interface AiFunctionResultContent {
  callId: string
  isError?: boolean
  name: string
  outputJson: string
  providerSignature?: string
  type: 'function_result'
}

export interface AiReasoningContent {
  encryptedContent?: string | null
  id: string
  providerSignature?: string
  summary: unknown
  text?: string
  thought?: boolean
  type: 'reasoning'
}

export type AiMessageContent =
  | AiTextContent
  | AiImageUrlContent
  | AiImageFileContent
  | AiFileUrlContent
  | AiFileIdContent
  | AiFunctionCallContent
  | AiFunctionResultContent
  | AiReasoningContent

export interface AiMessage {
  content: AiMessageContent[]
  phase?: AiAssistantPhase
  providerMessageId?: string
  role: AiMessageRole
}

export interface AiFunctionToolDefinition {
  description?: string
  kind: 'function'
  name: string
  parameters: Record<string, unknown>
  strict?: boolean
}

export type AiToolDefinition = AiFunctionToolDefinition
export type AiToolChoice = 'auto' | 'none' | 'required' | { name: string; type: 'function' }

export interface AiTextResponseFormat {
  type: 'text'
}

export interface AiJsonSchemaResponseFormat {
  description?: string
  name: string
  schema: Record<string, unknown>
  strict?: boolean
  type: 'json_schema'
}

export type AiResponseFormat = AiTextResponseFormat | AiJsonSchemaResponseFormat

export interface AiOpenAiRequestOptions {
  conversationId?: string
  promptCacheRetention?: 'in-memory' | '24h'
  store?: boolean
}

export interface AiGoogleRequestOptions {
  cachedContent?: string
}

export interface AiOpenRouterRequestOptions {
  plugins?: Array<Record<string, unknown>>
  provider?: Record<string, unknown>
}

export interface AiVendorOptions {
  google?: AiGoogleRequestOptions
  openai?: AiOpenAiRequestOptions
  openrouter?: AiOpenRouterRequestOptions
}

export interface AiInteractionRequest {
  abortSignal?: AbortSignal
  allowParallelToolCalls?: boolean
  executionMode?: 'foreground' | 'background'
  include?: string[]
  idempotencyKey?: string
  maxOutputTokens?: number
  maxRetries?: number
  messages: AiMessage[]
  metadata?: Record<string, string>
  model?: string
  modelAlias?: string
  provider?: AiProviderName
  reasoning?: AiReasoningOptions
  responseFormat?: AiResponseFormat
  previousResponseId?: string
  promptCacheKey?: string
  safetyIdentifier?: string
  serviceTier?: AiServiceTier
  stopSequences?: string[]
  temperature?: number
  timeoutMs?: number
  nativeTools?: AiProviderNativeToolName[]
  toolChoice?: AiToolChoice
  tools?: AiToolDefinition[]
  topP?: number
  vendorOptions?: AiVendorOptions
}

export interface ResolvedAiInteractionRequest
  extends Omit<AiInteractionRequest, 'model' | 'provider'> {
  model: string
  provider: AiProviderName
}

export interface AiModelTarget {
  model: string
  provider: AiProviderName
}

export interface AiModelRegistry {
  aliases: Record<string, AiModelTarget>
  defaultAlias: string
}

export interface AiToolCall {
  arguments: unknown | null
  argumentsJson: string
  callId: string
  name: string
  providerItemId?: string
  providerSignature?: string
  thoughtSignature?: string
}

export interface AiOutputMessageItem {
  content: AiMessageContent[]
  phase?: AiAssistantPhase
  providerMessageId?: string
  role: 'assistant'
  type: 'message'
}

export interface AiOutputFunctionCallItem extends AiToolCall {
  type: 'function_call'
}

export interface AiOutputReasoningItem {
  encryptedContent?: string | null
  id: string
  summary: unknown
  text?: string
  thought?: boolean
  type: 'reasoning'
}

export type AiOutputItem = AiOutputMessageItem | AiOutputFunctionCallItem | AiOutputReasoningItem

export interface AiUsage {
  cachedTokens?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  reasoningTokens?: number | null
  totalTokens?: number | null
}

export interface AiInteractionResponse {
  messages: AiMessage[]
  model: string
  output: AiOutputItem[]
  outputText: string
  provider: AiProviderName
  providerRequestId: string | null
  raw: unknown
  responseId: string | null
  status: 'completed' | 'in_progress' | 'failed' | 'incomplete' | 'cancelled' | 'queued'
  toolCalls: AiToolCall[]
  usage: AiUsage | null
  webSearches: AiWebSearchActivity[]
}

export interface AiCancelRequest {
  abortSignal?: AbortSignal
  background?: boolean
  provider: AiProviderName
  responseId: string
  timeoutMs?: number
}

export interface AiCancelResult {
  provider: AiProviderName
  responseId: string
  status: 'accepted' | 'cancelled' | 'not_supported' | 'client_abort_only'
}

export type AiStreamEvent =
  | {
      model: string
      provider: AiProviderName
      responseId: string | null
      type: 'response.started'
    }
  | {
      delta: string
      itemId: string
      text: string
      type: 'reasoning.summary.delta'
    }
  | {
      itemId: string
      text: string
      type: 'reasoning.summary.done'
    }
  | {
      delta: string
      type: 'text.delta'
    }
  | {
      call: AiToolCall
      type: 'tool.call'
    }
  | {
      activity: AiWebSearchActivity
      type: 'web_search'
    }
  | {
      response: AiInteractionResponse
      type: 'response.completed'
    }
