import type { DomainCommittedEventType } from '../../../domain/events/committed-event-contract'
import type { JobRecord } from '../../../domain/runtime/job-repository'
import type { JobStatus } from '../../../domain/runtime/job-types'
import type { DomainError } from '../../../shared/errors'
import type { TraceId } from '../../../shared/ids'
import { ok, type Result } from '../../../shared/result'
import type { TenantScope } from '../../../shared/scope'
import type { createEventStore } from '../../commands/event-store'

type JobCommittedEventType = Extract<DomainCommittedEventType, `job.${string}`>

interface JobEventContext {
  eventStore: ReturnType<typeof createEventStore>
  scope: TenantScope
  traceId?: TraceId | string | null
}

const toBasePayload = (job: JobRecord) => ({
  currentRunId: job.currentRunId,
  kind: job.kind,
  parentJobId: job.parentJobId,
  rootJobId: job.rootJobId,
  runId: job.currentRunId,
  sessionId: job.sessionId,
  status: job.status,
  threadId: job.threadId,
  jobId: job.id,
})

const appendJobEvent = (
  input: JobEventContext & {
    payload: Record<string, unknown>
    type: JobCommittedEventType
    job: JobRecord
  },
): Result<null, DomainError> => {
  const appended = input.eventStore.append({
    actorAccountId: input.scope.accountId,
    aggregateId: input.job.id,
    aggregateType: 'job',
    payload: {
      ...toBasePayload(input.job),
      ...input.payload,
    },
    tenantId: input.scope.tenantId,
    traceId: input.traceId ?? undefined,
    type: input.type,
  })

  if (!appended.ok) {
    return appended
  }

  return ok(null)
}

const toStatusEventType = (
  previousStatus: JobStatus | null,
  nextStatus: JobStatus,
): JobCommittedEventType | null => {
  switch (nextStatus) {
    case 'queued':
      return previousStatus === 'waiting' ? 'job.requeued' : 'job.queued'
    case 'running':
      return null
    case 'waiting':
      return 'job.waiting'
    case 'blocked':
      return 'job.blocked'
    case 'completed':
      return 'job.completed'
    case 'cancelled':
      return 'job.cancelled'
    case 'superseded':
      return 'job.superseded'
  }
}

export const appendJobCreatedEvents = (
  input: JobEventContext & {
    job: JobRecord
  },
): Result<null, DomainError> => {
  const created = appendJobEvent({
    ...input,
    payload: {
      assignedAgentId: input.job.assignedAgentId,
      assignedAgentRevisionId: input.job.assignedAgentRevisionId,
      createdAt: input.job.createdAt,
      title: input.job.title,
    },
    type: 'job.created',
  })

  if (!created.ok) {
    return created
  }

  return appendJobStatusChangeEvent({
    ...input,
    payload: {
      createdAt: input.job.createdAt,
      title: input.job.title,
    },
    previousStatus: null,
  })
}

export const appendJobStatusChangeEvent = (
  input: JobEventContext & {
    payload?: Record<string, unknown>
    previousStatus: JobStatus | null
    typeOverride?: JobCommittedEventType
    job: JobRecord
  },
): Result<null, DomainError> => {
  if (input.previousStatus === input.job.status) {
    return ok(null)
  }

  const type = input.typeOverride ?? toStatusEventType(input.previousStatus, input.job.status)

  if (!type) {
    return ok(null)
  }

  const timestampPayload =
    input.job.status === 'completed' || input.job.status === 'cancelled'
      ? { completedAt: input.job.completedAt }
      : { updatedAt: input.job.updatedAt }

  return appendJobEvent({
    ...input,
    payload: {
      ...timestampPayload,
      ...(input.payload ?? {}),
    },
    type,
  })
}
