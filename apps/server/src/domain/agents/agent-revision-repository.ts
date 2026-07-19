import type { DomainError } from '../../shared/errors'
import type { AccountId, AgentId, AgentRevisionId, TenantId, ToolProfileId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export interface AgentRevisionRecord {
  agentId: AgentId
  checksumSha256: string
  createdAt: string
  createdByAccountId: AccountId | null
  frontmatterJson: Record<string, unknown>
  gardenFocusJson: Record<string, unknown>
  id: AgentRevisionId
  instructionsMd: string
  kernelPolicyJson: Record<string, unknown>
  memoryPolicyJson: Record<string, unknown>
  modelConfigJson: Record<string, unknown>
  resolvedConfigJson: Record<string, unknown>
  sandboxPolicyJson: Record<string, unknown>
  sourceMarkdown: string
  tenantId: TenantId
  toolProfileId: ToolProfileId | null
  toolPolicyJson: Record<string, unknown>
  version: number
  workspacePolicyJson: Record<string, unknown>
}

export interface CreateAgentRevisionInput {
  agentId: AgentId
  checksumSha256: string
  createdAt: string
  createdByAccountId?: AccountId | null
  frontmatterJson: Record<string, unknown>
  gardenFocusJson?: Record<string, unknown>
  id: AgentRevisionId
  instructionsMd: string
  kernelPolicyJson: Record<string, unknown>
  memoryPolicyJson: Record<string, unknown>
  modelConfigJson: Record<string, unknown>
  resolvedConfigJson: Record<string, unknown>
  sandboxPolicyJson: Record<string, unknown>
  sourceMarkdown: string
  toolProfileId?: ToolProfileId | null
  toolPolicyJson: Record<string, unknown>
  version: number
  workspacePolicyJson: Record<string, unknown>
}

/**
 * Persistence-neutral port for agent revision storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface AgentRevisionRepository {
  create: (
    scope: TenantScope,
    input: CreateAgentRevisionInput,
  ) => Result<AgentRevisionRecord, DomainError>
  getById: (
    scope: TenantScope,
    revisionId: AgentRevisionId,
  ) => Result<AgentRevisionRecord, DomainError>
  listByAgentId: (
    scope: TenantScope,
    agentId: AgentId,
  ) => Result<AgentRevisionRecord[], DomainError>
}
