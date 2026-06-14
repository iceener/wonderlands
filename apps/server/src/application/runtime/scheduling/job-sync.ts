import type { RepositoryDatabase } from '../../../domain/database-port'
import { createJobRepository } from '../../../domain/runtime/job-repository'
import { reopenableJobStatuses } from '../../../domain/runtime/job-types'
import type { RunRecord } from '../../../domain/runtime/run-repository'
import type { DomainError } from '../../../shared/errors'
import type { SessionMessageId, SessionThreadId, TraceId } from '../../../shared/ids'
import { err, ok, type Result } from '../../../shared/result'
import type { TenantScope } from '../../../shared/scope'
import type { createEventStore } from '../../commands/event-store'
import { appendJobStatusChangeEvent } from './job-events'
import {
  buildNewUserMessageJobQueueReason,
  buildRunLinkedJobBlockedReason,
  buildRunLinkedJobQueueReason,
  buildRunLinkedJobRunningReason,
  buildRunLinkedJobTerminalReason,
  buildRunLinkedJobWaitingReason,
  type RunLinkedJobQueueReason,
} from './job-status-reasons'

interface JobEventAppendContext {
  eventStore: ReturnType<typeof createEventStore>
  payload?: Record<string, unknown>
  traceId?: TraceId | string | null
}

const updateRunLinkedJob = (
  db: RepositoryDatabase,
  scope: TenantScope,
  run: Pick<RunRecord, 'id' | 'jobId'>,
  patch: Omit<Parameters<ReturnType<typeof createJobRepository>['update']>[1], 'jobId'>,
  eventContext?: JobEventAppendContext,
): Result<null, DomainError> => {
  if (!run.jobId) {
    return ok(null)
  }

  const jobRepository = createJobRepository(db)
  const current = jobRepository.getById(scope, run.jobId)

  if (!current.ok) {
    return err(current.error)
  }

  const updated = jobRepository.update(scope, {
    ...patch,
    jobId: run.jobId,
  })

  if (!updated.ok) {
    return err(updated.error)
  }

  if (eventContext) {
    const appended = appendJobStatusChangeEvent({
      eventStore: eventContext.eventStore,
      payload: eventContext.payload,
      previousStatus: current.value.status,
      scope,
      traceId: eventContext.traceId,
      job: updated.value,
    })

    if (!appended.ok) {
      return appended
    }
  }

  return ok(null)
}

const mergeJobEventContext = (
  eventContext: JobEventAppendContext | undefined,
  payload: Record<string, unknown>,
): JobEventAppendContext | undefined =>
  eventContext
    ? {
        ...eventContext,
        payload: {
          ...(eventContext.payload ?? {}),
          ...payload,
        },
      }
    : undefined

const buildQueuedJobPatch = (
  run: Pick<RunRecord, 'id'>,
  input: {
    nextSchedulerCheckAt?: string | null
    reason: RunLinkedJobQueueReason
    updatedAt: string
  },
) => ({
  currentRunId: run.id,
  lastHeartbeatAt: input.updatedAt,
  lastSchedulerSyncAt: input.updatedAt,
  nextSchedulerCheckAt: input.nextSchedulerCheckAt ?? null,
  queuedAt: input.updatedAt,
  statusReasonJson: buildRunLinkedJobQueueReason({
    reason: input.reason,
    runId: run.id,
  }),
  status: 'queued' as const,
  updatedAt: input.updatedAt,
})

const buildWaitingJobPatch = (
  run: Pick<RunRecord, 'id'>,
  input: {
    nextSchedulerCheckAt?: string | null
    updatedAt: string
    waitIds: string[]
  },
) => ({
  currentRunId: run.id,
  lastHeartbeatAt: input.updatedAt,
  lastSchedulerSyncAt: input.updatedAt,
  nextSchedulerCheckAt: input.nextSchedulerCheckAt ?? null,
  queuedAt: null,
  statusReasonJson: buildRunLinkedJobWaitingReason({
    runId: run.id,
    waitIds: input.waitIds,
  }),
  status: 'waiting' as const,
  updatedAt: input.updatedAt,
})

export const queueLinkedJob = (
  db: RepositoryDatabase,
  scope: TenantScope,
  run: Pick<RunRecord, 'id' | 'jobId'>,
  input: {
    eventContext?: JobEventAppendContext
    nextSchedulerCheckAt?: string | null
    reason: RunLinkedJobQueueReason
    updatedAt: string
  },
): Result<null, DomainError> =>
  updateRunLinkedJob(
    db,
    scope,
    run,
    buildQueuedJobPatch(run, input),
    mergeJobEventContext(input.eventContext, {
      ...(input.nextSchedulerCheckAt ? { nextSchedulerCheckAt: input.nextSchedulerCheckAt } : {}),
      reason: input.reason,
      updatedAt: input.updatedAt,
    }),
  )

export const markLinkedJobRunning = (
  db: RepositoryDatabase,
  scope: TenantScope,
  run: Pick<RunRecord, 'id' | 'jobId'>,
  updatedAt: string,
): Result<null, DomainError> =>
  updateRunLinkedJob(db, scope, run, {
    currentRunId: run.id,
    lastHeartbeatAt: updatedAt,
    lastSchedulerSyncAt: updatedAt,
    nextSchedulerCheckAt: null,
    queuedAt: null,
    statusReasonJson: buildRunLinkedJobRunningReason({
      runId: run.id,
    }),
    status: 'running',
    updatedAt,
  })

