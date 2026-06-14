import { and, eq } from 'drizzle-orm'

import { tenantMemberships, workSessions } from '../../db/schema'
import type { RepositoryDatabase } from '../../domain/database-port'
import type { DomainError } from '../../shared/errors'
import { asAccountId, type TenantId, type WorkSessionId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export const resolveExecutionScopeForSession = (
  db: RepositoryDatabase,
  input: {
    sessionId: WorkSessionId
    tenantId: TenantId
  },
): Result<TenantScope, DomainError> => {
  const session = db
    .select({
      createdByAccountId: workSessions.createdByAccountId,
    })
    .from(workSessions)
    .where(and(eq(workSessions.id, input.sessionId), eq(workSessions.tenantId, input.tenantId)))
    .get()

  if (!session) {
    return err({
      message: `work session ${input.sessionId} not found in tenant ${input.tenantId}`,
      type: 'not_found',
    })
  }

  if (!session.createdByAccountId) {
    return err({
      message: `work session ${input.sessionId} has no owning account for execution scope`,
      type: 'conflict',
    })
  }

  const membership = db
    .select({
      role: tenantMemberships.role,
    })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.accountId, session.createdByAccountId),
        eq(tenantMemberships.tenantId, input.tenantId),
      ),
    )
    .get()

  if (!membership) {
    return err({
      message: `tenant membership not found for account ${session.createdByAccountId} in tenant ${input.tenantId}`,
      type: 'permission',
    })
  }

  return ok({
    accountId: asAccountId(session.createdByAccountId),
    role: membership.role,
    tenantId: input.tenantId,
  })
}
