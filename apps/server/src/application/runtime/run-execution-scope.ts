import { createTenantMembershipRepository, createWorkSessionRepository } from '../persistence/repositories'
import type { RepositoryDatabase } from '../../db/repository-database'
import type { DomainError } from '../../shared/errors'
import type { TenantId, WorkSessionId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export const resolveExecutionScopeForSession = (
  db: RepositoryDatabase,
  input: {
    sessionId: WorkSessionId
    tenantId: TenantId
  },
): Result<TenantScope, DomainError> => {
  const workSessionRepository = createWorkSessionRepository(db)
  const tenantMembershipRepository = createTenantMembershipRepository(db)

  const session = workSessionRepository.findByIdForTenant(input.tenantId, input.sessionId)

  if (!session.ok) {
    return session
  }

  if (!session.value) {
    return err({
      message: `work session ${input.sessionId} not found in tenant ${input.tenantId}`,
      type: 'not_found',
    })
  }

  if (!session.value.createdByAccountId) {
    return err({
      message: `work session ${input.sessionId} has no owning account for execution scope`,
      type: 'conflict',
    })
  }

  const membership = tenantMembershipRepository.findMembership(
    session.value.createdByAccountId,
    input.tenantId,
  )

  if (!membership.ok) {
    return membership
  }

  if (!membership.value) {
    return err({
      message: `tenant membership not found for account ${session.value.createdByAccountId} in tenant ${input.tenantId}`,
      type: 'permission',
    })
  }

  return ok({
    accountId: session.value.createdByAccountId,
    role: membership.value.role,
    tenantId: input.tenantId,
  })
}
