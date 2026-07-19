import { and, desc, eq, inArray } from 'drizzle-orm'

import { fileLinks, files } from '../../../../db/schema'
import type {
  CreateFileInput,
  FileRecord,
  FileRepository,
  MessageLinkedFileRecord,
  RunLinkedFileRecord,
} from '../../../../domain/files/file-repository'
import type { DomainError } from '../../../../shared/errors'
import {
  asAccountId,
  asFileId,
  asRunId,
  asSessionMessageId,
  asTenantId,
  type FileId,
  type RunId,
  type SessionMessageId,
} from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import type { RepositoryDatabase } from '../repository-database'

const toFileRecord = (row: typeof files.$inferSelect): FileRecord => ({
  accessScope: row.accessScope,
  checksumSha256: row.checksumSha256,
  createdAt: row.createdAt,
  createdByAccountId: row.createdByAccountId ? asAccountId(row.createdByAccountId) : null,
  createdByRunId: row.createdByRunId ? asRunId(row.createdByRunId) : null,
  id: asFileId(row.id),
  metadata: row.metadata,
  mimeType: row.mimeType,
  originUploadId: row.originUploadId,
  originalFilename: row.originalFilename,
  sizeBytes: row.sizeBytes,
  sourceKind: row.sourceKind,
  status: row.status,
  storageKey: row.storageKey,
  tenantId: asTenantId(row.tenantId),
  title: row.title,
  updatedAt: row.updatedAt,
})

export const createFileRepository = (db: RepositoryDatabase): FileRepository => {
  const getById = (scope: TenantScope, fileId: FileId): Result<FileRecord, DomainError> => {
    const fileRow = db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.tenantId, scope.tenantId)))
      .get()

    if (!fileRow) {
      return err({
        message: `file ${fileId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toFileRecord(fileRow))
  }

  return {
    create: (scope: TenantScope, input: CreateFileInput): Result<FileRecord, DomainError> => {
      try {
        const record: FileRecord = {
          accessScope: input.accessScope,
          checksumSha256: input.checksumSha256 ?? null,
          createdAt: input.createdAt,
          createdByAccountId: input.createdByAccountId ?? null,
          createdByRunId: input.createdByRunId ?? null,
          id: input.id,
          metadata: input.metadata ?? null,
          mimeType: input.mimeType ?? null,
          originUploadId: input.originUploadId ?? null,
          originalFilename: input.originalFilename ?? null,
          sizeBytes: input.sizeBytes ?? null,
          sourceKind: input.sourceKind,
          status: input.status,
          storageKey: input.storageKey,
          tenantId: scope.tenantId,
          title: input.title ?? null,
          updatedAt: input.updatedAt,
        }

        db.insert(files)
          .values({
            ...record,
          })
          .run()

        return ok(record)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown file create failure'

        return err({
          message: `failed to create file ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getById,
    listByIds: (scope: TenantScope, fileIds: FileId[]): Result<FileRecord[], DomainError> => {
      if (fileIds.length === 0) {
        return ok([])
      }

      try {
        const rows = db
          .select()
          .from(files)
          .where(and(eq(files.tenantId, scope.tenantId), inArray(files.id, fileIds)))
          .all()

        return ok(rows.map(toFileRecord))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown file lookup failure'

        return err({
          message: `failed to load files by id: ${message}`,
          type: 'conflict',
        })
      }
    },
    listAccountLibraryByAccountId: (scope: TenantScope): Result<FileRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(files)
          .where(
            and(
              eq(files.tenantId, scope.tenantId),
              eq(files.accessScope, 'account_library'),
              eq(files.createdByAccountId, scope.accountId),
              eq(files.status, 'ready'),
            ),
          )
          .orderBy(desc(files.createdAt), desc(files.id))
          .all()

        return ok(rows.map(toFileRecord))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown account library list failure'

        return err({
          message: `failed to list account-library files for account ${scope.accountId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    listByMessageIds: (
      scope: TenantScope,
      messageIds: SessionMessageId[],
    ): Result<MessageLinkedFileRecord[], DomainError> => {
      if (messageIds.length === 0) {
        return ok([])
      }

      try {
        const rows = db
          .select({
            file: files,
            messageId: fileLinks.targetId,
          })
          .from(fileLinks)
          .innerJoin(
            files,
            and(eq(files.id, fileLinks.fileId), eq(files.tenantId, fileLinks.tenantId)),
          )
          .where(
            and(
              eq(fileLinks.tenantId, scope.tenantId),
              eq(fileLinks.linkType, 'message'),
              inArray(fileLinks.targetId, messageIds),
              eq(files.status, 'ready'),
            ),
          )
          .orderBy(desc(files.createdAt), desc(files.id))
          .all()

        return ok(
          rows.map((row) => ({
            file: toFileRecord(row.file),
            messageId: asSessionMessageId(row.messageId),
          })),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown message file list failure'

        return err({
          message: `failed to list files for message set: ${message}`,
          type: 'conflict',
        })
      }
    },
    listBySessionId: (scope: TenantScope, sessionId: string): Result<FileRecord[], DomainError> => {
      try {
        const rows = db
          .select({
            file: files,
          })
          .from(fileLinks)
          .innerJoin(
            files,
            and(eq(files.id, fileLinks.fileId), eq(files.tenantId, fileLinks.tenantId)),
          )
          .where(
            and(
              eq(fileLinks.tenantId, scope.tenantId),
              eq(fileLinks.linkType, 'session'),
              eq(fileLinks.targetId, sessionId),
              eq(files.status, 'ready'),
            ),
          )
          .orderBy(desc(files.createdAt), desc(files.id))
          .all()

        return ok(rows.map((row) => toFileRecord(row.file)))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown session file list failure'

        return err({
          message: `failed to list files for session ${sessionId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    listByRunId: (scope: TenantScope, runId: RunId): Result<FileRecord[], DomainError> => {
      try {
        const rows = db
          .select({
            file: files,
          })
          .from(fileLinks)
          .innerJoin(
            files,
            and(eq(files.id, fileLinks.fileId), eq(files.tenantId, fileLinks.tenantId)),
          )
          .where(
            and(
              eq(fileLinks.tenantId, scope.tenantId),
              eq(fileLinks.linkType, 'run'),
              eq(fileLinks.targetId, runId),
              eq(files.status, 'ready'),
            ),
          )
          .orderBy(desc(files.createdAt), desc(files.id))
          .all()

        return ok(rows.map((row) => toFileRecord(row.file)))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown run file list failure'

        return err({
          message: `failed to list files for run ${runId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    listByRunIds: (
      scope: TenantScope,
      runIds: RunId[],
    ): Result<RunLinkedFileRecord[], DomainError> => {
      if (runIds.length === 0) {
        return ok([])
      }

      try {
        const rows = db
          .select({
            file: files,
            runId: fileLinks.targetId,
          })
          .from(fileLinks)
          .innerJoin(
            files,
            and(eq(files.id, fileLinks.fileId), eq(files.tenantId, fileLinks.tenantId)),
          )
          .where(
            and(
              eq(fileLinks.tenantId, scope.tenantId),
              eq(fileLinks.linkType, 'run'),
              inArray(fileLinks.targetId, runIds),
              eq(files.status, 'ready'),
            ),
          )
          .orderBy(desc(files.createdAt), desc(files.id))
          .all()

        return ok(
          rows.map((row) => ({
            file: toFileRecord(row.file),
            runId: asRunId(row.runId),
          })),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown run file set list failure'

        return err({
          message: `failed to list files for run set: ${message}`,
          type: 'conflict',
        })
      }
    },
  }
}
