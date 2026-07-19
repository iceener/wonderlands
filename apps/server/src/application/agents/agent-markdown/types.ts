import type { AgentKind, AgentVisibility, DelegationMode } from '../../../domain/agents/agent-types'
import type { AgentId, AgentRevisionId } from '../../../shared/ids'
import type { KernelPolicyInput } from '../../kernel/kernel-policy'
import type { SandboxPolicyInput } from '../../sandbox/sandbox-policy'

export interface AgentMarkdownSubagent {
  alias: string
  mode: DelegationMode
  slug: string
}

export interface AgentMarkdownFrontmatter {
  agentId?: AgentId
  description?: string
  garden?: {
    preferredSlugs?: string[]
  }
  kind: AgentKind
  kernel?: KernelPolicyInput
  memory?: {
    childPromotion?: string
    profileScope?: boolean
  }
  model?: {
    modelAlias: string
    provider: string
    reasoning?: {
      effort: string
    }
  }
  name: string
  revisionId?: AgentRevisionId
  sandbox?: SandboxPolicyInput
  schema: 'agent/v1'
  slug: string
  subagents?: AgentMarkdownSubagent[]
  tools?: {
    mcpMode?: 'direct' | 'code'
    toolProfileId?: string | null
    native?: string[]
  }
  visibility: AgentVisibility
  workspace?: {
    strategy: string
  }
}

export interface AgentMarkdownDocument {
  frontmatter: AgentMarkdownFrontmatter
  instructionsMd: string
}
