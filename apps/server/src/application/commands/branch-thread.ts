import { z } from 'zod'
import { withTransaction } from '../../db/transaction'
import { createFileLinkRepository } from '../../domain/files/file-link-repository'
import { createFileRepository } from '../../domain/files/file-repository'
import {
  createSessionMessageRepository,
  type SessionMessageRecord,
} from '../../domain/sessions/session-message-repository'
import {
  createSessionThreadRepository,
  type SessionThreadRecord,
} from '../../domain/sessions/session-thread-repository'
import { type DomainError, DomainErrorException } from '../../shared/errors'
import type { FileId, SessionThreadId } from '../../shared/ids'
import { asSessionMessageId, asSessionThreadId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import { createResourceAccessService } from '../access/resource-access'
import { loadThreadRootJobReadModel } from '../runtime/scheduling/job-read-model'
import type { CommandContext, CommandResult } from './command-context'
import { unwrapCommandResultOrThrow } from './command-result'
import { createEventStore } from './event-store'
import { ensureFilesAttachedToMessage } from './thread-message-files'

const branchThreadInputSchema = z.object({
  sourceMessageId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200).nullable().optional(),
})

export type BranchThreadInput = z.infer<typeof branchThreadInputSchema>
export type BranchThreadOutput = SessionThreadRecord

const hasActiveRootJobStatus = (status: string): boolean =>
  status === 'queued' || status === 'running' || status === 'waiting'

const isBranchableMessage = (message: SessionMessageRecord): boolean =>
  message.authorKind === 'assistant'

const copyThreadMessagesThroughSource = (
  messages: SessionMessageRecord[],
  sourceMessageId: BranchThreadInput['sourceMessageId'],
): Result<SessionMessageRecord[], DomainError> => {
  const sourceMessage = messages.find((message) => message.id === sourceMessageId)

  if (!sourceMessage) {
    return err({
      message: `message ${sourceMessageId} does not belong to the source thread`,
      type: 'conflict',
    })
  }

  if (!isBranchableMessage(sourceMessage)) {
    return err({
      message: `message ${sourceMessageId} cannot be used as a branch point`,
      type: 'conflict',
    })
  }

  return ok(messages.filter((message) => message.sequence <= sourceMessage.sequence))
}

