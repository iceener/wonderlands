import { withTransaction } from '../../db/transaction'
import { createRunRepository } from '../../domain/runtime/run-repository'
import { createSessionMessageRepository } from '../../domain/sessions/session-message-repository'
import { createSessionThreadRepository } from '../../domain/sessions/session-thread-repository'
import type { DomainError } from '../../shared/errors'
import { asRunId, asSessionThreadId } from '../../shared/ids'
import { ok, type Result } from '../../shared/result'
import type { CommandContext } from '../commands/command-context'
import { createEventStore } from '../commands/event-store'
import {
  appendThreadNamingCompletedEvent,
  appendThreadNamingFailedEvent,
  appendThreadNamingStartedEvent,
  appendThreadUpdatedEvent,
  type ThreadNamingRequestedPayload,
} from './thread-title-events'
import { generateThreadTitle } from './thread-title-generator'
import { sampleThreadTitleSourceText } from './thread-title-sampler'

const toFailureError = (error: DomainError): { message: string; type: string } => ({
  message: error.message,
  type: error.type,
})

const shouldSkipAutoFirstMessageRename = (
  currentTitle: string | null,
  titleSource: 'manual' | 'auto_first_message' | 'manual_regenerate' | null,
): boolean =>
  titleSource === 'manual' || (currentTitle !== null && titleSource !== 'auto_first_message')

const shouldSkipManualRegenerateRename = (input: {
  requestedAt: string
  threadUpdatedAt: string
  titleSource: 'manual' | 'auto_first_message' | 'manual_regenerate' | null
}): boolean =>
  input.titleSource === 'manual' &&
  Date.parse(input.threadUpdatedAt) > Date.parse(input.requestedAt)

export const processThreadNamingRequest = async (
  context: CommandContext,
  input: {
    causationId?: string
    request: ThreadNamingRequestedPayload
  },
): Promise<Result<null, DomainError>> => {
  const eventStore = createEventStore(context.db)

  appendThreadNamingStartedEvent(context, eventStore, {
    ...input.request,
    causationId: input.causationId,
  })

  const threadRepository = createSessionThreadRepository(context.db)
  const thread = threadRepository.getById(
    context.tenantScope,
    asSessionThreadId(input.request.threadId),
  )

  if (!thread.ok) {
    appendThreadNamingFailedEvent(context, eventStore, {
      ...input.request,
      causationId: input.causationId,
      error: toFailureError(thread.error),
    })
    return ok(null)
  }

  const runRepository = createRunRepository(context.db)
  const sourceRun = runRepository.getById(context.tenantScope, asRunId(input.request.sourceRunId))

  if (!sourceRun.ok) {
    appendThreadNamingFailedEvent(context, eventStore, {
      ...input.request,
      causationId: input.causationId,
      error: toFailureError(sourceRun.error),
    })
    return ok(null)
  }

  if (sourceRun.value.threadId !== thread.value.id) {
    appendThreadNamingFailedEvent(context, eventStore, {
      ...input.request,
      causationId: input.causationId,
      error: {
        message: `run ${sourceRun.value.id} does not belong to thread ${thread.value.id}`,
        type: 'conflict',
      },
    })
    return ok(null)
  }

  const messages = createSessionMessageRepository(context.db).listByThreadId(
    context.tenantScope,
    thread.value.id,
  )

  if (!messages.ok) {
    appendThreadNamingFailedEvent(context, eventStore, {
      ...input.request,
      causationId: input.causationId,
      error: toFailureError(messages.error),
    })
    return ok(null)
  }

  const sampledSourceText = sampleThreadTitleSourceText(messages.value, input.request.trigger)

  if (!sampledSourceText.ok) {
    appendThreadNamingFailedEvent(context, eventStore, {
      ...input.request,
      causationId: input.causationId,
      error: toFailureError(sampledSourceText.error),
    })
    return ok(null)
  }

  const generatedTitle = await generateThreadTitle(
    context,
    sourceRun.value,
    sampledSourceText.value,
  )

  if (!generatedTitle.ok) {
    appendThreadNamingFailedEvent(context, eventStore, {
      ...input.request,
      causationId: input.causationId,
      error: toFailureError(generatedTitle.error),
    })
    return ok(null)
  }

  const currentThread = threadRepository.getById(context.tenantScope, thread.value.id)

  if (!currentThread.ok) {
    appendThreadNamingFailedEvent(context, eventStore, {
      ...input.request,
      causationId: input.causationId,
      error: toFailureError(currentThread.error),
    })
    return ok(null)
  }

  const shouldSkip =
    input.request.trigger === 'auto_first_message'
      ? shouldSkipAutoFirstMessageRename(currentThread.value.title, currentThread.value.titleSource)
      : shouldSkipManualRegenerateRename({
          requestedAt: input.request.requestedAt,
          threadUpdatedAt: currentThread.value.updatedAt,
          titleSource: currentThread.value.titleSource,
        })

  if (shouldSkip) {
    appendThreadNamingCompletedEvent(context, eventStore, {
      ...input.request,
      applied: false,
      causationId: input.causationId,
      title: currentThread.value.title,
      titleSource: currentThread.value.titleSource,
    })
    return ok(null)
  }

  return withTransaction(context.db, (tx) => {
    const txEventStore = createEventStore(tx)
    const txThreadRepository = createSessionThreadRepository(tx)
    const now = context.services.clock.nowIso()
    const didChange =
      currentThread.value.title !== generatedTitle.value ||
      currentThread.value.titleSource !== input.request.trigger

    const updatedThread = didChange
      ? txThreadRepository.update(context.tenantScope, currentThread.value.id, {
          title: generatedTitle.value,
          titleSource: input.request.trigger,
          updatedAt: now,
        })
      : currentThread

    if (!updatedThread.ok) {
      return updatedThread
    }

    if (didChange) {
      appendThreadUpdatedEvent(context, txEventStore, {
        causationId: input.causationId,
        sessionId: updatedThread.value.sessionId,
        threadId: updatedThread.value.id,
        title: updatedThread.value.title,
        titleSource: updatedThread.value.titleSource,
        updatedAt: updatedThread.value.updatedAt,
      })
    }

    appendThreadNamingCompletedEvent(context, txEventStore, {
      ...input.request,
      applied: didChange,
      causationId: input.causationId,
      title: updatedThread.value.title,
      titleSource: updatedThread.value.titleSource,
    })

    return ok(null)
  })
}
