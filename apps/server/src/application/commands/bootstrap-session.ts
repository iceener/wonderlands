import { z } from 'zod'
import type { AppTransaction } from '../../db/transaction'
import { withTransaction } from '../../db/transaction'
import { DomainErrorException } from '../../shared/errors'
import type {
  JobId,
  RunId,
  SessionMessageId,
  SessionThreadId,
  WorkSessionId,
} from '../../shared/ids'
import {
  asJobId,
  asRunId,
  asSessionMessageId,
  asSessionThreadId,
  asWorkSessionId,
} from '../../shared/ids'
import { err, ok } from '../../shared/result'
import type { RootRunAgentBinding } from '../agents/root-run-agent-binding'
import { resolveRootRunAgentBinding } from '../agents/root-run-agent-binding'
import {
  resolveRootRunTargetSelection,
  rootRunTargetInputSchema,
} from '../agents/root-run-target-input'
import { appendThreadNamingRequestedEvent } from '../naming/thread-title-events'
import {
  createJobRepository,
  createRunRepository,
  createSessionMessageRepository,
  createSessionThreadRepository,
  createTenantMembershipRepository,
  createWorkSessionRepository,
} from '../persistence/repositories'
import { appendJobCreatedEvents } from '../runtime/scheduling/job-events'
import { buildSessionBootstrapJobQueueReason } from '../runtime/scheduling/job-status-reasons'
import { appendWorkspaceLifecycleEvents } from '../workspaces/workspace-events'
import { createWorkspaceService } from '../workspaces/workspace-service'
import type { CommandContext, CommandResult } from './command-context'
import { unwrapCommandResultOrThrow } from './command-result'
import { createEventStore } from './event-store'

const bootstrapSessionInputSchema = z.object({
  execute: z.boolean().optional(),
  initialMessage: z.string().trim().min(1).max(10_000),
  maxOutputTokens: z.number().int().positive().max(100_000).optional(),
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
  threadTitle: z.string().trim().min(1).max(200).nullable().optional(),
  title: z.string().trim().min(1).max(200).nullable().optional(),
  workspaceRef: z.string().trim().min(1).max(500).nullable().optional(),
})

export type BootstrapSessionInput = z.infer<typeof bootstrapSessionInputSchema>

export interface BootstrapSessionOutput {
  jobId: JobId
  messageId: SessionMessageId
  runId: RunId
  sessionId: WorkSessionId
  threadId: SessionThreadId
}

export interface BootstrapSessionTransactionInput {
  agentBinding: RootRunAgentBinding
  initialMessage: string
  metadata?: Record<string, unknown> | null
  sourceMetadata?: Record<string, unknown>
  task?: string
  threadTitle?: string | null
  title?: string | null
}

