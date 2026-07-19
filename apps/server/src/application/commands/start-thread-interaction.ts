import { z } from 'zod'
import { createFileLinkRepository } from '../../adapters/persistence/sqlite/files/file-link-repository'
import { createTenantMembershipRepository } from '../../adapters/persistence/sqlite/tenancy/tenant-membership-repository'
import { withTransaction } from '../../db/transaction'
import { createJobRepository, type JobRecord } from '../../domain/runtime/job-repository'
import { reopenableJobStatuses } from '../../domain/runtime/job-types'
import { createRunRepository } from '../../domain/runtime/run-repository'
import {
  createSessionMessageRepository,
  type SessionMessageContentPart,
} from '../../domain/sessions/session-message-repository'
import { createWorkSessionRepository } from '../../domain/sessions/work-session-repository'
import { DomainErrorException } from '../../shared/errors'
import type {
  FileId,
  RunId,
  SessionMessageId,
  SessionThreadId,
  WorkSessionId,
} from '../../shared/ids'
import { asFileId, asJobId, asRunId, asSessionMessageId } from '../../shared/ids'
import { err, ok } from '../../shared/result'
import { createResourceAccessService } from '../access/resource-access'
import { resolveRootRunAgentBinding } from '../agents/root-run-agent-binding'
import {
  resolveRootRunTargetSelection,
  rootRunTargetInputSchema,
} from '../agents/root-run-target-input'
import { withMessageAttachmentFileIds } from '../files/attachment-metadata'
import { appendThreadNamingRequestedEvent } from '../naming/thread-title-events'
import {
  appendJobCreatedEvents,
  appendJobStatusChangeEvent,
} from '../runtime/scheduling/job-events'
import { buildThreadInteractionJobQueueReason } from '../runtime/scheduling/job-status-reasons'
import { appendWorkspaceLifecycleEvents } from '../workspaces/workspace-events'
import { createWorkspaceService } from '../workspaces/workspace-service'
import type { CommandContext, CommandResult } from './command-context'
import { unwrapCommandResultOrThrow } from './command-result'
import { createEventStore } from './event-store'
import { ensureFilesAttachedToMessage } from './thread-message-files'

const textContentPartSchema = z.object({
  text: z.string().trim().min(1).max(10_000),
  type: z.literal('text'),
})

