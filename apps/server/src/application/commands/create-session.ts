import { z } from 'zod'
import { createWorkSessionRepository } from '../persistence/repositories'
import { createTenantMembershipRepository } from '../persistence/repositories'
import { withTransaction } from '../../db/transaction'
import type { WorkSessionRecord } from '../../domain/sessions/work-session-repository'
import { DomainErrorException } from '../../shared/errors'
import { asWorkSessionId } from '../../shared/ids'
import { err, ok } from '../../shared/result'
import { appendWorkspaceLifecycleEvents } from '../workspaces/workspace-events'
import { createWorkspaceService } from '../workspaces/workspace-service'
import type { CommandContext, CommandResult } from './command-context'
import { unwrapCommandResultOrThrow } from './command-result'
import { createEventStore } from './event-store'

const createSessionInputSchema = z.object({
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  title: z.string().trim().min(1).max(200).nullable().optional(),
  workspaceRef: z.string().trim().min(1).max(500).nullable().optional(),
})

export type CreateSessionInput = z.infer<typeof createSessionInputSchema>
export type CreateSessionOutput = WorkSessionRecord

export const parseCreateSessionInput = (input: unknown): CommandResult<CreateSessionInput> => {
  const parsed = createSessionInputSchema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export const createCreateSessionCommand = () => ({
  execute: (
    context: CommandContext,
    input: CreateSessionInput,
  ): CommandResult<CreateSessionOutput> => {
    try {
      const membershipRepository = createTenantMembershipRepository(context.db)
      const membership = membershipRepository.requireMembership(context.tenantScope)

      if (!membership.ok) {
        return membership
      }

      return withTransaction(context.db, (tx) => {
        const workSessionRepository = createWorkSessionRepository(tx)
        const eventStore = createEventStore(tx)
        const now = context.services.clock.nowIso()
        const sessionId = asWorkSessionId(context.services.ids.create('ses'))
        const workspaceService = createWorkspaceService(tx, {
          createId: context.services.ids.create,
          fileStorageRoot: context.config.files.storage.root,
        })
        const workspaceResolution = unwrapCommandResultOrThrow(
          workspaceService.ensureAccountWorkspaceResolution(context.tenantScope, {
            nowIso: now,
          }),
        )
        const workspace = workspaceResolution.workspace
        const sessionWorkspaceRef = workspaceService.ensureSessionRef(workspace, sessionId)
        const session = unwrapCommandResultOrThrow(
          workSessionRepository.create(context.tenantScope, {
            createdAt: now,
            createdByAccountId: context.tenantScope.accountId,
            id: sessionId,
            metadata: input.metadata ?? null,
            status: 'active',
            title: input.title ?? null,
            updatedAt: now,
            workspaceId: workspace.id,
            workspaceRef: sessionWorkspaceRef,
          }),
        )

        appendWorkspaceLifecycleEvents(context, eventStore, {
          reason: 'session.create',
          resolution: workspaceResolution,
          sessionId: session.id,
          workspaceRef: sessionWorkspaceRef,
        })

        unwrapCommandResultOrThrow(
          eventStore.append({
            actorAccountId: context.tenantScope.accountId,
            aggregateId: session.id,
            aggregateType: 'work_session',
            outboxTopics: ['projection', 'realtime'],
            payload: {
              sessionId: session.id,
              title: session.title,
            },
            tenantId: context.tenantScope.tenantId,
            traceId: context.traceId,
            type: 'session.created',
          }),
        )

        return ok(session)
      })
    } catch (error) {
      if (error instanceof DomainErrorException) {
        return err(error.domainError)
      }

      const message = error instanceof Error ? error.message : 'Unknown create session failure'

      return err({
        message: `failed to create session: ${message}`,
        type: 'conflict',
      })
    }
  },
})
