import { z } from 'zod'
import { withTransaction } from '../../db/transaction'
import type { SessionMessageContentPart } from '../../domain/sessions/session-message-repository'
import { DomainErrorException } from '../../shared/errors'
import type { SessionMessageId, SessionThreadId, WorkSessionId } from '../../shared/ids'
import { asSessionMessageId } from '../../shared/ids'
import { err, ok } from '../../shared/result'
import { createResourceAccessService } from '../access/resource-access'
import {
  createSessionMessageRepository,
  createTenantMembershipRepository,
} from '../persistence/repositories'
import { reopenThreadRootJobForNewMessage } from '../runtime/scheduling/job-sync'
import type { CommandContext, CommandResult } from './command-context'
import { unwrapCommandResultOrThrow } from './command-result'
import { createEventStore } from './event-store'

const textContentPartSchema = z.object({
  text: z.string().trim().min(1).max(10_000),
  type: z.literal('text'),
})

const postThreadMessageInputSchema = z
  .object({
    content: z.array(textContentPartSchema).min(1).max(100).optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    text: z.string().trim().min(1).max(10_000).optional(),
  })
  .refine((value) => value.content || value.text, {
    message: 'Either text or content is required',
  })

export type PostThreadMessageInput = z.infer<typeof postThreadMessageInputSchema>

export interface PostThreadMessageOutput {
  messageId: SessionMessageId
  sequence: number
  sessionId: WorkSessionId
  threadId: SessionThreadId
}

const toContent = (input: PostThreadMessageInput): SessionMessageContentPart[] =>
  input.content ?? [{ text: input.text!.trim(), type: 'text' as const }]

export const parsePostThreadMessageInput = (
  input: unknown,
): CommandResult<PostThreadMessageInput> => {
  const parsed = postThreadMessageInputSchema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export const createPostThreadMessageCommand = () => ({
  execute: (
    context: CommandContext,
    threadId: SessionThreadId,
    input: PostThreadMessageInput,
  ): CommandResult<PostThreadMessageOutput> => {
    try {
      const membershipRepository = createTenantMembershipRepository(context.db)
      const membership = membershipRepository.requireMembership(context.tenantScope)

      if (!membership.ok) {
        return membership
      }

      const resourceAccess = createResourceAccessService(context.db)
      const thread = resourceAccess.requireThreadAccess(context.tenantScope, threadId)

      if (!thread.ok) {
        return thread
      }

      if (thread.value.thread.status !== 'active') {
        return err({
          message: `thread ${threadId} is not active`,
          type: 'conflict',
        })
      }

      if (thread.value.session.status !== 'active') {
        return err({
          message: `session ${thread.value.session.id} is not active`,
          type: 'conflict',
        })
      }

      return withTransaction(context.db, (tx) => {
        const sessionMessageRepository = createSessionMessageRepository(tx)
        const eventStore = createEventStore(tx)
        const now = context.services.clock.nowIso()
        const messageId = asSessionMessageId(context.services.ids.create('msg'))
        const sequence = unwrapCommandResultOrThrow(
          sessionMessageRepository.getNextSequence(context.tenantScope, threadId),
        )

        unwrapCommandResultOrThrow(
          sessionMessageRepository.create(context.tenantScope, {
            authorAccountId: context.tenantScope.accountId,
            content: toContent(input),
            createdAt: now,
            id: messageId,
            metadata: input.metadata ?? null,
            runId: null,
            sequence,
            sessionId: thread.value.thread.sessionId,
            threadId,
          }),
        )

        unwrapCommandResultOrThrow(
          eventStore.append({
            actorAccountId: context.tenantScope.accountId,
            aggregateId: messageId,
            aggregateType: 'session_message',
            outboxTopics: ['projection', 'realtime'],
            payload: {
              messageId,
              sessionId: thread.value.thread.sessionId,
              threadId,
            },
            tenantId: context.tenantScope.tenantId,
            traceId: context.traceId,
            type: 'message.posted',
          }),
        )

        unwrapCommandResultOrThrow(
          reopenThreadRootJobForNewMessage(tx, context.tenantScope, {
            eventContext: {
              eventStore,
              traceId: context.traceId,
            },
            messageId,
            threadId,
            updatedAt: now,
          }),
        )

        return ok({
          messageId,
          sequence,
          sessionId: thread.value.thread.sessionId,
          threadId,
        })
      })
    } catch (error) {
      if (error instanceof DomainErrorException) {
        return err(error.domainError)
      }

      const message = error instanceof Error ? error.message : 'Unknown post thread message failure'

      return err({
        message: `failed to post thread message: ${message}`,
        type: 'conflict',
      })
    }
  },
})
