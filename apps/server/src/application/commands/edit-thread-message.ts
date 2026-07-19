import { z } from 'zod'
import { createFileLinkRepository } from '../../adapters/persistence/sqlite/files/file-link-repository'
import { createTenantMembershipRepository } from '../../adapters/persistence/sqlite/tenancy/tenant-membership-repository'
import { withTransaction } from '../../db/transaction'
import { createJobRepository } from '../../domain/runtime/job-repository'
import { createRunRepository } from '../../domain/runtime/run-repository'
import {
  createSessionMessageRepository,
  type SessionMessageContentPart,
} from '../../domain/sessions/session-message-repository'
import { DomainErrorException } from '../../shared/errors'
import type { FileId, SessionMessageId, SessionThreadId, WorkSessionId } from '../../shared/ids'
import { asFileId } from '../../shared/ids'
import { err, ok } from '../../shared/result'
import { createResourceAccessService } from '../access/resource-access'
import { withMessageAttachmentFileIds } from '../files/attachment-metadata'
import { buildNewUserMessageJobQueueReason } from '../runtime/scheduling/job-status-reasons'
import type { CommandContext, CommandResult } from './command-context'
import { unwrapCommandResultOrThrow } from './command-result'
import { createEventStore } from './event-store'
import { pruneThreadHistoryInTransaction } from './thread-history-pruning'
import { replaceMessageFiles } from './thread-message-files'

const textContentPartSchema = z.object({
  text: z.string().trim().min(1).max(10_000),
  type: z.literal('text'),
})

const editThreadMessageInputSchema = z
  .object({
    content: z.array(textContentPartSchema).min(1).max(100).optional(),
    fileIds: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    text: z.string().trim().min(1).max(10_000).optional(),
  })
  .refine((value) => value.content || value.text || value.fileIds.length > 0, {
    message: 'Either text, content, or fileIds is required',
  })

export type EditThreadMessageInput = z.infer<typeof editThreadMessageInputSchema>

export interface EditThreadMessageOutput {
  attachedFileIds: FileId[]
  messageId: SessionMessageId
  sessionId: WorkSessionId
  threadId: SessionThreadId
}

const toContent = (input: EditThreadMessageInput): SessionMessageContentPart[] =>
  input.content ?? (input.text ? [{ text: input.text.trim(), type: 'text' as const }] : [])

