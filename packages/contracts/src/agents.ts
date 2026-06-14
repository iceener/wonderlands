import type { AgentId, ToolProfileId } from './ids'
import type { ProviderName, ReasoningEffort } from './shared'

export type AgentKind = 'primary' | 'specialist' | 'derived'
export type AgentStatus = 'active' | 'archived' | 'deleted'
export type AgentVisibility = 'account_private' | 'tenant_shared' | 'system'
export type ToolProfileScope = 'account_private' | 'tenant_shared' | 'system'
export type ToolProfileStatus = 'active' | 'archived' | 'deleted'

export interface AgentReasoningConfigInput {
  effort: ReasoningEffort
}

export interface AgentModelConfigInput {
  modelAlias: string
  provider: ProviderName
  reasoning?: AgentReasoningConfigInput
}

export interface AgentToolsConfigInput {
  mcpMode?: 'direct' | 'code'
  toolProfileId?: ToolProfileId | string | null
  native?: string[]
}

export interface AgentGardenConfigInput {
  preferredSlugs?: string[]
}

export interface AgentSandboxConfigInput {
  enabled?: boolean
  network?: {
    allowedHosts?: string[]
    mode?: 'off' | 'allow_list' | 'open'
  }
  packages?: {
    allowedPackages?: Array<{
      allowInstallScripts?: boolean
      name: string
      runtimes?: Array<'lo' | 'node'>
      versionRange: string
    }>
    allowedRegistries?: string[]
    mode?: 'disabled' | 'allow_list' | 'open'
  }
  runtime?: {
    allowAutomaticCompatFallback?: boolean
    allowedEngines?: Array<'lo' | 'node'>
    allowWorkspaceScripts?: boolean
    defaultEngine?: 'lo' | 'node'
    maxDurationSec?: number
    maxInputBytes?: number
    maxMemoryMb?: number
    maxOutputBytes?: number
    nodeVersion?: string
  }
  shell?: {
    allowedCommands?: string[]
  }
  vault?: {
    allowedRoots?: string[]
    mode?: 'none' | 'read_only' | 'read_write'
    requireApprovalForDelete?: boolean
    requireApprovalForMove?: boolean
    requireApprovalForWorkspaceScript?: boolean
    requireApprovalForWrite?: boolean
  }
}

export interface AgentKernelConfigInput {
  browser?: {
    allowRecording?: boolean
    defaultViewport?: {
      height: number
      width: number
    }
    maxConcurrentSessions?: number
    maxDurationSec?: number
  }
  enabled?: boolean
  network?: {
    allowedHosts?: string[]
    blockedHosts?: string[]
    mode?: 'off' | 'allow_list' | 'open'
  }
  outputs?: {
    allowCookies?: boolean
    allowHtml?: boolean
    allowPdf?: boolean
    allowRecording?: boolean
    allowScreenshot?: boolean
    maxOutputBytes?: number
  }
}

export type ConversationTargetInput =
  | {
      kind: 'assistant'
    }
  | {
      agentId: AgentId | string
      kind: 'agent'
    }

export type DefaultConversationTarget =
  | {
      kind: 'assistant'
    }
  | {
      agentId: AgentId
      kind: 'agent'
    }

export type ShortcutBindings = Record<string, string | null>

export interface BackendAccountPreferences {
  accountId: string
  assistantToolProfileId: ToolProfileId
  defaultTarget: DefaultConversationTarget
  shortcutBindings: ShortcutBindings
  updatedAt: string
}

export interface BackendToolProfile {
  accountId: string | null
  createdAt: string
  id: ToolProfileId
  name: string
  scope: ToolProfileScope
  status: ToolProfileStatus
  tenantId: string
  updatedAt: string
}

export interface CreateToolProfileInput {
  name: string
  scope: Extract<ToolProfileScope, 'account_private' | 'tenant_shared'>
}

export interface UpdateToolProfileInput {
  name?: string
  scope?: Extract<ToolProfileScope, 'account_private' | 'tenant_shared'>
  status?: Extract<ToolProfileStatus, 'active' | 'archived'>
}

export interface UpdateAccountPreferencesInput {
  assistantToolProfileId?: ToolProfileId | string
  defaultTarget?: ConversationTargetInput
  shortcutBindings?: ShortcutBindings
}

export interface AgentSubagentConfigInput {
  alias: string
  mode: 'async_join'
  slug: string
}

export interface CreateAgentApiInput {
  description?: string
  garden?: AgentGardenConfigInput
  instructionsMd: string
  kind: AgentKind
  kernel?: AgentKernelConfigInput
  model?: AgentModelConfigInput
  name: string
  sandbox?: AgentSandboxConfigInput
  slug: string
  subagents?: AgentSubagentConfigInput[]
  tools?: AgentToolsConfigInput
  visibility: AgentVisibility
}

export interface UpdateAgentApiInput extends CreateAgentApiInput {
  revisionId: string
}

export interface BackendAgentSummary {
  activeRevisionId: string | null
  activeRevisionVersion: number | null
  createdAt: string
  description: string | null
  id: AgentId
  isDefaultForAccount: boolean
  kind: AgentKind
  name: string
  ownerAccountId: string | null
  slug: string
  status: AgentStatus
  updatedAt: string
  visibility: AgentVisibility
}

export interface BackendAgentDetail extends BackendAgentSummary {
  activeRevision: null | {
    checksumSha256: string
    createdAt: string
    createdByAccountId?: string | null
    frontmatterJson?: Record<string, unknown>
    gardenFocusJson?: Record<string, unknown>
    id: string
    instructionsMd: string
    kernelPolicyJson?: Record<string, unknown>
    memoryPolicyJson?: Record<string, unknown>
    modelConfigJson: Record<string, unknown>
    resolvedConfigJson?: Record<string, unknown>
    sandboxPolicyJson?: Record<string, unknown>
    sourceMarkdown: string
    toolProfileId?: ToolProfileId | null
    toolPolicyJson: Record<string, unknown>
    version: number
    workspacePolicyJson?: Record<string, unknown>
  }
  subagents: Array<{
    alias: string
    childAgentId: AgentId
    childDescription: string | null
    childName: string
    childSlug: string
    delegationMode: string
    position: number
  }>
}
