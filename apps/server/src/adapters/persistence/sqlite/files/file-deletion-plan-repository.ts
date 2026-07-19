import { and, eq, inArray, not, or } from 'drizzle-orm'

import { fileLinks, files, uploads } from '../../../../db/schema'
import type {
  BuildFileDeletionPlanFromDirectLinksInput,
  FileDeletionPlan,
  FileDeletionPlanRepository,
  SelectFileDeletionPlanInput,
} from '../../../../domain/files/file-deletion-plan-repository'
import type { RepositoryDatabase } from '../repository-database'

interface DirectLinkRow {
  fileId: string
  id: string
  linkType: 'session' | 'thread' | 'message' | 'run' | 'tool_execution'
  targetId: string
}

const uniqueStrings = (values: ReadonlyArray<string | null | undefined>): string[] => [
  ...new Set(
    values.filter((value): value is string => typeof value === 'string' && value.length > 0),
  ),
]

const buildPlanFromDirectLinkRows = (
  db: RepositoryDatabase,
  input: {
    directLinkRows: DirectLinkRow[]
    sessionId: string
    tenantId: string
  },
): FileDeletionPlan => {
  const directLinkIds = uniqueStrings(input.directLinkRows.map((row) => row.id))
  const candidateFileIds = uniqueStrings(input.directLinkRows.map((row) => row.fileId))

  if (candidateFileIds.length === 0) {
    return {
      blobStorageKeys: [],
      fileIdsToDelete: [],
      fileLinkIdsToDelete: directLinkIds,
      uploadIdsToDelete: [],
    }
  }

  const fileRows = db
    .select()
    .from(files)
    .where(and(eq(files.tenantId, input.tenantId), inArray(files.id, candidateFileIds)))
    .all()

  const remainingLinkRows = db
    .select()
    .from(fileLinks)
    .where(
      and(
        eq(fileLinks.tenantId, input.tenantId),
        inArray(fileLinks.fileId, candidateFileIds),
        not(inArray(fileLinks.id, directLinkIds)),
      ),
    )
    .all()

  const remainingLinksByFileId = new Map<string, Array<typeof fileLinks.$inferSelect>>()

  for (const linkRow of remainingLinkRows) {
    const links = remainingLinksByFileId.get(linkRow.fileId) ?? []
    links.push(linkRow)
    remainingLinksByFileId.set(linkRow.fileId, links)
  }

  const extraSessionLinkIds: string[] = []
  const deletedFileRows: Array<typeof files.$inferSelect> = []

  for (const fileRow of fileRows) {
    const remainingLinks = remainingLinksByFileId.get(fileRow.id) ?? []
    const isLibraryUpload =
      fileRow.accessScope === 'account_library' &&
      fileRow.sourceKind === 'upload' &&
      fileRow.createdByRunId === null

    if (remainingLinks.length === 0) {
      if (!isLibraryUpload) {
        deletedFileRows.push(fileRow)
      }
      continue
    }

    const onlySameSessionLinksRemain = remainingLinks.every(
      (linkRow) => linkRow.linkType === 'session' && linkRow.targetId === input.sessionId,
    )

    if (onlySameSessionLinksRemain && fileRow.accessScope === 'session_local') {
      deletedFileRows.push(fileRow)
      extraSessionLinkIds.push(...remainingLinks.map((linkRow) => linkRow.id))
    }
  }

  const fileIdsToDelete = uniqueStrings(deletedFileRows.map((row) => row.id))
  const originUploadIds = uniqueStrings(deletedFileRows.map((row) => row.originUploadId))

  const uploadRows =
    fileIdsToDelete.length > 0 || originUploadIds.length > 0
      ? db
          .select()
          .from(uploads)
          .where(
            and(
              eq(uploads.tenantId, input.tenantId),
              or(
                fileIdsToDelete.length > 0 ? inArray(uploads.fileId, fileIdsToDelete) : undefined,
                originUploadIds.length > 0 ? inArray(uploads.id, originUploadIds) : undefined,
              ),
            ),
          )
          .all()
      : []

  return {
    blobStorageKeys: uniqueStrings([
      ...deletedFileRows.map((row) => row.storageKey),
      ...uploadRows.map((row) => row.stagedStorageKey),
    ]),
    fileIdsToDelete,
    fileLinkIdsToDelete: uniqueStrings([...directLinkIds, ...extraSessionLinkIds]),
    uploadIdsToDelete: uniqueStrings([...originUploadIds, ...uploadRows.map((row) => row.id)]),
  }
}

export const createFileDeletionPlanRepository = (
  db: RepositoryDatabase,
): FileDeletionPlanRepository => ({
  buildFromDirectLinks: (input: BuildFileDeletionPlanFromDirectLinksInput): FileDeletionPlan =>
    buildPlanFromDirectLinkRows(db, {
      directLinkRows: input.directLinkRows,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
    }),
  selectPlan: (input: SelectFileDeletionPlanInput): FileDeletionPlan => {
    const directTargetCondition = or(
      input.threadIds.length > 0
        ? and(eq(fileLinks.linkType, 'thread'), inArray(fileLinks.targetId, input.threadIds))
        : undefined,
      input.messageIds.length > 0
        ? and(eq(fileLinks.linkType, 'message'), inArray(fileLinks.targetId, input.messageIds))
        : undefined,
      input.runIds.length > 0
        ? and(eq(fileLinks.linkType, 'run'), inArray(fileLinks.targetId, input.runIds))
        : undefined,
      input.toolExecutionIds.length > 0
        ? and(
            eq(fileLinks.linkType, 'tool_execution'),
            inArray(fileLinks.targetId, input.toolExecutionIds),
          )
        : undefined,
    )

    if (!directTargetCondition) {
      return {
        blobStorageKeys: [],
        fileIdsToDelete: [],
        fileLinkIdsToDelete: [],
        uploadIdsToDelete: [],
      }
    }

    const directLinkRows = db
      .select()
      .from(fileLinks)
      .where(and(eq(fileLinks.tenantId, input.tenantId), directTargetCondition))
      .all()

    return buildPlanFromDirectLinkRows(db, {
      directLinkRows,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
    })
  },
})
