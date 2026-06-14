import { and, eq, inArray, not, or } from 'drizzle-orm'

import { fileLinks, files, uploads } from '../../db/schema'
import type { AppTransaction } from '../../db/transaction'

export interface FileDeletionPlan {
  blobStorageKeys: string[]
  fileIdsToDelete: string[]
  fileLinkIdsToDelete: string[]
  uploadIdsToDelete: string[]
}

const uniqueStrings = (values: ReadonlyArray<string | null | undefined>): string[] => [
  ...new Set(
    values.filter((value): value is string => typeof value === 'string' && value.length > 0),
  ),
]

export const buildFileDeletionPlanFromDirectLinks = (
  tx: AppTransaction,
  input: {
    directLinkRows: Array<typeof fileLinks.$inferSelect>
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

  const fileRows = tx
    .select()
    .from(files)
    .where(and(eq(files.tenantId, input.tenantId), inArray(files.id, candidateFileIds)))
    .all()

  const remainingLinkRows = tx
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
      ? tx
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

export const selectFileDeletionPlan = (
  tx: AppTransaction,
  input: {
    messageIds: string[]
    runIds: string[]
    sessionId: string
    tenantId: string
    threadIds: string[]
    toolExecutionIds: string[]
  },
): FileDeletionPlan => {
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

  const directLinkRows = tx
    .select()
    .from(fileLinks)
    .where(and(eq(fileLinks.tenantId, input.tenantId), directTargetCondition))
    .all()

  return buildFileDeletionPlanFromDirectLinks(tx, {
    directLinkRows,
    sessionId: input.sessionId,
    tenantId: input.tenantId,
  })
}
