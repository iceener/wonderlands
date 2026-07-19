import { and, asc, eq } from 'drizzle-orm'

import { sandboxWritebackOperations } from '../../../../db/schema'
import type {
  CreateSandboxWritebackOperationInput,
  SandboxWritebackOperationRecord,
  SandboxWritebackRepository,
  UpdateSandboxWritebackOperationInput,
} from '../../../../domain/sandbox/sandbox-writeback-repository'
import type { DomainError } from '../../../../shared/errors'
import {
  asAccountId,
  asSandboxExecutionId,
  asSandboxWritebackOperationId,
  asTenantId,
  type SandboxExecutionId,
} from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import type { RepositoryDatabase } from '../repository-database'

const toRecord = (
  row: typeof sandboxWritebackOperations.$inferSelect,
): SandboxWritebackOperationRecord => ({
  appliedAt: row.appliedAt,
  approvedAt: row.approvedAt,
  approvedByAccountId: row.approvedByAccountId ? asAccountId(row.approvedByAccountId) : null,
  createdAt: row.createdAt,
  errorText: row.errorText,
  id: asSandboxWritebackOperationId(row.id),
  operation: row.operation,
  requiresApproval: row.requiresApproval,
  sandboxExecutionId: asSandboxExecutionId(row.sandboxExecutionId),
  sourceSandboxPath: row.sourceSandboxPath,
  status: row.status,
  targetVaultPath: row.targetVaultPath,
  tenantId: asTenantId(row.tenantId),
})

export const createSandboxWritebackRepository = (
  db: RepositoryDatabase,
): SandboxWritebackRepository => ({
  create: (
    scope: TenantScope,
    input: CreateSandboxWritebackOperationInput,
  ): Result<SandboxWritebackOperationRecord, DomainError> => {
    try {
      const record: SandboxWritebackOperationRecord = {
        appliedAt: null,
        approvedAt: null,
        approvedByAccountId: null,
        createdAt: input.createdAt,
        errorText: null,
        id: input.id,
        operation: input.operation,
        requiresApproval: input.requiresApproval ?? true,
        sandboxExecutionId: input.sandboxExecutionId,
        sourceSandboxPath: input.sourceSandboxPath,
        status: input.status,
        targetVaultPath: input.targetVaultPath,
        tenantId: scope.tenantId,
      }

      db.insert(sandboxWritebackOperations)
        .values({ ...record })
        .run()

      return ok(record)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown sandbox writeback create failure'

      return err({
        message: `failed to create sandbox writeback operation ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listBySandboxExecutionId: (
    scope: TenantScope,
    sandboxExecutionId: SandboxExecutionId,
  ): Result<SandboxWritebackOperationRecord[], DomainError> => {
    try {
      const rows = db
        .select()
        .from(sandboxWritebackOperations)
        .where(
          and(
            eq(sandboxWritebackOperations.sandboxExecutionId, sandboxExecutionId),
            eq(sandboxWritebackOperations.tenantId, scope.tenantId),
          ),
        )
        .orderBy(asc(sandboxWritebackOperations.createdAt), asc(sandboxWritebackOperations.id))
        .all()

      return ok(rows.map(toRecord))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown sandbox writeback list failure'

      return err({
        message: `failed to list sandbox writeback operations for execution ${sandboxExecutionId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  update: (
    scope: TenantScope,
    input: UpdateSandboxWritebackOperationInput,
  ): Result<SandboxWritebackOperationRecord, DomainError> => {
    try {
      const patch: Partial<typeof sandboxWritebackOperations.$inferInsert> = {}

      if (input.appliedAt !== undefined) {
        patch.appliedAt = input.appliedAt
      }
      if (input.approvedAt !== undefined) {
        patch.approvedAt = input.approvedAt
      }
      if (input.approvedByAccountId !== undefined) {
        patch.approvedByAccountId = input.approvedByAccountId
      }
      if (input.errorText !== undefined) {
        patch.errorText = input.errorText
      }
      if (input.status !== undefined) {
        patch.status = input.status
      }

      const result = db
        .update(sandboxWritebackOperations)
        .set(patch)
        .where(
          and(
            eq(sandboxWritebackOperations.id, input.id),
            eq(sandboxWritebackOperations.tenantId, scope.tenantId),
          ),
        )
        .run()

      if (result.changes === 0) {
        return err({
          message: `sandbox writeback operation ${input.id} could not be updated`,
          type: 'conflict',
        })
      }

      const row = db
        .select()
        .from(sandboxWritebackOperations)
        .where(
          and(
            eq(sandboxWritebackOperations.id, input.id),
            eq(sandboxWritebackOperations.tenantId, scope.tenantId),
          ),
        )
        .get()

      if (!row) {
        return err({
          message: `sandbox writeback operation ${input.id} not found after update`,
          type: 'conflict',
        })
      }

      return ok(toRecord(row))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown sandbox writeback update failure'

      return err({
        message: `failed to update sandbox writeback operation ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
