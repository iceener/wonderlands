import type { DomainEventEnvelope } from './domain-event'

export interface DomainEventStreamScope {
  runId?: string | null
  sessionId?: string | null
  threadId?: string | null
}

const readPayloadString = (
  payload: unknown,
  key: 'runId' | 'sessionId' | 'threadId',
): string | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const candidate = (payload as Record<string, unknown>)[key]
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

const matchesSession = (
  event: Pick<DomainEventEnvelope<unknown>, 'aggregateId' | 'aggregateType' | 'payload'>,
  sessionId: string | null | undefined,
): boolean => {
  if (!sessionId) {
    return true
  }

  return (
    (event.aggregateType === 'work_session' && event.aggregateId === sessionId) ||
    readPayloadString(event.payload, 'sessionId') === sessionId
  )
}

const matchesThread = (
  event: Pick<DomainEventEnvelope<unknown>, 'aggregateId' | 'aggregateType' | 'payload'>,
  threadId: string | null | undefined,
): boolean => {
  if (!threadId) {
    return true
  }

  return (
    (event.aggregateType === 'session_thread' && event.aggregateId === threadId) ||
    readPayloadString(event.payload, 'threadId') === threadId
  )
}

const matchesRun = (
  event: Pick<DomainEventEnvelope<unknown>, 'aggregateId' | 'aggregateType' | 'payload'>,
  runId: string | null | undefined,
): boolean => {
  if (!runId) {
    return true
  }

  return (
    (event.aggregateType === 'run' && event.aggregateId === runId) ||
    readPayloadString(event.payload, 'runId') === runId
  )
}

export const matchesDomainEventStreamScope = (
  event: Pick<DomainEventEnvelope<unknown>, 'aggregateId' | 'aggregateType' | 'payload'>,
  scope: DomainEventStreamScope,
): boolean =>
  matchesSession(event, scope.sessionId) &&
  matchesThread(event, scope.threadId) &&
  matchesRun(event, scope.runId)
