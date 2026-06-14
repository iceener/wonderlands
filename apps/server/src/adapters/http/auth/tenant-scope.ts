import type { RepositoryDatabase } from '../../../domain/database-port'
import { createTenantMembershipRepository } from '../../../domain/tenancy/tenant-membership-repository'
import type { DomainError } from '../../../shared/errors'
import { type AccountId, asTenantId, type TenantId } from '../../../shared/ids'
import { err, ok, type Result } from '../../../shared/result'
import type { TenantScope } from '../../../shared/scope'

export const parseTenantIdHeader = (
  value: string | undefined,
): Result<TenantId | null, DomainError> => {
  if (value === undefined) {
    return ok(null)
  }

  const tenantId = value.trim()

  if (!tenantId) {
    return err({
      message: 'x-tenant-id must not be empty',
      type: 'validation',
    })
  }

  return ok(asTenantId(tenantId))
}

export const resolveTenantScopeForAccount = (
  db: RepositoryDatabase,
  accountId: AccountId,
  tenantId: TenantId | null,
): Result<TenantScope | null, DomainError> => {
  if (!tenantId) {
    return ok(null)
  }

  const membershipRepository = createTenantMembershipRepository(db)
  const membershipResult = membershipRepository.findMembership(accountId, tenantId)

  if (!membershipResult.ok) {
    return membershipResult
  }

  const membershipRecord = membershipResult.value

  if (!membershipRecord) {
    return err({
      message: `Tenant ${tenantId} is not accessible for account ${accountId}`,
      type: 'permission',
    })
  }

  return ok({
    accountId,
    role: membershipRecord.role,
    tenantId: membershipRecord.tenantId,
  })
}
