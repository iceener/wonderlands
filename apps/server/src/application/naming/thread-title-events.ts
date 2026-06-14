import { z } from 'zod'
import type { RunRecord } from '../../domain/runtime/run-repository'
import type { SessionThreadRecord } from '../../domain/sessions/session-thread-repository'
import { DomainErrorException } from '../../shared/errors'
import type { CommandContext } from '../commands/command-context'
import type { createEventStore } from '../commands/event-store'

const idSchema = z.string().trim().min(1).max(200)

export const threadNamingTriggerSchema = z.enum(['auto_first_message', 'manual_regenerate'])
export type ThreadNamingTrigger = z.infer<typeof threadNamingTriggerSchema>

export const threadTitleSourceSchema = z
  .enum(['manual', 'auto_first_message', 'manual_regenerate'])
  .nullable()
export type ThreadTitleSource = z.infer<typeof threadTitleSourceSchema>

export const threadNamingRequestedPayloadSchema = z.object({
  requestId: idSchema,
  requestedAt: z.string().trim().min(1).max(200),
  sessionId: idSchema,
  sourceRunId: idSchema,
  threadId: idSchema,
  trigger: threadNamingTriggerSchema,
})

export type ThreadNamingRequestedPayload = z.infer<typeof threadNamingRequestedPayloadSchema>

const appendOrThrow = <TPayload extends Record<string, unknown>>(
  context: CommandContext,
  eventStore: ReturnType<typeof createEventStore>,
  input: {
    causationId?: string
    outboxTopics: Array<'background' | 'projection' | 'realtime'>
    payload: TPayload
    type:
      | 'thread.naming.completed'
      | 'thread.naming.failed'
      | 'thread.naming.requested'
      | 'thread.naming.started'
      | 'thread.updated'
  },
) => {
  const appended = eventStore.append({
    actorAccountId: context.tenantScope.accountId,
    aggregateId: String(input.payload.threadId),
    aggregateType: 'session_thread',
    causationId: input.causationId,
    outboxTopics: input.outboxTopics,
    payload: input.payload,
    tenantId: context.tenantScope.tenantId,
    traceId: context.traceId,
    type: input.type,
  })

  if (!appended.ok) {
    throw new DomainErrorException(appended.error)
  }
}

export const appendThreadNamingRequestedEvent = (
  context: CommandContext,
  eventStore: ReturnType<typeof createEventStore>,
  input: {
    requestId: string
    requestedAt: string
    sessionId: SessionThreadRecord['sessionId']
    sourceRunId: RunRecord['id']
    threadId: SessionThreadRecord['id']
    trigger: ThreadNamingTrigger
  },
) =>
  appendOrThrow(context, eventStore, {
    outboxTopics: ['background', 'realtime'],
    payload: {
      requestId: input.requestId,
      requestedAt: input.requestedAt,
      sessionId: input.sessionId,
      sourceRunId: input.sourceRunId,
      threadId: input.threadId,
      trigger: input.trigger,
    },
    type: 'thread.naming.requested',
  })

export const appendThreadNamingStartedEvent = (
  context: CommandContext,
  eventStore: ReturnType<typeof createEventStore>,
  input: ThreadNamingRequestedPayload & { causationId?: string },
) =>
  appendOrThrow(context, eventStore, {
    causationId: input.causationId,
    outboxTopics: ['realtime'],
    payload: {
      requestId: input.requestId,
      sessionId: input.sessionId,
      sourceRunId: input.sourceRunId,
      threadId: input.threadId,
      trigger: input.trigger,
    },
    type: 'thread.naming.started',
  })

export const appendThreadNamingCompletedEvent = (
  context: CommandContext,
  eventStore: ReturnType<typeof createEventStore>,
  input: ThreadNamingRequestedPayload & {
    applied: boolean
    causationId?: string
    title: string | null
    titleSource: ThreadTitleSource
  },
) =>
  appendOrThrow(context, eventStore, {
    causationId: input.causationId,
    outboxTopics: ['realtime'],
    payload: {
      applied: input.applied,
      requestId: input.requestId,
      sessionId: input.sessionId,
      sourceRunId: input.sourceRunId,
      threadId: input.threadId,
      title: input.title,
      titleSource: input.titleSource,
      trigger: input.trigger,
    },
    type: 'thread.naming.completed',
  })

export const appendThreadNamingFailedEvent = (
  context: CommandContext,
  eventStore: ReturnType<typeof createEventStore>,
  input: ThreadNamingRequestedPayload & {
    causationId?: string
    error: {
      message: string
      type: string
    }
  },
) =>
  appendOrThrow(context, eventStore, {
    causationId: input.causationId,
    outboxTopics: ['realtime'],
    payload: {
      error: input.error,
      requestId: input.requestId,
      sessionId: input.sessionId,
      sourceRunId: input.sourceRunId,
      threadId: input.threadId,
      trigger: input.trigger,
    },
    type: 'thread.naming.failed',
  })

export const appendThreadUpdatedEvent = (
  context: CommandContext,
  eventStore: ReturnType<typeof createEventStore>,
  input: {
    causationId?: string
    sessionId: SessionThreadRecord['sessionId']
    threadId: SessionThreadRecord['id']
    title: string | null
    titleSource: ThreadTitleSource
    updatedAt: string
  },
) =>
  appendOrThrow(context, eventStore, {
    causationId: input.causationId,
    outboxTopics: ['realtime'],
    payload: {
      sessionId: input.sessionId,
      threadId: input.threadId,
      title: input.title,
      titleSource: input.titleSource,
      updatedAt: input.updatedAt,
    },
    type: 'thread.updated',
  })
