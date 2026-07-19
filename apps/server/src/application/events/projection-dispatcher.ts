import { createSessionMessageRepository } from '../../adapters/persistence/sqlite/sessions/session-message-repository'
import type { EventOutboxRecord } from '../../domain/events/event-outbox-repository'
import { createRunRepository } from '../../adapters/persistence/sqlite/runtime/run-repository'
import type { DomainError } from '../../shared/errors'
import { asRunId, asSessionThreadId, asWorkSessionId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { CommandContext } from '../commands/command-context'
import { createInternalCommandContext } from '../commands/internal-command-context'
import {
  ensureProjectedThreadContext,
  listVisibleMessages,
} from '../runtime/projection/run-projection'
import { resolveExecutionScopeForSession } from '../runtime/run-execution-scope'

export type ProjectionDispatchRuntime = Pick<CommandContext, 'config' | 'db' | 'services'>

const readPayloadString = (
  payload: unknown,
  key: 'currentRunId' | 'runId' | 'sessionId' | 'threadId',
): string | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const candidate = (payload as Record<string, unknown>)[key]
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

const dispatchRunContextProjection = (
  runtime: ProjectionDispatchRuntime,
  event: EventOutboxRecord['event'],
): Result<null, DomainError> => {
  if (!event.tenantId) {
    return err({
      message: `projection event ${event.id} is missing a tenant scope`,
      type: 'conflict',
    })
  }

  const sessionId = readPayloadString(event.payload, 'sessionId')
  const runId =
    readPayloadString(event.payload, 'runId') ??
    readPayloadString(event.payload, 'currentRunId') ??
    (event.aggregateType === 'run' ? event.aggregateId : null)

  if (!sessionId || !runId) {
    return err({
      message: `projection event ${event.id} is missing run/session identifiers`,
      type: 'conflict',
    })
  }

  const tenantScope = resolveExecutionScopeForSession(runtime.db, {
    sessionId: asWorkSessionId(sessionId),
    tenantId: event.tenantId,
  })

  if (!tenantScope.ok) {
    return tenantScope
  }

  const context = createInternalCommandContext(runtime, tenantScope.value)
  const run = createRunRepository(runtime.db).getById(context.tenantScope, asRunId(runId))

  if (!run.ok) {
    return run
  }

  const visibleMessages = listVisibleMessages(context, run.value)

  if (!visibleMessages.ok) {
    return visibleMessages
  }

  const projected = ensureProjectedThreadContext(context, run.value, visibleMessages.value)

  if (!projected.ok) {
    return projected
  }

  return ok(null)
}

const dispatchMessagePostedProjection = (
  runtime: ProjectionDispatchRuntime,
  event: EventOutboxRecord['event'],
): Result<null, DomainError> => {
  if (!event.tenantId) {
    return err({
      message: `projection event ${event.id} is missing a tenant scope`,
      type: 'conflict',
    })
  }

  const sessionId = readPayloadString(event.payload, 'sessionId')
  const threadId = readPayloadString(event.payload, 'threadId')

  if (!sessionId || !threadId) {
    return err({
      message: `projection event ${event.id} is missing thread/session identifiers`,
      type: 'conflict',
    })
  }

  const tenantScope = resolveExecutionScopeForSession(runtime.db, {
    sessionId: asWorkSessionId(sessionId),
    tenantId: event.tenantId,
  })

  if (!tenantScope.ok) {
    return tenantScope
  }

  const context = createInternalCommandContext(runtime, tenantScope.value)
  const visibleMessages = createSessionMessageRepository(runtime.db).listByThreadId(
    context.tenantScope,
    asSessionThreadId(threadId),
  )

  if (!visibleMessages.ok) {
    return visibleMessages
  }

  const threadRuns = createRunRepository(runtime.db).listActiveByThreadId(
    context.tenantScope,
    asSessionThreadId(threadId),
  )

  if (!threadRuns.ok) {
    return threadRuns
  }

  for (const run of threadRuns.value) {
    if (run.parentRunId !== null || run.status !== 'pending') {
      continue
    }

    const projected = ensureProjectedThreadContext(context, run, visibleMessages.value)

    if (!projected.ok) {
      return projected
    }
  }

  return ok(null)
}

export const dispatchProjectionEvent = (
  runtime: ProjectionDispatchRuntime,
  entry: EventOutboxRecord,
): Promise<Result<null, DomainError>> | Result<null, DomainError> => {
  switch (entry.event.type) {
    case 'run.created':
    case 'run.requeued':
    case 'job.queued':
    case 'job.requeued':
      return dispatchRunContextProjection(runtime, entry.event)
    case 'message.posted':
      return dispatchMessagePostedProjection(runtime, entry.event)
    default:
      return ok(null)
  }
}
