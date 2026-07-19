import type { DomainError } from '../../shared/errors'
import type { AccountId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantRole, TenantScope } from '../../shared/scope'

export interface TenantMembershipRecord {
  accountId: AccountId
  createdAt: string
  id: string
  role: TenantRole
  tenantId: TenantId
}

export interface TenantMembershipSummary extends TenantMembershipRecord {
  tenantName: string
  tenantSlug: string
}

/**
 * Persistence-neutral port for tenant membership storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface TenantMembershipRepository {
  findMembership: (
    accountId: AccountId,
    tenantId: TenantId,
  ) => Result<TenantMembershipRecord | null, DomainError>
  listByAccountId: (accountId: AccountId) => Result<TenantMembershipSummary[], DomainError>
  requireMembership: (scope: TenantScope) => Result<TenantMembershipRecord, DomainError>
}