export const parseBootstrapSessionInput = (
  input: unknown,
): CommandResult<BootstrapSessionInput> => {
  const parsed = bootstrapSessionInputSchema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

// Creates the full session/thread/message/job/run graph on the provided
// transaction handle and throws DomainErrorException on failure, so callers
// (normal bootstrap and scheduled-task fires) can compose it with their own
// transactional writes.
export const runBootstrapSessionTransaction = (
  tx: AppTransaction,
  context: CommandContext,
  input: BootstrapSessionTransactionInput,
): BootstrapSessionOutput => {
  const agentBinding = input.agentBinding
  const workSessionRepository = createWorkSessionRepository(tx)
  const sessionThreadRepository = createSessionThreadRepository(tx)
  const sessionMessageRepository = createSessionMessageRepository(tx)
  const runRepository = createRunRepository(tx)
  const eventStore = createEventStore(tx)

  const now = context.services.clock.nowIso()
  const sessionId = asWorkSessionId(context.services.ids.create('ses'))
  const threadId = asSessionThreadId(context.services.ids.create('thr'))
  const messageId = asSessionMessageId(context.services.ids.create('msg'))
  const runId = asRunId(context.services.ids.create('run'))
  const jobId = asJobId(context.services.ids.create('job'))
  const content = [{ text: input.initialMessage, type: 'text' as const }]
  const sessionTitle = input.title ?? null
  const threadTitle = input.threadTitle ?? sessionTitle
  const sessionMetadata = input.sourceMetadata
    ? { ...(input.metadata ?? {}), source: input.sourceMetadata }
    : (input.metadata ?? null)
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
  const runWorkspaceRef = workspaceService.ensureRunRef(workspace, runId)

  const createdSession = unwrapCommandResultOrThrow(
    workSessionRepository.create(context.tenantScope, {
      createdAt: now,
      createdByAccountId: context.tenantScope.accountId,
      id: sessionId,
      metadata: sessionMetadata,
      status: 'active',
      title: sessionTitle,
      updatedAt: now,
      workspaceId: workspace.id,
      workspaceRef: sessionWorkspaceRef,
    }),
  )

  unwrapCommandResultOrThrow(
    sessionThreadRepository.create(context.tenantScope, {
      createdAt: now,
      createdByAccountId: context.tenantScope.accountId,
      id: threadId,
      sessionId,
      title: threadTitle,
      titleSource: threadTitle ? 'manual' : null,
      updatedAt: now,
    }),
  )

  const createdJob = unwrapCommandResultOrThrow(
    createJobRepository(tx).create(context.tenantScope, {
      assignedAgentId: agentBinding.agentId,
      assignedAgentRevisionId: agentBinding.agentRevisionId,
      createdAt: now,
      currentRunId: runId,
      id: jobId,
      inputJson: {
        messageId,
        source: 'session.bootstrap',
        task: input.task ?? input.initialMessage,
        ...(input.sourceMetadata ? { sourceMetadata: input.sourceMetadata } : {}),
      },
      kind: 'objective',
      lastSchedulerSyncAt: now,
      queuedAt: now,
      rootJobId: jobId,
      sessionId,
      statusReasonJson: buildSessionBootstrapJobQueueReason({
        runId,
      }),
      status: 'queued',
      threadId,
      title: input.task ?? input.initialMessage,
      updatedAt: now,
    }),
  )

  unwrapCommandResultOrThrow(
    runRepository.create(context.tenantScope, {
      actorAccountId: context.tenantScope.accountId,
      agentId: agentBinding.agentId,
      agentRevisionId: agentBinding.agentRevisionId,
      configSnapshot: {
        apiBasePath: context.config.api.basePath,
        model: agentBinding.resolvedConfigSnapshot.model,
        modelAlias: agentBinding.resolvedConfigSnapshot.modelAlias,
        provider: agentBinding.resolvedConfigSnapshot.provider,
        reasoning: agentBinding.resolvedConfigSnapshot.reasoning,
        version: context.config.api.version,
      },
      createdAt: now,
      id: runId,
      rootRunId: runId,
      sessionId,
      startedAt: now,
      task: input.task ?? input.initialMessage,
      targetKind: agentBinding.targetKind,
      threadId,
      toolProfileId: agentBinding.toolProfileId,
      jobId,
      workspaceId: workspace.id,
      workspaceRef: runWorkspaceRef,
    }),
  )

  unwrapCommandResultOrThrow(
    workSessionRepository.assignRootRun(context.tenantScope, {
      rootRunId: runId,
      sessionId,
      updatedAt: now,
    }),
  )

  unwrapCommandResultOrThrow(
    sessionMessageRepository.create(context.tenantScope, {
      authorAccountId: context.tenantScope.accountId,
      content,
      createdAt: now,
      id: messageId,
      metadata: input.sourceMetadata ? { source: input.sourceMetadata } : null,
      runId: runId,
      sequence: 1,
      sessionId,
      threadId,
    }),
  )

  appendWorkspaceLifecycleEvents(context, eventStore, {
    reason: 'session.bootstrap',
    resolution: workspaceResolution,
    rootRunId: runId,
    runId,
    sessionId,
    threadId,
    workspaceRef: runWorkspaceRef,
  })

  const eventInputs = [
    {
      aggregateId: sessionId,
      aggregateType: 'work_session',
      payload: {
        sessionId,
        title: createdSession.title,
        ...(input.sourceMetadata ? { source: input.sourceMetadata } : {}),
      },
      type: 'session.created',
    },
    {
      aggregateId: threadId,
      aggregateType: 'session_thread',
      payload: {
        sessionId,
        threadId,
      },
      type: 'thread.created',
    },
    {
      aggregateId: messageId,
      aggregateType: 'session_message',
      payload: {
        messageId,
        sessionId,
        threadId,
      },
      type: 'message.posted',
    },
  ] as const

  for (const eventInput of eventInputs) {
    unwrapCommandResultOrThrow(
      eventStore.append({
        actorAccountId: context.tenantScope.accountId,
        aggregateId: eventInput.aggregateId,
        aggregateType: eventInput.aggregateType,
        outboxTopics: ['projection', 'realtime'],
        payload: eventInput.payload,
        tenantId: context.tenantScope.tenantId,
        traceId: context.traceId,
        type: eventInput.type,
      }),
    )
  }

  unwrapCommandResultOrThrow(
    appendJobCreatedEvents({
      eventStore,
      scope: context.tenantScope,
      traceId: context.traceId,
      job: createdJob,
    }),
  )

  unwrapCommandResultOrThrow(
    eventStore.append({
      actorAccountId: context.tenantScope.accountId,
      aggregateId: runId,
      aggregateType: 'run',
      payload: {
        agentId: agentBinding.agentId,
        ...(agentBinding.agentName ? { agentName: agentBinding.agentName } : {}),
        agentRevisionId: agentBinding.agentRevisionId,
        rootRunId: runId,
        runId,
        sessionId,
        targetKind: agentBinding.targetKind,
        task: input.task ?? input.initialMessage,
        threadId,
        ...(input.sourceMetadata ? { source: input.sourceMetadata } : {}),
      },
      tenantId: context.tenantScope.tenantId,
      traceId: context.traceId,
      type: 'run.created',
    }),
  )

  if (!threadTitle) {
    appendThreadNamingRequestedEvent(context, eventStore, {
      requestId: context.services.ids.create('tnr'),
      requestedAt: now,
      sessionId,
      sourceRunId: runId,
      threadId,
      trigger: 'auto_first_message',
    })
  }

  return {
    jobId,
    messageId,
    runId,
    sessionId,
    threadId,
  }
}

export const createBootstrapSessionCommand = () => ({
  execute: (
    context: CommandContext,
    input: BootstrapSessionInput,
  ): CommandResult<BootstrapSessionOutput> => {
    try {
      const membershipRepository = createTenantMembershipRepository(context.db)
      const membership = membershipRepository.requireMembership(context.tenantScope)

      if (!membership.ok) {
        return membership
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

      return withTransaction(context.db, (tx) =>
        ok(
          runBootstrapSessionTransaction(tx, context, {
            agentBinding: agentBinding.value,
            initialMessage: input.initialMessage,
            metadata: input.metadata,
            task: input.task,
            threadTitle: input.threadTitle,
            title: input.title,
          }),
        ),
      )
    } catch (error) {
      if (error instanceof DomainErrorException) {
        return err(error.domainError)
      }

      const message = error instanceof Error ? error.message : 'Unknown bootstrap session failure'

      return err({
        message: `failed to bootstrap session: ${message}`,
        type: 'conflict',
      })
    }
  },
})
