import { and, asc, eq, inArray } from 'drizzle-orm'

import { mcpToolAssignments } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import { asTenantId, asToolProfileId, type TenantId, type ToolProfileId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

export interface McpToolAssignmentRecord {
  approvedAt: string | null
  approvedFingerprint: string | null
  createdAt: string
  id: string
  requiresConfirmation: boolean
  runtimeName: string
  serverId: string
  tenantId: TenantId
  toolProfileId: ToolProfileId
  updatedAt: string
}

export interface UpsertMcpToolAssignmentInput {
  id: string
  requiresConfirmation: boolean
  runtimeName: string
  serverId: string
  toolProfileId: ToolProfileId
  updatedAt: string
}

const toMcpToolAssignmentRecord = (
  row: typeof mcpToolAssignments.$inferSelect,
): McpToolAssignmentRecord => ({
  approvedAt: row.approvedAt,
  approvedFingerprint: row.approvedFingerprint,
  createdAt: row.createdAt,
  id: row.id,
  requiresConfirmation: row.requiresConfirmation,
  runtimeName: row.runtimeName,
  serverId: row.serverId,
  tenantId: asTenantId(row.tenantId),
  toolProfileId: asToolProfileId(row.toolProfileId),
  updatedAt: row.updatedAt,
})

export const createMcpToolAssignmentRepository = (db: RepositoryDatabase) => {
  const findByRuntimeNames = (
    scope: TenantScope,
    profile: string,
    runtimeNames: readonly string[],
  ): typeof mcpToolAssignments.$inferSelect | null => {
    const uniqueRuntimeNames = Array.from(
      new Set(runtimeNames.map((value) => value.trim()).filter((value) => value.length > 0)),
    )

    if (uniqueRuntimeNames.length === 0) {
      return null
    }

    const rows = db
      .select()
      .from(mcpToolAssignments)
      .where(
        and(
          eq(mcpToolAssignments.tenantId, scope.tenantId),
          eq(mcpToolAssignments.toolProfileId, profile),
          inArray(mcpToolAssignments.runtimeName, uniqueRuntimeNames),
        ),
      )
      .all()

    if (rows.length === 0) {
      return null
    }

    for (const runtimeName of uniqueRuntimeNames) {
      const row = rows.find((candidate) => candidate.runtimeName === runtimeName)

      if (row) {
        return row
      }
    }

    return rows[0] ?? null
  }

  const getByAnyRuntimeName = (
    scope: TenantScope,
    profile: string,
    runtimeNames: readonly string[],
  ): Result<McpToolAssignmentRecord, DomainError> => {
    const row = findByRuntimeNames(scope, profile, runtimeNames)

    if (!row) {
      return err({
        message: `MCP tool ${runtimeNames[0] ?? 'unknown'} is not assigned to profile ${profile}`,
        type: 'not_found',
      })
    }

    return ok(toMcpToolAssignmentRecord(row))
  }

  const getByRuntimeName = (
    scope: TenantScope,
    profile: string,
    runtimeName: string,
  ): Result<McpToolAssignmentRecord, DomainError> =>
    getByAnyRuntimeName(scope, profile, [runtimeName])

  return {
    approveFingerprint: (
      scope: TenantScope,
      input: {
        approvedAt: string
        fingerprint: string
        toolProfileId: ToolProfileId
        runtimeName: string
      },
    ): Result<McpToolAssignmentRecord, DomainError> => {
      try {
        const result = db
          .update(mcpToolAssignments)
          .set({
            approvedAt: input.approvedAt,
            approvedFingerprint: input.fingerprint,
            updatedAt: input.approvedAt,
          })
          .where(
            and(
              eq(mcpToolAssignments.tenantId, scope.tenantId),
              eq(mcpToolAssignments.toolProfileId, input.toolProfileId),
              eq(mcpToolAssignments.runtimeName, input.runtimeName),
            ),
          )
          .run()

        if (result.changes === 0) {
          return err({
            message: `MCP assignment ${input.runtimeName} could not be approved`,
            type: 'conflict',
          })
        }

        return getByRuntimeName(scope, input.toolProfileId, input.runtimeName)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown MCP approval failure'

        return err({
          message: `failed to approve MCP assignment ${input.runtimeName}: ${message}`,
          type: 'conflict',
        })
      }
    },
    approveFingerprintByAnyRuntimeName: (
      scope: TenantScope,
      input: {
        approvedAt: string
        fingerprint: string
        toolProfileId: ToolProfileId
        runtimeNames: string[]
      },
    ): Result<McpToolAssignmentRecord, DomainError> => {
      const existing = getByAnyRuntimeName(scope, input.toolProfileId, input.runtimeNames)

      if (!existing.ok) {
        return existing
      }

      try {
        const result = db
          .update(mcpToolAssignments)
          .set({
            approvedAt: input.approvedAt,
            approvedFingerprint: input.fingerprint,
            updatedAt: input.approvedAt,
          })
          .where(
            and(
              eq(mcpToolAssignments.id, existing.value.id),
              eq(mcpToolAssignments.tenantId, scope.tenantId),
            ),
          )
          .run()

        if (result.changes === 0) {
          return err({
            message: `MCP assignment ${input.runtimeNames[0] ?? 'unknown'} could not be approved`,
            type: 'conflict',
          })
        }

        return getByAnyRuntimeName(scope, input.toolProfileId, input.runtimeNames)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown MCP approval failure'

        return err({
          message: `failed to approve MCP assignment ${input.runtimeNames[0] ?? 'unknown'}: ${message}`,
          type: 'conflict',
        })
      }
    },
    deleteByServerId: (scope: TenantScope, serverId: string): Result<number, DomainError> => {
      try {
        const result = db
          .delete(mcpToolAssignments)
          .where(
            and(
              eq(mcpToolAssignments.tenantId, scope.tenantId),
              eq(mcpToolAssignments.serverId, serverId),
            ),
          )
          .run()

        return ok(result.changes)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown MCP assignment delete failure'

        return err({
          message: `failed to delete MCP assignments for server ${serverId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    deleteByRuntimeName: (
      scope: TenantScope,
      profile: string,
      runtimeName: string,
    ): Result<McpToolAssignmentRecord, DomainError> => {
      const existing = getByRuntimeName(scope, profile, runtimeName)

      if (!existing.ok) {
        return existing
      }

      try {
        const result = db
          .delete(mcpToolAssignments)
          .where(
            and(
              eq(mcpToolAssignments.id, existing.value.id),
              eq(mcpToolAssignments.tenantId, scope.tenantId),
            ),
          )
          .run()

        if (result.changes === 0) {
          return err({
            message: `MCP assignment ${runtimeName} could not be deleted`,
            type: 'conflict',
          })
        }

        return ok(existing.value)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown MCP assignment delete failure'

        return err({
          message: `failed to delete MCP assignment ${runtimeName}: ${message}`,
          type: 'conflict',
        })
      }
    },
    deleteByAnyRuntimeName: (
      scope: TenantScope,
      profile: string,
      runtimeNames: string[],
    ): Result<McpToolAssignmentRecord, DomainError> => {
      const existing = getByAnyRuntimeName(scope, profile, runtimeNames)

      if (!existing.ok) {
        return existing
      }

      try {
        const result = db
          .delete(mcpToolAssignments)
          .where(
            and(
              eq(mcpToolAssignments.id, existing.value.id),
              eq(mcpToolAssignments.tenantId, scope.tenantId),
            ),
          )
          .run()

        if (result.changes === 0) {
          return err({
            message: `MCP assignment ${runtimeNames[0] ?? 'unknown'} could not be deleted`,
            type: 'conflict',
          })
        }

        return ok(existing.value)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown MCP assignment delete failure'

        return err({
          message: `failed to delete MCP assignment ${runtimeNames[0] ?? 'unknown'}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getByAnyRuntimeName,
    getByRuntimeName,
    listByProfile: (
      scope: TenantScope,
      profile: string,
    ): Result<McpToolAssignmentRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(mcpToolAssignments)
          .where(
            and(
              eq(mcpToolAssignments.tenantId, scope.tenantId),
              eq(mcpToolAssignments.toolProfileId, profile),
            ),
          )
          .orderBy(asc(mcpToolAssignments.runtimeName), asc(mcpToolAssignments.id))
          .all()

        return ok(rows.map(toMcpToolAssignmentRecord))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown MCP assignment list failure'

        return err({
          message: `failed to list MCP assignments for profile ${profile}: ${message}`,
          type: 'conflict',
        })
      }
    },
    upsert: (
      scope: TenantScope,
      input: UpsertMcpToolAssignmentInput,
    ): Result<McpToolAssignmentRecord, DomainError> => {
      try {
        const existing = db
          .select()
          .from(mcpToolAssignments)
          .where(
            and(
              eq(mcpToolAssignments.tenantId, scope.tenantId),
              eq(mcpToolAssignments.toolProfileId, input.toolProfileId),
              eq(mcpToolAssignments.runtimeName, input.runtimeName),
            ),
          )
          .get()

        if (existing) {
          db.update(mcpToolAssignments)
            .set({
              requiresConfirmation: input.requiresConfirmation,
              serverId: input.serverId,
              updatedAt: input.updatedAt,
            })
            .where(
              and(
                eq(mcpToolAssignments.id, existing.id),
                eq(mcpToolAssignments.tenantId, scope.tenantId),
              ),
            )
            .run()

          return ok(
            toMcpToolAssignmentRecord({
              ...existing,
              requiresConfirmation: input.requiresConfirmation,
              serverId: input.serverId,
              updatedAt: input.updatedAt,
            }),
          )
        }

        const record: McpToolAssignmentRecord = {
          approvedAt: null,
          approvedFingerprint: null,
          createdAt: input.updatedAt,
          id: input.id,
          requiresConfirmation: input.requiresConfirmation,
          runtimeName: input.runtimeName,
          serverId: input.serverId,
          tenantId: scope.tenantId,
          toolProfileId: input.toolProfileId,
          updatedAt: input.updatedAt,
        }

        db.insert(mcpToolAssignments)
          .values({
            approvedAt: record.approvedAt,
            approvedFingerprint: record.approvedFingerprint,
            createdAt: record.createdAt,
            id: record.id,
            requiresConfirmation: record.requiresConfirmation,
            runtimeName: record.runtimeName,
            serverId: record.serverId,
            tenantId: record.tenantId,
            toolProfileId: record.toolProfileId,
            updatedAt: record.updatedAt,
          })
          .run()

        return ok(record)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown MCP assignment upsert failure'

        return err({
          message: `failed to upsert MCP assignment ${input.runtimeName}: ${message}`,
          type: 'conflict',
        })
      }
    },
  }
}
