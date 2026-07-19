import { and, eq } from 'drizzle-orm'

import { fileLinks } from '../../../../db/schema'
import type {
  CreateFileLinkInput,
  FileLinkRecord,
  FileLinkRepository,
} from '../../../../domain/files/file-link-repository'
import type { DomainError } from '../../../../shared/errors'
import { asFileId, asTenantId, type FileId } from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import type { RepositoryDatabase } from '../repository-database'

const toFileLinkRecord = (row: typeof fileLinks.$inferSelect): FileLinkRecord => ({
  createdAt: row.createdAt,
  fileId: asFileId(row.fileId),
  id: row.id,
  linkType: row.linkType,
  targetId: row.targetId,
  tenantId: asTenantId(row.tenantId),
})

export const createFileLinkRepository = (db: RepositoryDatabase): FileLinkRepository => ({
  create: (scope: TenantScope, input: CreateFileLinkInput): Result<FileLinkRecord, DomainError> => {
    try {
      const record: FileLinkRecord = {
        createdAt: input.createdAt,
        fileId: input.fileId,
        id: input.id,
        linkType: input.linkType,
        targetId: input.targetId,
        tenantId: scope.tenantId,
      }

      db.insert(fileLinks)
        .values({
          ...record,
        })
        .run()

      return ok(record)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown file link create failure'

      return err({
        message: `failed to create file link ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  exists: (
    scope: TenantScope,
    input: Pick<CreateFileLinkInput, 'fileId' | 'linkType' | 'targetId'>,
  ): Result<boolean, DomainError> => {
    try {
      const linkRow = db
        .select({
          id: fileLinks.id,
        })
        .from(fileLinks)
        .where(
          and(
            eq(fileLinks.tenantId, scope.tenantId),
            eq(fileLinks.fileId, input.fileId),
            eq(fileLinks.linkType, input.linkType),
            eq(fileLinks.targetId, input.targetId),
          ),
        )
        .get()

      return ok(Boolean(linkRow))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown file link existence check failure'

      return err({
        message: `failed to check file link for file ${input.fileId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listByFileId: (scope: TenantScope, fileId: FileId): Result<FileLinkRecord[], DomainError> => {
    try {
      const rows = db
        .select()
        .from(fileLinks)
        .where(and(eq(fileLinks.fileId, fileId), eq(fileLinks.tenantId, scope.tenantId)))
        .all()

      return ok(rows.map(toFileLinkRecord))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown file link list failure'

      return err({
        message: `failed to list file links for file ${fileId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listByTarget: (
    scope: TenantScope,
    input: Pick<CreateFileLinkInput, 'linkType' | 'targetId'>,
  ): Result<FileLinkRecord[], DomainError> => {
    try {
      const rows = db
        .select()
        .from(fileLinks)
        .where(
          and(
            eq(fileLinks.tenantId, scope.tenantId),
            eq(fileLinks.linkType, input.linkType),
            eq(fileLinks.targetId, input.targetId),
          ),
        )
        .all()

      return ok(rows.map(toFileLinkRecord))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown file link target list failure'

      return err({
        message: `failed to list file links for target ${input.targetId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
