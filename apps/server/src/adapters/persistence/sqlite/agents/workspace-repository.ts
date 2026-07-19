import { and, asc, eq } from 'drizzle-orm'

import { workspaces } from '../../../../db/schema'
import type { WorkspaceKind } from '../../../../domain/agents/agent-types'
import type {
  CreateWorkspaceInput,
  WorkspaceRecord,
  WorkspaceRepository,
} from '../../../../domain/agents/workspace-repository'
import type { DomainError } from '../../../../shared/errors'
import {
  type AccountId,
  asAccountId,
  asTenantId,
  asWorkspaceId,
  type WorkspaceId,
} from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import type { RepositoryDatabase } from '../repository-database'

const toWorkspaceRecord = (row: typeof workspaces.$inferSelect): WorkspaceRecord => ({
  accountId: asAccountId(row.accountId),
  createdAt: row.createdAt,
  id: asWorkspaceId(row.id),
  kind: row.kind,
  label: row.label,
  rootRef: row.rootRef,
  status: row.status,
  tenantId: asTenantId(row.tenantId),
  updatedAt: row.updatedAt,
})

export const createWorkspaceRepository = (db: RepositoryDatabase): WorkspaceRepository => {
  const getById = (
    scope: TenantScope,
    workspaceId: WorkspaceId,
  ): Result<WorkspaceRecord, DomainError> => {
    const row = db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.tenantId, scope.tenantId)))
      .get()

    if (!row) {
      return err({
        message: `workspace ${workspaceId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toWorkspaceRecord(row))
  }

  return {
    create: (
      scope: TenantScope,
      input: CreateWorkspaceInput,
    ): Result<WorkspaceRecord, DomainError> => {
      try {
        const record: WorkspaceRecord = {
          accountId: input.accountId,
          createdAt: input.createdAt,
          id: input.id,
          kind: input.kind,
          label: input.label ?? null,
          rootRef: input.rootRef,
          status: input.status,
          tenantId: scope.tenantId,
          updatedAt: input.updatedAt,
        }

        db.insert(workspaces)
          .values({
            ...record,
          })
          .run()

        return ok(record)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown workspace create failure'

        return err({
          message: `failed to create workspace ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getByAccountAndKind: (
      scope: TenantScope,
      input: {
        accountId: AccountId
        kind: WorkspaceKind
      },
    ): Result<WorkspaceRecord, DomainError> => {
      const row = db
        .select()
        .from(workspaces)
        .where(
          and(
            eq(workspaces.accountId, input.accountId),
            eq(workspaces.kind, input.kind),
            eq(workspaces.tenantId, scope.tenantId),
          ),
        )
        .orderBy(asc(workspaces.createdAt), asc(workspaces.id))
        .get()

      if (!row) {
        return err({
          message: `workspace ${input.kind} for account ${input.accountId} not found in tenant ${scope.tenantId}`,
          type: 'not_found',
        })
      }

      return ok(toWorkspaceRecord(row))
    },
    getById,
  }
}
