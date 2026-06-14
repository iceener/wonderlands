import { and, eq } from 'drizzle-orm'

import { tenantMemberships, tenants } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import { type AccountId, asAccountId, asTenantId, type TenantId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantRole, TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

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

const toTenantMembershipRecord = (
  membershipRow: typeof tenantMemberships.$inferSelect,
): TenantMembershipRecord => ({
  accountId: asAccountId(membershipRow.accountId),
  createdAt: membershipRow.createdAt,
  id: membershipRow.id,
  role: membershipRow.role,
  tenantId: asTenantId(membershipRow.tenantId),
})

export const createTenantMembershipRepository = (db: RepositoryDatabase) => ({
  listByAccountId: (accountId: AccountId): Result<TenantMembershipSummary[], DomainError> => {
    try {
      const membershipRows = db
        .select({
          accountId: tenantMemberships.accountId,
          createdAt: tenantMemberships.createdAt,
          id: tenantMemberships.id,
          role: tenantMemberships.role,
          tenantId: tenantMemberships.tenantId,
          tenantName: tenants.name,
          tenantSlug: tenants.slug,
        })
        .from(tenantMemberships)
        .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
        .where(eq(tenantMemberships.accountId, accountId))
        .all()

      return ok(
        membershipRows.map((membershipRow) => ({
          ...toTenantMembershipRecord(membershipRow),
          tenantName: membershipRow.tenantName,
          tenantSlug: membershipRow.tenantSlug,
        })),
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown tenant membership list failure'

      return err({
        message: `failed to list tenant memberships for account ${accountId}: ${message}`,
        type: 'conflict',
      })
    }
  },

  findMembership: (
    accountId: AccountId,
    tenantId: TenantId,
  ): Result<TenantMembershipRecord | null, DomainError> => {
    const membershipRecord = db
      .select()
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.accountId, accountId), eq(tenantMemberships.tenantId, tenantId)),
      )
      .get()

    return ok(membershipRecord ? toTenantMembershipRecord(membershipRecord) : null)
  },
  requireMembership: (scope: TenantScope): Result<TenantMembershipRecord, DomainError> => {
    const membership = db
      .select()
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.accountId, scope.accountId),
          eq(tenantMemberships.tenantId, scope.tenantId),
          eq(tenantMemberships.role, scope.role),
        ),
      )
      .get()

    if (!membership) {
      return err({
        message: `tenant membership not found for account ${scope.accountId} in tenant ${scope.tenantId}`,
        type: 'permission',
      })
    }

    return ok(toTenantMembershipRecord(membership))
  },
  toRecord: toTenantMembershipRecord,
})
