import { and, asc, eq } from 'drizzle-orm'
import { sandboxExecutionPackages } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  asSandboxExecutionId,
  asSandboxExecutionPackageId,
  asTenantId,
  type SandboxExecutionId,
  type SandboxExecutionPackageId,
  type TenantId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'
import type { SandboxPackageStatus } from './types'

export interface SandboxExecutionPackageRecord {
  createdAt: string
  errorText: string | null
  id: SandboxExecutionPackageId
  installScriptsAllowed: boolean
  name: string
  registryHost: string | null
  requestedVersion: string
  resolvedVersion: string | null
  sandboxExecutionId: SandboxExecutionId
  status: SandboxPackageStatus
  tenantId: TenantId
}

export interface CreateSandboxExecutionPackageInput {
  createdAt: string
  errorText?: string | null
  id: SandboxExecutionPackageId
  installScriptsAllowed?: boolean
  name: string
  registryHost?: string | null
  requestedVersion: string
  resolvedVersion?: string | null
  sandboxExecutionId: SandboxExecutionId
  status: SandboxPackageStatus
}

export interface UpdateSandboxExecutionPackageInput {
  errorText?: string | null
  id: SandboxExecutionPackageId
  resolvedVersion?: string | null
  status?: SandboxPackageStatus
}

const toRecord = (
  row: typeof sandboxExecutionPackages.$inferSelect,
): SandboxExecutionPackageRecord => ({
  createdAt: row.createdAt,
  errorText: row.errorText,
  id: asSandboxExecutionPackageId(row.id),
  installScriptsAllowed: row.installScriptsAllowed,
  name: row.name,
  registryHost: row.registryHost,
  requestedVersion: row.requestedVersion,
  resolvedVersion: row.resolvedVersion,
  sandboxExecutionId: asSandboxExecutionId(row.sandboxExecutionId),
  status: row.status,
  tenantId: asTenantId(row.tenantId),
})

export const createSandboxExecutionPackageRepository = (db: RepositoryDatabase) => ({
  create: (
    scope: TenantScope,
    input: CreateSandboxExecutionPackageInput,
  ): Result<SandboxExecutionPackageRecord, DomainError> => {
    try {
      const record: SandboxExecutionPackageRecord = {
        createdAt: input.createdAt,
        errorText: input.errorText ?? null,
        id: input.id,
        installScriptsAllowed: input.installScriptsAllowed ?? false,
        name: input.name,
        registryHost: input.registryHost ?? null,
        requestedVersion: input.requestedVersion,
        resolvedVersion: input.resolvedVersion ?? null,
        sandboxExecutionId: input.sandboxExecutionId,
        status: input.status,
        tenantId: scope.tenantId,
      }

      db.insert(sandboxExecutionPackages)
        .values({ ...record })
        .run()

      return ok(record)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown sandbox package create failure'

      return err({
        message: `failed to create sandbox execution package ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listBySandboxExecutionId: (
    scope: TenantScope,
    sandboxExecutionId: SandboxExecutionId,
  ): Result<SandboxExecutionPackageRecord[], DomainError> => {
    try {
      const rows = db
        .select()
        .from(sandboxExecutionPackages)
        .where(
          and(
            eq(sandboxExecutionPackages.sandboxExecutionId, sandboxExecutionId),
            eq(sandboxExecutionPackages.tenantId, scope.tenantId),
          ),
        )
        .orderBy(asc(sandboxExecutionPackages.createdAt), asc(sandboxExecutionPackages.id))
        .all()

      return ok(rows.map(toRecord))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown sandbox package list failure'

      return err({
        message: `failed to list sandbox packages for execution ${sandboxExecutionId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  update: (
    scope: TenantScope,
    input: UpdateSandboxExecutionPackageInput,
  ): Result<SandboxExecutionPackageRecord, DomainError> => {
    try {
      const patch: Partial<typeof sandboxExecutionPackages.$inferInsert> = {}

      if (input.errorText !== undefined) {
        patch.errorText = input.errorText
      }
      if (input.resolvedVersion !== undefined) {
        patch.resolvedVersion = input.resolvedVersion
      }
      if (input.status !== undefined) {
        patch.status = input.status
      }

      const result = db
        .update(sandboxExecutionPackages)
        .set(patch)
        .where(
          and(
            eq(sandboxExecutionPackages.id, input.id),
            eq(sandboxExecutionPackages.tenantId, scope.tenantId),
          ),
        )
        .run()

      if (result.changes === 0) {
        return err({
          message: `sandbox execution package ${input.id} could not be updated`,
          type: 'conflict',
        })
      }

      const row = db
        .select()
        .from(sandboxExecutionPackages)
        .where(
          and(
            eq(sandboxExecutionPackages.id, input.id),
            eq(sandboxExecutionPackages.tenantId, scope.tenantId),
          ),
        )
        .get()

      if (!row) {
        return err({
          message: `sandbox execution package ${input.id} not found after update`,
          type: 'conflict',
        })
      }

      return ok(toRecord(row))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown sandbox package update failure'

      return err({
        message: `failed to update sandbox execution package ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
