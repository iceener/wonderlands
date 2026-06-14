import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { domainEvents, eventOutbox, fileLinks, files, uploads } from '../../db/schema'
import type { AppTransaction } from '../../db/transaction'
import type { createFileLinkRepository } from '../../domain/files/file-link-repository'
import type { DomainError } from '../../shared/errors'
import type { FileId, SessionMessageId, WorkSessionId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { createResourceAccessService } from '../access/resource-access'
import type { CommandContext } from './command-context'
import type { createEventStore } from './event-store'
import { buildFileDeletionPlanFromDirectLinks } from './file-link-cleanup'

interface MessageFileLinkDependencies {
  db: AppTransaction
  eventStore: ReturnType<typeof createEventStore>
  fileLinkRepository: ReturnType<typeof createFileLinkRepository>
  now: string
  resourceAccess: ReturnType<typeof createResourceAccessService>
  sessionId: WorkSessionId
}

export interface ReplaceMessageFilesOutput {
  attachedFileIds: FileId[]
  blobStorageKeys: string[]
}

const jsonStringAt = (path: '$.fileId' | '$.uploadId') =>
  sql<string | null>`json_extract(${domainEvents.payload}, ${path})`

export const ensureFilesAttachedToMessage = (
  context: CommandContext,
  dependencies: MessageFileLinkDependencies,
  input: {
    fileIds: FileId[]
    messageId: SessionMessageId
  },
): Result<FileId[], DomainError> => {
  const dedupedFileIds = [...new Set(input.fileIds)]
  const attachedFileIds: FileId[] = []

  for (const fileId of dedupedFileIds) {
    const file = dependencies.resourceAccess.requireFileAccess(context.tenantScope, fileId)

    if (!file.ok) {
      return file
    }

    if (file.value.status !== 'ready') {
      return err({
        message: `file ${fileId} is not ready`,
        type: 'conflict',
      })
    }

    const hasSessionLink = dependencies.fileLinkRepository.exists(context.tenantScope, {
      fileId,
      linkType: 'session',
      targetId: dependencies.sessionId,
    })

    if (!hasSessionLink.ok) {
      return hasSessionLink
    }

    if (file.value.accessScope === 'session_local' && !hasSessionLink.value) {
      return err({
        message: `session-local file ${fileId} is not linked to session ${dependencies.sessionId}`,
        type: 'conflict',
      })
    }

    if (file.value.accessScope === 'account_library' && !hasSessionLink.value) {
      const sessionLink = dependencies.fileLinkRepository.create(context.tenantScope, {
        createdAt: dependencies.now,
        fileId,
        id: context.services.ids.create('flk'),
        linkType: 'session',
        targetId: dependencies.sessionId,
      })

      if (!sessionLink.ok) {
        return sessionLink
      }

      const linkedEvent = dependencies.eventStore.append({
        actorAccountId: context.tenantScope.accountId,
        aggregateId: fileId,
        aggregateType: 'file',
        outboxTopics: ['projection', 'realtime'],
        payload: {
          fileId,
          linkType: 'session',
          sessionId: dependencies.sessionId,
          targetId: dependencies.sessionId,
        },
        tenantId: context.tenantScope.tenantId,
        traceId: context.traceId,
        type: 'file.linked',
      })

      if (!linkedEvent.ok) {
        return linkedEvent
      }
    }

    const hasMessageLink = dependencies.fileLinkRepository.exists(context.tenantScope, {
      fileId,
      linkType: 'message',
      targetId: input.messageId,
    })

    if (!hasMessageLink.ok) {
      return hasMessageLink
    }

    if (!hasMessageLink.value) {
      const messageLink = dependencies.fileLinkRepository.create(context.tenantScope, {
        createdAt: dependencies.now,
        fileId,
        id: context.services.ids.create('flk'),
        linkType: 'message',
        targetId: input.messageId,
      })

      if (!messageLink.ok) {
        return messageLink
      }

      const linkedEvent = dependencies.eventStore.append({
        actorAccountId: context.tenantScope.accountId,
        aggregateId: fileId,
        aggregateType: 'file',
        outboxTopics: ['projection', 'realtime'],
        payload: {
          fileId,
          linkType: 'message',
          messageId: input.messageId,
          sessionId: dependencies.sessionId,
          targetId: input.messageId,
        },
        tenantId: context.tenantScope.tenantId,
        traceId: context.traceId,
        type: 'file.linked',
      })

      if (!linkedEvent.ok) {
        return linkedEvent
      }
    }

    attachedFileIds.push(fileId)
  }

  return ok(attachedFileIds)
}

export const replaceMessageFiles = (
  context: CommandContext,
  dependencies: MessageFileLinkDependencies,
  input: {
    fileIds: FileId[]
    messageId: SessionMessageId
  },
): Result<ReplaceMessageFilesOutput, DomainError> => {
  const ensured = ensureFilesAttachedToMessage(context, dependencies, input)

  if (!ensured.ok) {
    return ensured
  }

  const desiredFileIds = new Set(ensured.value)
  const currentMessageLinks = dependencies.db
    .select()
    .from(fileLinks)
    .where(
      and(
        eq(fileLinks.tenantId, context.tenantScope.tenantId),
        eq(fileLinks.linkType, 'message'),
        eq(fileLinks.targetId, input.messageId),
      ),
    )
    .all()
  const directLinkRows = currentMessageLinks.filter(
    (row) => !desiredFileIds.has(row.fileId as FileId),
  )

  if (directLinkRows.length === 0) {
    return ok({
      attachedFileIds: ensured.value,
      blobStorageKeys: [],
    })
  }

  const fileDeletionPlan = buildFileDeletionPlanFromDirectLinks(dependencies.db, {
    directLinkRows,
    sessionId: dependencies.sessionId,
    tenantId: context.tenantScope.tenantId,
  })

  const eventRows =
    fileDeletionPlan.fileIdsToDelete.length === 0 && fileDeletionPlan.uploadIdsToDelete.length === 0
      ? []
      : dependencies.db
          .select({
            id: domainEvents.id,
          })
          .from(domainEvents)
          .where(
            and(
              eq(domainEvents.tenantId, context.tenantScope.tenantId),
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
    dependencies.db
      .delete(eventOutbox)
      .where(
        and(
          eq(eventOutbox.tenantId, context.tenantScope.tenantId),
          inArray(eventOutbox.eventId, eventIds),
        ),
      )
      .run()

    dependencies.db
      .delete(domainEvents)
      .where(
        and(
          eq(domainEvents.tenantId, context.tenantScope.tenantId),
          inArray(domainEvents.id, eventIds),
        ),
      )
      .run()
  }

  dependencies.db
    .delete(fileLinks)
    .where(
      and(
        eq(fileLinks.tenantId, context.tenantScope.tenantId),
        inArray(fileLinks.id, fileDeletionPlan.fileLinkIdsToDelete),
      ),
    )
    .run()

  if (fileDeletionPlan.uploadIdsToDelete.length > 0) {
    dependencies.db
      .delete(uploads)
      .where(
        and(
          eq(uploads.tenantId, context.tenantScope.tenantId),
          inArray(uploads.id, fileDeletionPlan.uploadIdsToDelete),
        ),
      )
      .run()
  }

  if (fileDeletionPlan.fileIdsToDelete.length > 0) {
    dependencies.db
      .delete(files)
      .where(
        and(
          eq(files.tenantId, context.tenantScope.tenantId),
          inArray(files.id, fileDeletionPlan.fileIdsToDelete),
        ),
      )
      .run()
  }

  return ok({
    attachedFileIds: ensured.value,
    blobStorageKeys: fileDeletionPlan.blobStorageKeys,
  })
}
