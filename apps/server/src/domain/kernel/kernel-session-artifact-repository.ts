import { and, asc, eq } from 'drizzle-orm'

import { kernelSessionArtifacts } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  asFileId,
  asKernelSessionArtifactId,
  asKernelSessionId,
  asTenantId,
  type FileId,
  type KernelSessionArtifactId,
  type KernelSessionId,
  type TenantId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'
import type { KernelArtifactKind } from './types'

export interface KernelSessionArtifactRecord {
  createdAt: string
  fileId: FileId | null
  id: KernelSessionArtifactId
  kernelSessionId: KernelSessionId
  kind: KernelArtifactKind
  metadataJson: Record<string, unknown> | null
  mimeType: string | null
  sizeBytes: number | null
  tenantId: TenantId
}

export interface CreateKernelSessionArtifactInput {
  createdAt: string
  fileId?: FileId | null
  id: KernelSessionArtifactId
  kernelSessionId: KernelSessionId
  kind: KernelArtifactKind
  metadataJson?: Record<string, unknown> | null
  mimeType?: string | null
  sizeBytes?: number | null
}

const toRecord = (
  row: typeof kernelSessionArtifacts.$inferSelect,
): KernelSessionArtifactRecord => ({
  createdAt: row.createdAt,
  fileId: row.fileId ? asFileId(row.fileId) : null,
  id: asKernelSessionArtifactId(row.id),
  kernelSessionId: asKernelSessionId(row.kernelSessionId),
  kind: row.kind,
  metadataJson: row.metadataJson ? (row.metadataJson as Record<string, unknown>) : null,
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes,
  tenantId: asTenantId(row.tenantId),
})

export const createKernelSessionArtifactRepository = (db: RepositoryDatabase) => ({
  create: (
    scope: TenantScope,
    input: CreateKernelSessionArtifactInput,
  ): Result<KernelSessionArtifactRecord, DomainError> => {
    try {
      const record: KernelSessionArtifactRecord = {
        createdAt: input.createdAt,
        fileId: input.fileId ?? null,
        id: input.id,
        kernelSessionId: input.kernelSessionId,
        kind: input.kind,
        metadataJson: input.metadataJson ?? null,
        mimeType: input.mimeType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        tenantId: scope.tenantId,
      }

      db.insert(kernelSessionArtifacts)
        .values({ ...record })
        .run()

      return ok(record)
    } catch (error) {
      return err({
        message: `failed to create kernel session artifact ${input.id}: ${error instanceof Error ? error.message : 'Unknown kernel session artifact create failure'}`,
        type: 'conflict',
      })
    }
  },
  listBySessionId: (
    scope: TenantScope,
    kernelSessionId: KernelSessionId,
  ): Result<KernelSessionArtifactRecord[], DomainError> => {
    try {
      const rows = db
        .select()
        .from(kernelSessionArtifacts)
        .where(
          and(
            eq(kernelSessionArtifacts.kernelSessionId, kernelSessionId),
            eq(kernelSessionArtifacts.tenantId, scope.tenantId),
          ),
        )
        .orderBy(asc(kernelSessionArtifacts.createdAt), asc(kernelSessionArtifacts.id))
        .all()

      return ok(rows.map(toRecord))
    } catch (error) {
      return err({
        message: `failed to list kernel session artifacts for session ${kernelSessionId}: ${error instanceof Error ? error.message : 'Unknown kernel session artifact list failure'}`,
        type: 'conflict',
      })
    }
  },
})
