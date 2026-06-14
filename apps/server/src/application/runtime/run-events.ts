import type { DomainCommittedEventType } from '../../domain/events/committed-event-contract'
import type { RunRecord } from '../../domain/runtime/run-repository'
import { type DomainError, DomainErrorException } from '../../shared/errors'
import type { Result } from '../../shared/result'
import type { CommandContext } from '../commands/command-context'
import type { createEventStore } from '../commands/event-store'

type EventScopedRun = Pick<RunRecord, 'id' | 'sessionId' | 'status' | 'threadId'> & {
  configSnapshot?: Record<string, unknown> | null
  parentRunId?: RunRecord['parentRunId']
  rootRunId?: RunRecord['rootRunId']
}

const readRunEventThreadId = (configSnapshot: Record<string, unknown> | null | undefined) => {
  const candidate = configSnapshot?.eventThreadId
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

export const unwrapOrThrow = <TValue>(result: Result<TValue, DomainError>): TValue => {
  if (!result.ok) {
    throw new DomainErrorException(result.error)
  }

  return result.value
}

export const resolveRunEventThreadId = (
  run: Pick<RunRecord, 'threadId'> & { configSnapshot?: Record<string, unknown> | null },
): string | null => run.threadId ?? readRunEventThreadId(run.configSnapshot)

export const createRunEventPayload = (
  run: EventScopedRun,
  payload: Record<string, unknown>,
): Record<string, unknown> => ({
  ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
  ...(run.rootRunId ? { rootRunId: run.rootRunId } : {}),
  runId: run.id,
  sessionId: run.sessionId,
  status: run.status,
  threadId: resolveRunEventThreadId(run),
  ...payload,
})

export const appendDomainEvent = (
  context: CommandContext,
  eventStore: ReturnType<typeof createEventStore>,
  input: {
    aggregateId: string
    aggregateType: string
    payload: Record<string, unknown>
    type: DomainCommittedEventType
  },
) => {
  unwrapOrThrow(
    eventStore.append({
      actorAccountId: context.tenantScope.accountId,
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      payload: input.payload,
      tenantId: context.tenantScope.tenantId,
      traceId: context.traceId,
      type: input.type,
    }),
  )
}

export const appendRunEvent = (
  context: CommandContext,
  eventStore: ReturnType<typeof createEventStore>,
  run: EventScopedRun,
  type: DomainCommittedEventType,
  payload: Record<string, unknown>,
) => {
  appendDomainEvent(context, eventStore, {
    aggregateId: run.id,
    aggregateType: 'run',
    payload: createRunEventPayload(run, payload),
    type,
  })
}
