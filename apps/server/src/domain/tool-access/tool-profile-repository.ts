import type { DomainError } from '../../shared/errors'
import type { AccountId, TenantId, ToolProfileId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export type ToolProfileScope = 'account_private' | 'tenant_shared' | 'system'
export type ToolProfileStatus = 'active' | 'archived' | 'deleted'

export interface ToolProfileRecord {
  accountId: AccountId | null
  createdAt: string
  id: ToolProfileId
  name: string
  scope: ToolProfileScope
  status: ToolProfileStatus
  tenantId: TenantId
  updatedAt: string
}

export interface CreateToolProfileInput {
  accountId?: AccountId | null
  createdAt: string
  id: ToolProfileId
  name: string
  scope: ToolProfileScope
  status: ToolProfileStatus
  updatedAt: string
}

export interface UpdateToolProfileInput {
  accountId?: AccountId | null
  name?: string
  scope?: ToolProfileScope
  status?: ToolProfileStatus
  updatedAt: string
}

/**
 * Persistence-neutral port for tool profile storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface ToolProfileRepository {
  create: (
    scope: TenantScope,
    input: CreateToolProfileInput,
  ) => Result<ToolProfileRecord, DomainError>
  getById: (
    scope: TenantScope,
    toolProfileId: ToolProfileId,
  ) => Result<ToolProfileRecord, DomainError>
  listByTenant: (scope: TenantScope) => Result<ToolProfileRecord[], DomainError>
  update: (
    scope: TenantScope,
    toolProfileId: ToolProfileId,
    input: UpdateToolProfileInput,
  ) => Result<ToolProfileRecord, DomainError>
}
