export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'
export type MessageStatus = 'complete' | 'streaming' | 'waiting' | 'error'
export type MessageFinishReason = 'stop' | 'cancelled' | 'error' | 'waiting'

export const BACKEND_DEFAULT_MODEL = 'default' as const
export const BACKEND_DEFAULT_REASONING = 'default' as const
export const INLINE_MESSAGE_TEXT_LIMIT = 10_000 as const

export type ChatModel = typeof BACKEND_DEFAULT_MODEL | 'gpt-4.1' | 'gpt-5.4' | (string & {})
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type ReasoningSummary = 'auto' | 'concise' | 'detailed'
export type ChatReasoningMode = typeof BACKEND_DEFAULT_REASONING | ReasoningEffort | (string & {})

export type ProviderName = 'openai' | 'google' | 'openrouter'
export type WebSearchStatus = 'in_progress' | 'searching' | 'completed' | 'failed'
export type ThreadNamingTrigger = 'auto_first_message' | 'manual_regenerate'
export type ThreadTitleSource = 'manual' | ThreadNamingTrigger

export interface WebSearchReference {
  domain: string | null
  title: string | null
  url: string
}

export interface ToolAppsMeta {
  csp?: Record<string, unknown> | null
  permissions?: Record<string, unknown> | null
  resourceUri: string
  serverId: string
}

export interface BackendModelAlias {
  alias: string
  configured: boolean
  contextWindow: number
  isDefault: boolean
  model: string
  provider: ProviderName
  reasoningModes: ReasoningEffort[]
  supportsReasoning: boolean
}

export interface BackendReasoningMode {
  effort: ReasoningEffort
  label: string
}

export interface ReasoningOptions {
  effort: ReasoningEffort
  summary?: ReasoningSummary
}

export interface BackendModelsCatalog {
  aliases: BackendModelAlias[]
  defaultAlias: string
  defaultModel: string
  defaultProvider: ProviderName
  providers: Record<
    ProviderName,
    {
      configured: boolean
      defaultModel: string
    }
  >
  reasoningModes: BackendReasoningMode[]
}

export type BackendKernelRuntimeStatus = 'disabled' | 'pending' | 'ready' | 'unavailable'
export type BackendSandboxProvider = 'deno' | 'local_dev'
export type BackendSandboxRuntime = 'lo' | 'node'

export interface BackendSystemRuntimeStatus {
  kernel: {
    available: boolean
    checkedAt: string | null
    detail: string
    enabled: boolean
    provider: 'cloud' | 'local'
    status: BackendKernelRuntimeStatus
  }
  sandbox: {
    available: boolean
    detail: string
    provider: BackendSandboxProvider
    supportedRuntimes: BackendSandboxRuntime[]
  }
}
