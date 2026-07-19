import { z } from 'zod'
import { createSessionThreadRepository } from '../persistence/repositories'
import { createTenantMembershipRepository } from '../persistence/repositories'
import { withTransaction } from '../../db/transaction'
import type { SessionThreadRecord } from '../../domain/sessions/session-thread-repository'
import { DomainErrorException } from '../../shared/errors'
import type { SessionThreadId, WorkSessionId } from '../../shared/ids'
import { asSessionThreadId } from '../../shared/ids'
import { err, ok } from '../../shared/result'
import { createResourceAccessService } from '../access/resource-access'
import type { CommandContext, CommandResult } from './command-context'
import { unwrapCommandResultOrThrow } from './command-result'
import { createEventStore } from './event-store'

const createSessionThreadInputSchema = z.object({
  parentThreadId: z.string().trim().min(1).max(200).nullable().optional(),
  title: z.string().trim().min(1).max(200).nullable().optional(),
})

export type CreateSessionThreadInput = z.infer<typeof createSessionThreadInputSchema>
export type CreateSessionThreadOutput = SessionThreadRecord

export const parseCreateSessionThreadInput = (
  input: unknown,
): CommandResult<CreateSessionThreadInput> => {
  const parsed = createSessionThreadInputSchema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export const createCreateSessionThreadCommand = () => ({
  execute: (
    context: CommandContext,
    sessionId: WorkSessionId,
    input: CreateSessionThreadInput,
  ): CommandResult<CreateSessionThreadOutput> => {
    try {
      const membershipRepository = createTenantMembershipRepository(context.db)
      const membership = membershipRepository.requireMembership(context.tenantScope)

      if (!membership.ok) {
        return membership
      }

      const resourceAccess = createResourceAccessService(context.db)
      const session = resourceAccess.requireSessionAccess(context.tenantScope, sessionId)

      if (!session.ok) {
        return session
      }

      if (session.value.status !== 'active') {
        return err({
          message: `session ${sessionId} is not active`,
          type: 'conflict',
        })
      }

      let parentThreadId: SessionThreadId | null = null

      if (input.parentThreadId) {
        const parentThread = resourceAccess.requireThreadAccess(
          context.tenantScope,
          asSessionThreadId(input.parentThreadId),
        )

        if (!parentThread.ok) {
          return parentThread
        }

        if (parentThread.value.thread.sessionId !== sessionId) {
          return err({
            message: `parent thread ${input.parentThreadId} does not belong to session ${sessionId}`,
            type: 'conflict',
          })
        }

        if (parentThread.value.thread.status !== 'active') {
          return err({
            message: `parent thread ${input.parentThreadId} is not active`,
            type: 'conflict',
          })
        }

        parentThreadId = parentThread.value.thread.id
      }

      return withTransaction(context.db, (tx) => {
        const threadRepository = createSessionThreadRepository(tx)
        const eventStore = createEventStore(tx)
        const now = context.services.clock.nowIso()
        const thread = unwrapCommandResultOrThrow(
          threadRepository.create(context.tenantScope, {
            createdAt: now,
            createdByAccountId: context.tenantScope.accountId,
            id: asSessionThreadId(context.services.ids.create('thr')),
            parentThreadId,
            sessionId,
            title: input.title ?? null,
            titleSource: input.title ? 'manual' : null,
            updatedAt: now,
          }),
        )

        unwrapCommandResultOrThrow(
          eventStore.append({
            actorAccountId: context.tenantScope.accountId,
            aggregateId: thread.id,
            aggregateType: 'session_thread',
            outboxTopics: ['projection', 'realtime'],
            payload: {
              parentThreadId: thread.parentThreadId,
              sessionId,
              threadId: thread.id,
            },
            tenantId: context.tenantScope.tenantId,
            traceId: context.traceId,
            type: 'thread.created',
          }),
        )

        return ok(thread)
      })
    } catch (error) {
      if (error instanceof DomainErrorException) {
        return err(error.domainError)
      }

      const message =
        error instanceof Error ? error.message : 'Unknown create session thread failure'

      return err({
        message: `failed to create thread in session ${sessionId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