const startThreadInteractionInputSchema = z
  .object({
    content: z.array(textContentPartSchema).min(1).max(100).optional(),
    fileIds: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    maxOutputTokens: z.number().int().positive().max(100_000).optional(),
    messageId: z.string().trim().min(1).max(200).optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    model: z.string().trim().min(1).max(200).optional(),
    modelAlias: z.string().trim().min(1).max(200).optional(),
    provider: z.enum(['openai', 'google', 'openrouter']).optional(),
    reasoning: z
      .object({
        effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
        summary: z.enum(['auto', 'concise', 'detailed']).optional(),
      })
      .optional(),
    task: z.string().trim().min(1).max(10_000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    target: rootRunTargetInputSchema.optional(),
    text: z.string().trim().min(1).max(10_000).optional(),
  })
  .refine((value) => value.messageId || value.content || value.text, {
    message: 'Either messageId, text, or content is required',
  })

export type StartThreadInteractionInput = z.infer<typeof startThreadInteractionInputSchema>

export interface StartThreadInteractionOutput {
  attachedFileIds: FileId[]
  messageId: SessionMessageId
  runId: RunId
  sessionId: WorkSessionId
  threadId: SessionThreadId
}

const toContent = (input: StartThreadInteractionInput): SessionMessageContentPart[] =>
  input.content ?? [{ text: input.text!.trim(), type: 'text' as const }]

const deriveTask = (
  input: StartThreadInteractionInput,
  content: SessionMessageContentPart[],
): string =>
  input.task ??
  content
    .map((part) => part.text)
    .join('\n')
    .trim()

const pickReusableRootJob = (jobs: JobRecord[]): JobRecord | null => {
  const latestRootJob = jobs.filter((job) => job.parentJobId === null).at(-1) ?? null

  if (!latestRootJob) {
    return null
  }

  if (latestRootJob.status === 'queued' || reopenableJobStatuses.has(latestRootJob.status)) {
    return latestRootJob
  }

  return null
}

export const parseStartThreadInteractionInput = (
  input: unknown,
): CommandResult<StartThreadInteractionInput> => {
  const parsed = startThreadInteractionInputSchema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export const createStartThreadInteractionCommand = () => ({
  execute: (
    context: CommandContext,
    threadId: SessionThreadId,
    input: StartThreadInteractionInput,
  ): CommandResult<StartThreadInteractionOutput> => {
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

      const runRepository = createRunRepository(context.db)
      const activeRuns = runRepository.listActiveByThreadId(context.tenantScope, threadId)

      if (!activeRuns.ok) {
        return activeRuns
      }

      if (activeRuns.value.length > 0) {
        return err({
          message: `thread ${threadId} already has an active run`,
          type: 'conflict',
        })
      }

      const targetSelection = resolveRootRunTargetSelection({ target: input.target })

      const agentBinding = resolveRootRunAgentBinding(context.db, context.tenantScope, {
        agentId: targetSelection.agentId,
        useAccountDefaultAgent: targetSelection.useAccountDefaultAgent,
        overrides: {
          model: input.model ?? null,
          modelAlias: input.modelAlias ?? null,
          provider: input.provider ?? null,
          reasoning: input.reasoning ?? null,
        },
      })

      if (!agentBinding.ok) {
        return agentBinding
      }

      if (input.messageId && input.fileIds && input.fileIds.length > 0) {
        return err({
          message: 'fileIds cannot be used together with messageId reuse yet',
          type: 'validation',
        })
      }

      const result = withTransaction(context.db, (tx) => {
        const sessionMessageRepository = createSessionMessageRepository(tx)
        const workSessionRepository = createWorkSessionRepository(tx)
        const fileLinkRepository = createFileLinkRepository(tx)
        const txRunRepository = createRunRepository(tx)
        const jobRepository = createJobRepository(tx)
        const eventStore = createEventStore(tx)
        const now = context.services.clock.nowIso()
        const runId = asRunId(context.services.ids.create('run'))
        const workspaceService = createWorkspaceService(tx, {
          createId: context.services.ids.create,
          fileStorageRoot: context.config.files.storage.root,
        })
        const workspaceResolution = unwrapCommandResultOrThrow(
          workspaceService.requireWritableWorkspaceResolution(context.tenantScope, {
            nowIso: now,
            ownerAccountId: thread.value.session.createdByAccountId,
            workspaceId: thread.value.session.workspaceId,
          }),
        )
        const workspace = workspaceResolution.workspace
        const sessionWorkspaceRef = workspaceService.ensureSessionRef(
          workspace,
          thread.value.thread.sessionId,
        )
        const runWorkspaceRef = workspaceService.ensureRunRef(workspace, runId)
        let messageId = input.messageId ? asSessionMessageId(input.messageId) : null
        let content: SessionMessageContentPart[] | null = null
        let attachedFileIds: FileId[] = []
        let inputMessageSequence: number | null = null

        if (
          thread.value.session.workspaceId !== workspace.id ||
          thread.value.session.workspaceRef !== sessionWorkspaceRef
        ) {
          unwrapCommandResultOrThrow(
            workSessionRepository.assignWorkspace(context.tenantScope, {
              sessionId: thread.value.thread.sessionId,
              updatedAt: now,
              workspaceId: workspace.id,
              workspaceRef: sessionWorkspaceRef,
            }),
          )
        }

        if (messageId) {
          const existingMessage = unwrapCommandResultOrThrow(
            sessionMessageRepository.getById(context.tenantScope, messageId),
          )

          if (
            existingMessage.threadId !== threadId ||
            existingMessage.sessionId !== thread.value.thread.sessionId
          ) {
            throw new DomainErrorException({
              message: `message ${messageId} does not belong to thread ${threadId}`,
              type: 'conflict',
            })
          }

          if (existingMessage.authorKind !== 'user') {
            throw new DomainErrorException({
              message: `message ${messageId} is not a user message`,
              type: 'conflict',
            })
          }

          if (existingMessage.runId) {
            throw new DomainErrorException({
              message: `message ${messageId} is already bound to run ${existingMessage.runId}`,
              type: 'conflict',
            })
          }

          content = existingMessage.content
          inputMessageSequence = existingMessage.sequence
        } else {
          content = toContent(input)
          messageId = asSessionMessageId(context.services.ids.create('msg'))
          const sequence = unwrapCommandResultOrThrow(
            sessionMessageRepository.getNextSequence(context.tenantScope, threadId),
          )
          inputMessageSequence = sequence

          unwrapCommandResultOrThrow(
            sessionMessageRepository.create(context.tenantScope, {
              authorAccountId: context.tenantScope.accountId,
              content,
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
        }

        if (messageId && input.fileIds && input.fileIds.length > 0) {
          const attached = unwrapCommandResultOrThrow(
            ensureFilesAttachedToMessage(
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
                fileIds: input.fileIds.map((fileId) => asFileId(fileId)),
                messageId,
              },
            ),
          )

          attachedFileIds = attached

          unwrapCommandResultOrThrow(
            sessionMessageRepository.update(context.tenantScope, {
              messageId,
              metadata: withMessageAttachmentFileIds(input.metadata ?? null, attachedFileIds),
              sessionId: thread.value.thread.sessionId,
              threadId,
            }),
          )
        }

        const task = deriveTask(input, content)
        const reusableRootJob = pickReusableRootJob(
          unwrapCommandResultOrThrow(jobRepository.listByThreadId(context.tenantScope, threadId)),
        )
        let interactionJobId: ReturnType<typeof asJobId>
        let createdJob: JobRecord | null = null

        if (reusableRootJob) {
          const updatedJob = unwrapCommandResultOrThrow(
            jobRepository.update(context.tenantScope, {
              assignedAgentId: agentBinding.value.agentId,
              assignedAgentRevisionId: agentBinding.value.agentRevisionId,
              completedAt: null,
              currentRunId: runId,
              inputJson: {
                fileIds: attachedFileIds,
                inputMessageId: messageId,
                source: 'thread.interaction',
                task,
              },
              lastHeartbeatAt: now,
              lastSchedulerSyncAt: now,
              nextSchedulerCheckAt: null,
              queuedAt: now,
              resultJson: null,
              statusReasonJson: buildThreadInteractionJobQueueReason({
                inputMessageId: messageId,
                previousStatus: reusableRootJob.status,
                runId,
              }),
              status: 'queued',
              title: task,
              updatedAt: now,
              jobId: reusableRootJob.id,
            }),
          )

          if (reusableRootJob.status !== 'queued') {
            unwrapCommandResultOrThrow(
              appendJobStatusChangeEvent({
                eventStore,
                payload: {
                  inputMessageId: messageId,
                  previousStatus: reusableRootJob.status,
                  reason: 'thread.interaction',
                  updatedAt: now,
                },
                previousStatus: reusableRootJob.status,
                scope: context.tenantScope,
                traceId: context.traceId,
                typeOverride: 'job.requeued',
                job: updatedJob,
              }),
            )
          }

          interactionJobId = updatedJob.id
        } else {
          const jobId = asJobId(context.services.ids.create('job'))

          createdJob = unwrapCommandResultOrThrow(
            jobRepository.create(context.tenantScope, {
              assignedAgentId: agentBinding.value.agentId,
              assignedAgentRevisionId: agentBinding.value.agentRevisionId,
              createdAt: now,
              currentRunId: runId,
              id: jobId,
              inputJson: {
                fileIds: attachedFileIds,
                inputMessageId: messageId,
                source: 'thread.interaction',
                task,
              },
              kind: 'objective',
              lastSchedulerSyncAt: now,
              queuedAt: now,
              rootJobId: jobId,
              sessionId: thread.value.thread.sessionId,
              statusReasonJson: buildThreadInteractionJobQueueReason({
                inputMessageId: messageId,
                runId,
              }),
              status: 'queued',
              threadId,
              title: task,
              updatedAt: now,
            }),
          )

          interactionJobId = createdJob.id
        }

        unwrapCommandResultOrThrow(
          txRunRepository.create(context.tenantScope, {
            actorAccountId: context.tenantScope.accountId,
            agentId: agentBinding.value.agentId,
            agentRevisionId: agentBinding.value.agentRevisionId,
            configSnapshot: {
              apiBasePath: context.config.api.basePath,
              model: agentBinding.value.resolvedConfigSnapshot.model,
              modelAlias: agentBinding.value.resolvedConfigSnapshot.modelAlias,
              provider: agentBinding.value.resolvedConfigSnapshot.provider,
              reasoning: agentBinding.value.resolvedConfigSnapshot.reasoning,
              version: context.config.api.version,
            },
            createdAt: now,
            id: runId,
            rootRunId: runId,
            sessionId: thread.value.thread.sessionId,
            startedAt: now,
            task,
            targetKind: agentBinding.value.targetKind,
            threadId,
            toolProfileId: agentBinding.value.toolProfileId,
            jobId: interactionJobId,
            workspaceId: workspace.id,
            workspaceRef: runWorkspaceRef,
          }),
        )

        unwrapCommandResultOrThrow(
          sessionMessageRepository.assignRun(context.tenantScope, {
            messageId,
            runId,
            sessionId: thread.value.thread.sessionId,
            threadId,
          }),
        )

        if (createdJob) {
          unwrapCommandResultOrThrow(
            appendJobCreatedEvents({
              eventStore,
              scope: context.tenantScope,
              traceId: context.traceId,
              job: createdJob,
            }),
          )
        }

        unwrapCommandResultOrThrow(
          eventStore.append({
            actorAccountId: context.tenantScope.accountId,
            aggregateId: runId,
            aggregateType: 'run',
            payload: {
              agentId: agentBinding.value.agentId,
              ...(agentBinding.value.agentName ? { agentName: agentBinding.value.agentName } : {}),
              agentRevisionId: agentBinding.value.agentRevisionId,
              rootRunId: runId,
              runId,
              sessionId: thread.value.thread.sessionId,
              targetKind: agentBinding.value.targetKind,
              task,
              threadId,
            },
            tenantId: context.tenantScope.tenantId,
            traceId: context.traceId,
            type: 'run.created',
          }),
        )

        if (inputMessageSequence === 1 && thread.value.thread.title === null) {
          appendThreadNamingRequestedEvent(context, eventStore, {
            requestId: context.services.ids.create('tnr'),
            requestedAt: now,
            sessionId: thread.value.thread.sessionId,
            sourceRunId: runId,
            threadId,
            trigger: 'auto_first_message',
          })
        }

        appendWorkspaceLifecycleEvents(context, eventStore, {
          reason: 'thread.interaction',
          resolution: workspaceResolution,
          rootRunId: runId,
          runId,
          sessionId: thread.value.thread.sessionId,
          threadId,
          workspaceRef: runWorkspaceRef,
        })

        return ok({
          attachedFileIds,
          messageId,
          runId,
          sessionId: thread.value.thread.sessionId,
          threadId,
        })
      })

      if (result.ok) {
        context.services.multiagent.wake()
      }

      return result
    } catch (error) {
      if (error instanceof DomainErrorException) {
        return err(error.domainError)
      }

      const message =
        error instanceof Error ? error.message : 'Unknown start thread interaction failure'

      return err({
        message: `failed to start thread interaction: ${message}`,
        type: 'conflict',
      })
    }
  },
})
