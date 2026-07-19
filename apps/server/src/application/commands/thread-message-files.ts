import type { AppTransaction } from '../../db/transaction'
import type { FileLinkRepository } from '../../domain/files/file-link-repository'
import type { DomainError } from '../../shared/errors'
import type { FileId, SessionMessageId, WorkSessionId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { createResourceAccessService } from '../access/resource-access'
import { createMessageFileReplacementRepository } from '../persistence/repositories'
import type { CommandContext } from './command-context'
import type { createEventStore } from './event-store'

interface MessageFileLinkDependencies {
  db: AppTransaction
  eventStore: ReturnType<typeof createEventStore>
  fileLinkRepository: FileLinkRepository
  now: string
  resourceAccess: ReturnType<typeof createResourceAccessService>
  sessionId: WorkSessionId
}

export interface ReplaceMessageFilesOutput {
  attachedFileIds: FileId[]
  blobStorageKeys: string[]
}

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

  const fileDeletionPlan = createMessageFileReplacementRepository(dependencies.db).applyReplacement({
    desiredFileIds: ensured.value,
    messageId: input.messageId,
    sessionId: dependencies.sessionId,
    tenantId: context.tenantScope.tenantId,
  })

  return ok({
    attachedFileIds: ensured.value,
    blobStorageKeys: fileDeletionPlan.blobStorageKeys,
  })
}