export const parseEditThreadMessageInput = (
  input: unknown,
): CommandResult<EditThreadMessageInput> => {
  const parsed = editThreadMessageInputSchema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export const createEditThreadMessageCommand = () => ({
  execute: async (
    context: CommandContext,
    input: {
      input: EditThreadMessageInput
      messageId: SessionMessageId
      threadId: SessionThreadId
    },
  ): Promise<CommandResult<EditThreadMessageOutput>> => {
    try {
      const membershipRepository = createTenantMembershipRepository(context.db)
      const membership = membershipRepository.requireMembership(context.tenantScope)

      if (!membership.ok) {
        return membership
      }

      const resourceAccess = createResourceAccessService(context.db)
      const thread = resourceAccess.requireThreadAccess(context.tenantScope, input.threadId)

      if (!thread.ok) {
        return thread
      }

      if (thread.value.thread.status !== 'active') {
        return err({
          message: `thread ${input.threadId} is not active`,
          type: 'conflict',
        })
      }

      if (thread.value.session.status !== 'active') {
        return err({
          message: `session ${thread.value.session.id} is not active`,
          type: 'conflict',
        })
      }

      const runRepository = createRunRepository(context.db)
      const activeRuns = runRepository.listActiveByThreadId(context.tenantScope, input.threadId)

      if (!activeRuns.ok) {
        return activeRuns
      }

      if (activeRuns.value.length > 0) {
        return err({
          message: `thread ${input.threadId} already has an active run`,
          type: 'conflict',
        })
      }

      const transactionResult = withTransaction(context.db, (tx) => {
        const sessionMessageRepository = createSessionMessageRepository(tx)
        const fileLinkRepository = createFileLinkRepository(tx)
        const jobRepository = createJobRepository(tx)
        const eventStore = createEventStore(tx)
        const now = context.services.clock.nowIso()
        const existingMessage = unwrapCommandResultOrThrow(
          sessionMessageRepository.getById(context.tenantScope, input.messageId),
        )
        const nextMetadataBase =
          input.input.metadata !== undefined ? input.input.metadata : existingMessage.metadata

        if (
          existingMessage.threadId !== input.threadId ||
          existingMessage.sessionId !== thread.value.thread.sessionId
        ) {
          throw new DomainErrorException({
            message: `message ${input.messageId} does not belong to thread ${input.threadId}`,
            type: 'conflict',
          })
        }

        if (existingMessage.authorKind !== 'user') {
          throw new DomainErrorException({
            message: `message ${input.messageId} is not a user message`,
            type: 'conflict',
          })
        }

        const downstreamMessages = unwrapCommandResultOrThrow(
          sessionMessageRepository.listAfterSequence(
            context.tenantScope,
            input.threadId,
            existingMessage.sequence,
          ),
        )
        const rootRunIdsToDelete = [
          ...new Set(
            [existingMessage.runId, ...downstreamMessages.map((message) => message.runId)].filter(
              (runId): runId is NonNullable<typeof runId> => runId !== null,
            ),
          ),
        ]
        const threadJobs = unwrapCommandResultOrThrow(
          jobRepository.listByThreadId(context.tenantScope, input.threadId),
        )
        const latestRootJob = threadJobs.filter((job) => job.parentJobId === null).at(-1) ?? null

        if (latestRootJob) {
          unwrapCommandResultOrThrow(
            jobRepository.update(context.tenantScope, {
              completedAt: null,
              currentRunId: null,
              lastSchedulerSyncAt: now,
              nextSchedulerCheckAt: null,
              queuedAt: now,
              resultJson: null,
              statusReasonJson: buildNewUserMessageJobQueueReason({
                messageId: input.messageId,
                previousStatus: latestRootJob.status,
                threadId: input.threadId,
              }),
              status: 'queued',
              updatedAt: now,
              jobId: latestRootJob.id,
            }),
          )
        }

        unwrapCommandResultOrThrow(
          sessionMessageRepository.update(context.tenantScope, {
            content: toContent(input.input),
            messageId: input.messageId,
            runId: null,
            sessionId: thread.value.thread.sessionId,
            threadId: input.threadId,
          }),
        )

        const pruned = unwrapCommandResultOrThrow(
          pruneThreadHistoryInTransaction(tx, {
            messageIds: downstreamMessages.map((message) => message.id),
            preserveWorkItemIds: latestRootJob ? [latestRootJob.id] : [],
            rootRunIds: rootRunIdsToDelete,
            sessionId: thread.value.thread.sessionId,
            tenantId: context.tenantScope.tenantId,
          }),
        )

        const replacedFiles = unwrapCommandResultOrThrow(
          replaceMessageFiles(
            context,
            {
              db: tx,
              eventStore,
              fileLinkRepository,
              now,
              resourceAccess,
              sessionId: thread.value.thread.sessionId,
            },
            {
              fileIds: input.input.fileIds.map((fileId) => asFileId(fileId)),
              messageId: input.messageId,
            },
          ),
        )

        unwrapCommandResultOrThrow(
          sessionMessageRepository.update(context.tenantScope, {
            messageId: input.messageId,
            metadata: withMessageAttachmentFileIds(nextMetadataBase, replacedFiles.attachedFileIds),
            sessionId: thread.value.thread.sessionId,
            threadId: input.threadId,
          }),
        )

        return ok({
          attachedFileIds: replacedFiles.attachedFileIds,
          blobStorageKeys: [
            ...new Set([...pruned.blobStorageKeys, ...replacedFiles.blobStorageKeys]),
          ],
          messageId: input.messageId,
          sessionId: thread.value.thread.sessionId,
          threadId: input.threadId,
        })
      })

      if (!transactionResult.ok) {
        return transactionResult
      }

      for (const storageKey of transactionResult.value.blobStorageKeys) {
        const deletedBlob = await context.services.files.blobStore.delete(storageKey)

        if (!deletedBlob.ok) {
          return deletedBlob
        }
      }

      return ok({
        attachedFileIds: transactionResult.value.attachedFileIds,
        messageId: transactionResult.value.messageId,
        sessionId: transactionResult.value.sessionId,
        threadId: transactionResult.value.threadId,
      })
    } catch (error) {
      if (error instanceof DomainErrorException) {
        return err(error.domainError)
      }

      const message = error instanceof Error ? error.message : 'Unknown edit thread message failure'

      return err({
        message: `failed to edit thread message ${input.messageId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