export const markLinkedJobWaiting = (
  db: RepositoryDatabase,
  scope: TenantScope,
  run: Pick<RunRecord, 'id' | 'jobId'>,
  input: {
    eventContext?: JobEventAppendContext
    nextSchedulerCheckAt?: string | null
    updatedAt: string
    waitIds: string[]
  },
): Result<null, DomainError> =>
  updateRunLinkedJob(
    db,
    scope,
    run,
    buildWaitingJobPatch(run, input),
    mergeJobEventContext(input.eventContext, {
      ...(input.nextSchedulerCheckAt ? { nextSchedulerCheckAt: input.nextSchedulerCheckAt } : {}),
      reason: 'pending_waits',
      updatedAt: input.updatedAt,
      waitIds: input.waitIds,
    }),
  )

export const markRunJobBlocked = (
  db: RepositoryDatabase,
  scope: TenantScope,
  run: Pick<RunRecord, 'id' | 'jobId'>,
  input: {
    error: unknown
    eventContext?: JobEventAppendContext
    updatedAt: string
  },
): Result<null, DomainError> =>
  updateRunLinkedJob(
    db,
    scope,
    run,
    {
      currentRunId: run.id,
      lastHeartbeatAt: input.updatedAt,
      nextSchedulerCheckAt: null,
      queuedAt: null,
      statusReasonJson: buildRunLinkedJobBlockedReason({
        error: input.error,
        runId: run.id,
      }),
      status: 'blocked',
      updatedAt: input.updatedAt,
    },
    mergeJobEventContext(input.eventContext, {
      error: input.error,
      updatedAt: input.updatedAt,
    }),
  )

export const markRunJobCompleted = (
  db: RepositoryDatabase,
  scope: TenantScope,
  run: Pick<RunRecord, 'id' | 'jobId'>,
  input: {
    completedAt: string
    eventContext?: JobEventAppendContext
    resultJson: unknown
  },
): Result<null, DomainError> =>
  updateRunLinkedJob(
    db,
    scope,
    run,
    {
      completedAt: input.completedAt,
      currentRunId: run.id,
      lastHeartbeatAt: input.completedAt,
      nextSchedulerCheckAt: null,
      queuedAt: null,
      resultJson: input.resultJson,
      statusReasonJson: buildRunLinkedJobTerminalReason({
        runId: run.id,
        status: 'completed',
      }),
      status: 'completed',
      updatedAt: input.completedAt,
    },
    mergeJobEventContext(input.eventContext, {
      completedAt: input.completedAt,
    }),
  )

export const markRunJobCancelled = (
  db: RepositoryDatabase,
  scope: TenantScope,
  run: Pick<RunRecord, 'id' | 'jobId'>,
  input: {
    completedAt: string
    eventContext?: JobEventAppendContext
    resultJson: unknown
  },
): Result<null, DomainError> =>
  updateRunLinkedJob(
    db,
    scope,
    run,
    {
      completedAt: input.completedAt,
      currentRunId: run.id,
      lastHeartbeatAt: input.completedAt,
      nextSchedulerCheckAt: null,
      queuedAt: null,
      resultJson: input.resultJson,
      statusReasonJson: buildRunLinkedJobTerminalReason({
        runId: run.id,
        status: 'cancelled',
      }),
      status: 'cancelled',
      updatedAt: input.completedAt,
    },
    mergeJobEventContext(input.eventContext, {
      completedAt: input.completedAt,
    }),
  )

export const recordLinkedJobHeartbeat = (
  db: RepositoryDatabase,
  scope: TenantScope,
  run: Pick<RunRecord, 'id' | 'jobId'>,
  input: {
    heartbeatAt: string
    nextSchedulerCheckAt: string | null
  },
): Result<null, DomainError> =>
  updateRunLinkedJob(db, scope, run, {
    currentRunId: run.id,
    lastHeartbeatAt: input.heartbeatAt,
    nextSchedulerCheckAt: input.nextSchedulerCheckAt,
    updatedAt: input.heartbeatAt,
  })

export const reopenThreadRootJobForNewMessage = (
  db: RepositoryDatabase,
  scope: TenantScope,
  input: {
    eventContext: JobEventAppendContext
    messageId: SessionMessageId
    threadId: SessionThreadId
    updatedAt: string
  },
): Result<null, DomainError> => {
  const jobRepository = createJobRepository(db)
  const threadJobs = jobRepository.listByThreadId(scope, input.threadId)

  if (!threadJobs.ok) {
    return threadJobs
  }

  const latestRootJob = threadJobs.value.filter((job) => job.parentJobId === null).at(-1) ?? null

  if (!latestRootJob) {
    return ok(null)
  }

  if (!reopenableJobStatuses.has(latestRootJob.status)) {
    return ok(null)
  }

  const updated = jobRepository.update(scope, {
    completedAt: null,
    lastSchedulerSyncAt: input.updatedAt,
    nextSchedulerCheckAt: null,
    queuedAt: input.updatedAt,
    resultJson: null,
    statusReasonJson: buildNewUserMessageJobQueueReason({
      messageId: input.messageId,
      previousStatus: latestRootJob.status,
      threadId: input.threadId,
    }),
    status: 'queued',
    updatedAt: input.updatedAt,
    jobId: latestRootJob.id,
  })

  if (!updated.ok) {
    return updated
  }

  return appendJobStatusChangeEvent({
    eventStore: input.eventContext.eventStore,
    payload: {
      messageId: input.messageId,
      previousStatus: latestRootJob.status,
      reason: 'new_user_message',
      updatedAt: input.updatedAt,
    },
    previousStatus: latestRootJob.status,
    scope,
    traceId: input.eventContext.traceId,
    typeOverride: 'job.requeued',
    job: updated.value,
  })
}
