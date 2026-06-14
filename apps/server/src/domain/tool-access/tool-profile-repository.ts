import { and, asc, eq } from 'drizzle-orm'

import { toolProfiles } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  type AccountId,
  asAccountId,
  asTenantId,
  asToolProfileId,
  type TenantId,
  type ToolProfileId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

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

const toToolProfileRecord = (row: typeof toolProfiles.$inferSelect): ToolProfileRecord => ({
  accountId: row.accountId ? asAccountId(row.accountId) : null,
  createdAt: row.createdAt,
  id: asToolProfileId(row.id),
  name: row.name,
  scope: row.scope,
  status: row.status,
  tenantId: asTenantId(row.tenantId),
  updatedAt: row.updatedAt,
})

export const createToolProfileRepository = (db: RepositoryDatabase) => {
  const getById = (
    scope: TenantScope,
    toolProfileId: ToolProfileId,
  ): Result<ToolProfileRecord, DomainError> => {
    const row = db
      .select()
      .from(toolProfiles)
      .where(and(eq(toolProfiles.id, toolProfileId), eq(toolProfiles.tenantId, scope.tenantId)))
      .get()

    if (!row) {
      return err({
        message: `tool profile ${toolProfileId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toToolProfileRecord(row))
  }

  return {
    create: (
      scope: TenantScope,
      input: CreateToolProfileInput,
    ): Result<ToolProfileRecord, DomainError> => {
      try {
        const record: ToolProfileRecord = {
          accountId: input.accountId ?? null,
          createdAt: input.createdAt,
          id: input.id,
          name: input.name,
          scope: input.scope,
          status: input.status,
          tenantId: scope.tenantId,
          updatedAt: input.updatedAt,
        }

        db.insert(toolProfiles).values(record).run()

        return ok(record)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown tool profile create failure'

        return err({
          message: `failed to create tool profile ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getById,
    update: (
      scope: TenantScope,
      toolProfileId: ToolProfileId,
      input: UpdateToolProfileInput,
    ): Result<ToolProfileRecord, DomainError> => {
      const current = getById(scope, toolProfileId)

      if (!current.ok) {
        return current
      }

      try {
        const nextRecord: ToolProfileRecord = {
          ...current.value,
          ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.scope !== undefined ? { scope: input.scope } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedAt: input.updatedAt,
        }

        db.update(toolProfiles)
          .set({
            accountId: nextRecord.accountId,
            name: nextRecord.name,
            scope: nextRecord.scope,
            status: nextRecord.status,
            updatedAt: nextRecord.updatedAt,
          })
          .where(and(eq(toolProfiles.id, toolProfileId), eq(toolProfiles.tenantId, scope.tenantId)))
          .run()

        return ok(nextRecord)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown tool profile update failure'

        return err({
          message: `failed to update tool profile ${toolProfileId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    listByTenant: (scope: TenantScope): Result<ToolProfileRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(toolProfiles)
          .where(eq(toolProfiles.tenantId, scope.tenantId))
          .orderBy(asc(toolProfiles.scope), asc(toolProfiles.name), asc(toolProfiles.id))
          .all()

        return ok(rows.map(toToolProfileRecord))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown tool profile list failure'

        return err({
          message: `failed to list tool profiles for tenant ${scope.tenantId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    toRecord: toToolProfileRecord,
  }
}
