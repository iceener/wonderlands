import { and, eq } from 'drizzle-orm'

import { uploads } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  type AccountId,
  asAccountId,
  asFileId,
  asTenantId,
  asUploadId,
  asWorkSessionId,
  type FileId,
  type TenantId,
  type UploadId,
  type WorkSessionId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'
import type { FileAccessScope, UploadStatus } from './file-access'

export interface UploadRecord {
  accessScope: FileAccessScope
  accountId: AccountId | null
  checksumSha256: string | null
  completedAt: string | null
  createdAt: string
  declaredMimeType: string | null
  detectedMimeType: string | null
  errorText: string | null
  fileId: FileId | null
  id: UploadId
  originalFilename: string
  sessionId: WorkSessionId | null
  sizeBytes: number | null
  stagedStorageKey: string | null
  status: UploadStatus
  tenantId: TenantId
  title: string | null
  updatedAt: string
}

export interface CreateUploadInput {
  accessScope: FileAccessScope
  accountId: AccountId | null
  createdAt: string
  declaredMimeType?: string | null
  id: UploadId
  originalFilename: string
  sessionId?: WorkSessionId | null
  status: Extract<UploadStatus, 'pending'>
  title?: string | null
  updatedAt: string
}

const toUploadRecord = (row: typeof uploads.$inferSelect): UploadRecord => ({
  accessScope: row.accessScope,
  accountId: row.accountId ? asAccountId(row.accountId) : null,
  checksumSha256: row.checksumSha256,
  completedAt: row.completedAt,
  createdAt: row.createdAt,
  declaredMimeType: row.declaredMimeType,
  detectedMimeType: row.detectedMimeType,
  errorText: row.errorText,
  fileId: row.fileId ? asFileId(row.fileId) : null,
  id: asUploadId(row.id),
  originalFilename: row.originalFilename,
  sessionId: row.sessionId ? asWorkSessionId(row.sessionId) : null,
  sizeBytes: row.sizeBytes,
  stagedStorageKey: row.stagedStorageKey,
  status: row.status,
  tenantId: asTenantId(row.tenantId),
  title: row.title,
  updatedAt: row.updatedAt,
})

export const createUploadRepository = (db: RepositoryDatabase) => {
  const getById = (scope: TenantScope, uploadId: UploadId): Result<UploadRecord, DomainError> => {
    const uploadRow = db
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, uploadId), eq(uploads.tenantId, scope.tenantId)))
      .get()

    if (!uploadRow) {
      return err({
        message: `upload ${uploadId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toUploadRecord(uploadRow))
  }

  return {
    complete: (
      scope: TenantScope,
      input: {
        checksumSha256: string
        completedAt: string
        detectedMimeType: string | null
        fileId: FileId
        id: UploadId
        sizeBytes: number
        stagedStorageKey: string
        updatedAt: string
      },
    ): Result<UploadRecord, DomainError> => {
      try {
        const result = db
          .update(uploads)
          .set({
            checksumSha256: input.checksumSha256,
            completedAt: input.completedAt,
            detectedMimeType: input.detectedMimeType,
            fileId: input.fileId,
            sizeBytes: input.sizeBytes,
            stagedStorageKey: input.stagedStorageKey,
            status: 'completed',
            updatedAt: input.updatedAt,
          })
          .where(and(eq(uploads.id, input.id), eq(uploads.tenantId, scope.tenantId)))
          .run()

        if (result.changes === 0) {
          return err({
            message: `upload ${input.id} could not be completed`,
            type: 'conflict',
          })
        }

        return getById(scope, input.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown upload completion failure'

        return err({
          message: `failed to complete upload ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    create: (scope: TenantScope, input: CreateUploadInput): Result<UploadRecord, DomainError> => {
      try {
        const record: UploadRecord = {
          accessScope: input.accessScope,
          accountId: input.accountId,
          checksumSha256: null,
          completedAt: null,
          createdAt: input.createdAt,
          declaredMimeType: input.declaredMimeType ?? null,
          detectedMimeType: null,
          errorText: null,
          fileId: null,
          id: input.id,
          originalFilename: input.originalFilename,
          sessionId: input.sessionId ?? null,
          sizeBytes: null,
          stagedStorageKey: null,
          status: input.status,
          tenantId: scope.tenantId,
          title: input.title ?? null,
          updatedAt: input.updatedAt,
        }

        db.insert(uploads)
          .values({
            ...record,
          })
          .run()

        return ok(record)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown upload create failure'

        return err({
          message: `failed to create upload ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    fail: (
      scope: TenantScope,
      input: {
        errorText: string
        id: UploadId
        updatedAt: string
      },
    ): Result<UploadRecord, DomainError> => {
      try {
        const result = db
          .update(uploads)
          .set({
            errorText: input.errorText,
            status: 'failed',
            updatedAt: input.updatedAt,
          })
          .where(and(eq(uploads.id, input.id), eq(uploads.tenantId, scope.tenantId)))
          .run()

        if (result.changes === 0) {
          return err({
            message: `upload ${input.id} could not be marked as failed`,
            type: 'conflict',
          })
        }

        return getById(scope, input.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown upload failure transition'

        return err({
          message: `failed to fail upload ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getById,
    toRecord: toUploadRecord,
  }
}
