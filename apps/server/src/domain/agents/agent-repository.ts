import type { DomainError } from '../../shared/errors'
import type { AccountId, AgentId, AgentRevisionId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { AgentKind, AgentStatus, AgentVisibility } from './agent-types'

export interface AgentRecord {
  activeRevisionId: AgentRevisionId | null
  archivedAt: string | null
  baseAgentId: AgentId | null
  createdAt: string
  createdByAccountId: AccountId | null
  id: AgentId
  kind: AgentKind
  name: string
  ownerAccountId: AccountId | null
  slug: string
  status: AgentStatus
  tenantId: TenantId
  updatedAt: string
  visibility: AgentVisibility
}

export interface CreateAgentInput {
  activeRevisionId?: AgentRevisionId | null
  baseAgentId?: AgentId | null
  createdAt: string
  createdByAccountId?: AccountId | null
  id: AgentId
  kind: AgentKind
  name: string
  ownerAccountId?: AccountId | null
  slug: string
  status: Extract<AgentStatus, 'active' | 'archived'>
  updatedAt: string
  visibility: AgentVisibility
}

export interface AssignAgentActiveRevisionInput {
  activeRevisionId: AgentRevisionId
  agentId: AgentId
  updatedAt: string
}

export interface UpdateAgentDefinitionInput {
  agentId: AgentId
  kind: AgentKind
  name: string
  ownerAccountId?: AccountId | null
  slug: string
  updatedAt: string
  visibility: AgentVisibility
}

export interface UpdateAgentStatusInput {
  agentId: AgentId
  archivedAt: string | null
  status: AgentStatus
  updatedAt: string
}

/**
 * Persistence-neutral port for agent definition storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface AgentRepository {
  assignActiveRevision: (
    scope: TenantScope,
    input: AssignAgentActiveRevisionInput,
  ) => Result<AgentRecord, DomainError>
  create: (scope: TenantScope, input: CreateAgentInput) => Result<AgentRecord, DomainError>
  getById: (scope: TenantScope, agentId: AgentId) => Result<AgentRecord, DomainError>
  getBySlug: (scope: TenantScope, slug: string) => Result<AgentRecord, DomainError>
  listByTenant: (scope: TenantScope) => Result<AgentRecord[], DomainError>
  updateDefinition: (
    scope: TenantScope,
    input: UpdateAgentDefinitionInput,
  ) => Result<AgentRecord, DomainError>
  updateStatus: (
    scope: TenantScope,
    input: UpdateAgentStatusInput,
  ) => Result<AgentRecord, DomainError>
}
