import { and, eq } from 'drizzle-orm'

import { fileLinks } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import { asFileId, asTenantId, type FileId, type TenantId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

export interface FileLinkRecord {
  createdAt: string
  fileId: FileId
  id: string
  linkType: 'session' | 'thread' | 'message' | 'run' | 'tool_execution'
  targetId: string
  tenantId: TenantId
}

export interface CreateFileLinkInput {
  createdAt: string
  fileId: FileId
  id: string
  linkType: FileLinkRecord['linkType']
  targetId: string
}

const toFileLinkRecord = (row: typeof fileLinks.$inferSelect): FileLinkRecord => ({
  createdAt: row.createdAt,
  fileId: asFileId(row.fileId),
  id: row.id,
  linkType: row.linkType,
  targetId: row.targetId,
  tenantId: asTenantId(row.tenantId),
})

export const createFileLinkRepository = (db: RepositoryDatabase) => ({
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
  toRecord: toFileLinkRecord,
})
