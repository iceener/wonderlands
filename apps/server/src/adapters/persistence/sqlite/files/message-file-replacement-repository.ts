import { and, eq, inArray, or, sql } from 'drizzle-orm'

import { domainEvents, eventOutbox, fileLinks, files, uploads } from '../../../../db/schema'
import type { FileDeletionPlan } from '../../../../domain/files/file-deletion-plan-repository'
import type { FileLinkRecord } from '../../../../domain/files/file-link-repository'
import type {
  ApplyMessageFileReplacementInput,
  MessageFileReplacementRepository,
} from '../../../../domain/files/message-file-replacement-repository'
import { asFileId, asTenantId } from '../../../../shared/ids'
import type { RepositoryDatabase } from '../repository-database'
import { createFileDeletionPlanRepository } from './file-deletion-plan-repository'

const emptyFileDeletionPlan: FileDeletionPlan = {
  blobStorageKeys: [],
  fileIdsToDelete: [],
  fileLinkIdsToDelete: [],
  uploadIdsToDelete: [],
}

const toFileLinkRecord = (row: typeof fileLinks.$inferSelect): FileLinkRecord => ({
  createdAt: row.createdAt,
  fileId: asFileId(row.fileId),
  id: row.id,
  linkType: row.linkType,
  targetId: row.targetId,
  tenantId: asTenantId(row.tenantId),
})

const jsonStringAt = (path: '$.fileId' | '$.uploadId') =>
  sql<string | null>`json_extract(${domainEvents.payload}, ${path})`

export const createMessageFileReplacementRepository = (
  db: RepositoryDatabase,
): MessageFileReplacementRepository => ({
  applyReplacement: (input: ApplyMessageFileReplacementInput): FileDeletionPlan => {
    const desiredFileIds = new Set<string>(input.desiredFileIds)

    const currentMessageLinks = db
      .select()
      .from(fileLinks)
      .where(
        and(
          eq(fileLinks.tenantId, input.tenantId),
          eq(fileLinks.linkType, 'message'),
          eq(fileLinks.targetId, input.messageId),
        ),
      )
      .all()

    const directLinkRows = currentMessageLinks
      .filter((row) => !desiredFileIds.has(row.fileId))
      .map(toFileLinkRecord)

    if (directLinkRows.length === 0) {
      return emptyFileDeletionPlan
    }

    const fileDeletionPlan = createFileDeletionPlanRepository(db).buildFromDirectLinks({
      directLinkRows,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
    })

    const eventRows =
      fileDeletionPlan.fileIdsToDelete.length === 0 &&
      fileDeletionPlan.uploadIdsToDelete.length === 0
        ? []
        : db
            .select({
              id: domainEvents.id,
            })
            .from(domainEvents)
            .where(
              and(
                eq(domainEvents.tenantId, input.tenantId),
                or(
                  fileDeletionPlan.fileIdsToDelete.length > 0
                    ? and(
                        eq(domainEvents.aggregateType, 'file'),
                        inArray(domainEvents.aggregateId, fileDeletionPlan.fileIdsToDelete),
                      )
                    : undefined,
                  fileDeletionPlan.uploadIdsToDelete.length > 0
                    ? and(
                        eq(domainEvents.aggregateType, 'upload'),
                        inArray(domainEvents.aggregateId, fileDeletionPlan.uploadIdsToDelete),
                      )
                    : undefined,
                  fileDeletionPlan.fileIdsToDelete.length > 0
                    ? inArray(jsonStringAt('$.fileId'), fileDeletionPlan.fileIdsToDelete)
                    : undefined,
                  fileDeletionPlan.uploadIdsToDelete.length > 0
                    ? inArray(jsonStringAt('$.uploadId'), fileDeletionPlan.uploadIdsToDelete)
                    : undefined,
                ),
              ),
            )
            .all()

    const eventIds = [...new Set(eventRows.map((row) => row.id))]

    if (eventIds.length > 0) {
      db.delete(eventOutbox)
        .where(
          and(eq(eventOutbox.tenantId, input.tenantId), inArray(eventOutbox.eventId, eventIds)),
        )
        .run()

      db.delete(domainEvents)
        .where(and(eq(domainEvents.tenantId, input.tenantId), inArray(domainEvents.id, eventIds)))
        .run()
    }

    db.delete(fileLinks)
      .where(
        and(
          eq(fileLinks.tenantId, input.tenantId),
          inArray(fileLinks.id, fileDeletionPlan.fileLinkIdsToDelete),
        ),
      )
      .run()

    if (fileDeletionPlan.uploadIdsToDelete.length > 0) {
      db.delete(uploads)
        .where(
          and(
            eq(uploads.tenantId, input.tenantId),
            inArray(uploads.id, fileDeletionPlan.uploadIdsToDelete),
          ),
        )
        .run()
    }

    if (fileDeletionPlan.fileIdsToDelete.length > 0) {
      db.delete(files)
        .where(
          and(
            eq(files.tenantId, input.tenantId),
            inArray(files.id, fileDeletionPlan.fileIdsToDelete),
          ),
        )
        .run()
    }

    return fileDeletionPlan
  },
})
