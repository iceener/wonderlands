import type { AgentRecord } from '../../domain/agents/agent-repository'
import type { TenantRole, TenantScope } from '../../shared/scope'

export const writableTenantRoles = new Set<TenantRole>(['owner', 'admin', 'member', 'service'])

export const canReadAgent = (scope: TenantScope, agent: AgentRecord): boolean =>
  agent.visibility === 'system' ||
  agent.visibility === 'tenant_shared' ||
  agent.ownerAccountId === scope.accountId

export const canEditAgent = (scope: TenantScope, agent: AgentRecord): boolean =>
  agent.visibility !== 'system' && agent.ownerAccountId === scope.accountId

export const canWriteAgents = (role: TenantRole): boolean => writableTenantRoles.has(role)
