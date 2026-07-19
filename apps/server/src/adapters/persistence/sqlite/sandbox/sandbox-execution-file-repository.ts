import { and, asc, eq } from 'drizzle-orm'

import { sandboxExecutionFiles } from '../../../../db/schema'
import type {
  CreateSandboxExecutionFileInput,
  SandboxExecutionFileRecord,
  SandboxExecutionFileRepository,
} from '../../../../domain/sandbox/sandbox-execution-file-repository'
import type { DomainError } from '../../../../shared/errors'
import {
  asFileId,
  asSandboxExecutionFileId,
  asSandboxExecutionId,
  asTenantId,
  type SandboxExecutionId,
} from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import type { RepositoryDatabase } from '../repository-database'

const toRecord = (row: typeof sandboxExecutionFiles.$inferSelect): SandboxExecutionFileRecord => ({
  checksumSha256: row.checksumSha256,
  createdAt: row.createdAt,
  createdFileId: row.createdFileId ? asFileId(row.createdFileId) : null,
  id: asSandboxExecutionFileId(row.id),
  mimeType: row.mimeType,
  role: row.role,
  sandboxExecutionId: asSandboxExecutionId(row.sandboxExecutionId),
  sandboxPath: row.sandboxPath,
  sizeBytes: row.sizeBytes,
  sourceFileId: row.sourceFileId ? asFileId(row.sourceFileId) : null,
  sourceVaultPath: row.sourceVaultPath,
  targetVaultPath: row.targetVaultPath,
  tenantId: asTenantId(row.tenantId),
})

export const createSandboxExecutionFileRepository = (
  db: RepositoryDatabase,
): SandboxExecutionFileRepository => ({
  create: (
    scope: TenantScope,
    input: CreateSandboxExecutionFileInput,
  ): Result<SandboxExecutionFileRecord, DomainError> => {
    try {
      const record: SandboxExecutionFileRecord = {
        checksumSha256: input.checksumSha256 ?? null,
        createdAt: input.createdAt,
        createdFileId: input.createdFileId ?? null,
        id: input.id,
        mimeType: input.mimeType ?? null,
        role: input.role,
        sandboxExecutionId: input.sandboxExecutionId,
        sandboxPath: input.sandboxPath,
        sizeBytes: input.sizeBytes ?? null,
        sourceFileId: input.sourceFileId ?? null,
        sourceVaultPath: input.sourceVaultPath ?? null,
        targetVaultPath: input.targetVaultPath ?? null,
        tenantId: scope.tenantId,
      }

      db.insert(sandboxExecutionFiles)
        .values({ ...record })
        .run()

      return ok(record)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown sandbox execution file create failure'

      return err({
        message: `failed to create sandbox execution file ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listBySandboxExecutionId: (
    scope: TenantScope,
    sandboxExecutionId: SandboxExecutionId,
  ): Result<SandboxExecutionFileRecord[], DomainError> => {
    try {
      const rows = db
        .select()
        .from(sandboxExecutionFiles)
        .where(
          and(
            eq(sandboxExecutionFiles.sandboxExecutionId, sandboxExecutionId),
            eq(sandboxExecutionFiles.tenantId, scope.tenantId),
          ),
        )
        .orderBy(asc(sandboxExecutionFiles.createdAt), asc(sandboxExecutionFiles.id))
        .all()

      return ok(rows.map(toRecord))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown sandbox execution file list failure'

      return err({
        message: `failed to list sandbox execution files for execution ${sandboxExecutionId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
