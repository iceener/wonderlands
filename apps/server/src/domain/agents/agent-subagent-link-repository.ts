import type { DomainError } from '../../shared/errors'
import type { AgentId, AgentRevisionId, AgentSubagentLinkId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { DelegationMode } from './agent-types'

export interface AgentSubagentLinkRecord {
  alias: string
  childAgentId: AgentId
  createdAt: string
  delegationMode: DelegationMode
  id: AgentSubagentLinkId
  parentAgentRevisionId: AgentRevisionId
  position: number
  tenantId: TenantId
}

export interface CreateAgentSubagentLinkInput {
  alias: string
  childAgentId: AgentId
  createdAt: string
  delegationMode: DelegationMode
  id: AgentSubagentLinkId
  parentAgentRevisionId: AgentRevisionId
  position?: number
}

/**
 * Persistence-neutral port for subagent delegation link storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface AgentSubagentLinkRepository {
  create: (
    scope: TenantScope,
    input: CreateAgentSubagentLinkInput,
  ) => Result<AgentSubagentLinkRecord, DomainError>
  listByParentRevisionId: (
    scope: TenantScope,
    parentAgentRevisionId: AgentRevisionId,
  ) => Result<AgentSubagentLinkRecord[], DomainError>
}