export const parseBranchThreadInput = (input: unknown): CommandResult<BranchThreadInput> => {
  const parsed = branchThreadInputSchema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export const createBranchThreadCommand = () => ({
  execute: (
    context: CommandContext,
    threadId: SessionThreadId,
    input: BranchThreadInput,
  ): CommandResult<BranchThreadOutput> => {
    try {
      const resourceAccess = createResourceAccessService(context.db)
      const authorizedThread = resourceAccess.requireThreadAccess(context.tenantScope, threadId)

      if (!authorizedThread.ok) {
        return authorizedThread
      }

      if (authorizedThread.value.session.status !== 'active') {
        return err({
          message: `session ${authorizedThread.value.session.id} is not active`,
          type: 'conflict',
        })
      }

      if (authorizedThread.value.thread.status !== 'active') {
        return err({
          message: `thread ${threadId} is not active`,
          type: 'conflict',
        })
      }

      const latestRootJob = loadThreadRootJobReadModel(context.db, context.tenantScope, threadId)

      if (!latestRootJob.ok) {
        return latestRootJob
      }

      if (latestRootJob.value && hasActiveRootJobStatus(latestRootJob.value.status)) {
        return err({
          message: `thread ${threadId} cannot be branched while its latest run is still active`,
          type: 'conflict',
        })
      }

      const sessionMessageRepository = createSessionMessageRepository(context.db)
      const sourceThreadMessages = sessionMessageRepository.listByThreadId(
        context.tenantScope,
        threadId,
      )

      if (!sourceThreadMessages.ok) {
        return sourceThreadMessages
      }

      const branchSourceMessages = copyThreadMessagesThroughSource(
        sourceThreadMessages.value,
        input.sourceMessageId,
      )

      if (!branchSourceMessages.ok) {
        return branchSourceMessages
      }

      const sourceMessage = branchSourceMessages.value.at(-1)

      if (!sourceMessage) {
        return err({
          message: `thread ${threadId} has no messages to branch`,
          type: 'conflict',
        })
      }

      return withTransaction(context.db, (tx) => {
        const eventStore = createEventStore(tx)
        const fileLinkRepository = createFileLinkRepository(tx)
        const fileRepository = createFileRepository(tx)
        const resourceAccessTx = createResourceAccessService(tx)
        const sessionMessageRepositoryTx = createSessionMessageRepository(tx)
        const sessionThreadRepository = createSessionThreadRepository(tx)
        const now = context.services.clock.nowIso()
        const sourceThread = authorizedThread.value.thread
        const branchedThread = unwrapCommandResultOrThrow(
          sessionThreadRepository.create(context.tenantScope, {
            branchFromMessageId: sourceMessage.id,
            branchFromSequence: sourceMessage.sequence,
            createdAt: now,
            createdByAccountId: context.tenantScope.accountId,
            id: asSessionThreadId(context.services.ids.create('thr')),
            parentThreadId: sourceThread.id,
            sessionId: sourceThread.sessionId,
            title: input.title ?? sourceThread.title ?? null,
            titleSource: input.title ? 'manual' : (sourceThread.titleSource ?? null),
            updatedAt: now,
          }),
        )

        const messageFileLinks = unwrapCommandResultOrThrow(
          fileRepository.listByMessageIds(
            context.tenantScope,
            branchSourceMessages.value.map((message) => message.id),
          ),
        )
        const fileIdsBySourceMessageId = new Map<string, FileId[]>()

        for (const link of messageFileLinks) {
          const current = fileIdsBySourceMessageId.get(link.messageId) ?? []
          current.push(link.file.id)
          fileIdsBySourceMessageId.set(link.messageId, current)
        }

        for (const [index, sourceBranchMessage] of branchSourceMessages.value.entries()) {
          const copiedMessage = unwrapCommandResultOrThrow(
            sessionMessageRepositoryTx.create(context.tenantScope, {
              authorAccountId: sourceBranchMessage.authorAccountId,
              authorKind: sourceBranchMessage.authorKind,
              content: sourceBranchMessage.content,
              createdAt: sourceBranchMessage.createdAt,
              id: asSessionMessageId(context.services.ids.create('msg')),
              metadata: sourceBranchMessage.metadata,
              runId: null,
              sequence: index + 1,
              sessionId: branchedThread.sessionId,
              threadId: branchedThread.id,
            }),
          )

          const messageFileIds = fileIdsBySourceMessageId.get(sourceBranchMessage.id) ?? []

          if (messageFileIds.length > 0) {
            unwrapCommandResultOrThrow(
              ensureFilesAttachedToMessage(
                context,
                {
                  db: tx,
                  eventStore,
                  fileLinkRepository,
                  now,
                  resourceAccess: resourceAccessTx,
                  sessionId: branchedThread.sessionId,
                },
                {
                  fileIds: messageFileIds,
                  messageId: copiedMessage.id,
                },
              ),
            )
          }
        }

        unwrapCommandResultOrThrow(
          eventStore.append({
            actorAccountId: context.tenantScope.accountId,
            aggregateId: branchedThread.id,
            aggregateType: 'session_thread',
            outboxTopics: ['projection', 'realtime'],
            payload: {
              branchFromMessageId: branchedThread.branchFromMessageId,
              branchFromSequence: branchedThread.branchFromSequence,
              parentThreadId: branchedThread.parentThreadId,
              sessionId: branchedThread.sessionId,
              threadId: branchedThread.id,
            },
            tenantId: context.tenantScope.tenantId,
            traceId: context.traceId,
            type: 'thread.created',
          }),
        )

        return ok(branchedThread)
      })
    } catch (error) {
      if (error instanceof DomainErrorException) {
        return err(error.domainError)
      }

      const message = error instanceof Error ? error.message : 'Unknown branch thread failure'

      return err({
        message: `failed to branch thread ${threadId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
