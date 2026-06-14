import { and, asc, eq } from 'drizzle-orm'

import { jobs } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  type AgentId,
  type AgentRevisionId,
  asAgentId,
  asAgentRevisionId,
  asJobId,
  asRunId,
  asSessionThreadId,
  asTenantId,
  asWorkSessionId,
  type JobId,
  type RunId,
  type SessionThreadId,
  type TenantId,
  type WorkSessionId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'
import type { JobKind, JobStatus } from './job-types'

export interface JobRecord {
  assignedAgentId: AgentId | null
  assignedAgentRevisionId: AgentRevisionId | null
  completedAt: string | null
  createdAt: string
  currentRunId: RunId | null
  id: JobId
  inputJson: unknown | null
  kind: JobKind
  lastHeartbeatAt: string | null
  lastSchedulerSyncAt: string | null
  nextSchedulerCheckAt: string | null
  parentJobId: JobId | null
  priority: number
  queuedAt: string | null
  resultJson: unknown | null
  rootJobId: JobId
  sessionId: WorkSessionId
  statusReasonJson: unknown | null
  status: JobStatus
  tenantId: TenantId
  threadId: SessionThreadId | null
  title: string
  updatedAt: string
  version: number
}

export interface CreateJobInput {
  assignedAgentId?: AgentId | null
  assignedAgentRevisionId?: AgentRevisionId | null
  completedAt?: string | null
  createdAt: string
  currentRunId?: RunId | null
  id: JobId
  inputJson?: unknown | null
  kind: JobKind
  lastHeartbeatAt?: string | null
  lastSchedulerSyncAt?: string | null
  nextSchedulerCheckAt?: string | null
  parentJobId?: JobId | null
  priority?: number
  queuedAt?: string | null
  resultJson?: unknown | null
  rootJobId: JobId
  sessionId: WorkSessionId
  statusReasonJson?: unknown | null
  status: JobStatus
  threadId: SessionThreadId | null
  title: string
  updatedAt: string
}

export interface UpdateJobInput {
  assignedAgentId?: AgentId | null
  assignedAgentRevisionId?: AgentRevisionId | null
  completedAt?: string | null
  currentRunId?: RunId | null
  inputJson?: unknown | null
  lastHeartbeatAt?: string | null
  lastSchedulerSyncAt?: string | null
  nextSchedulerCheckAt?: string | null
  queuedAt?: string | null
  resultJson?: unknown | null
  statusReasonJson?: unknown | null
  status?: JobStatus
  title?: string
  updatedAt: string
  jobId: JobId
}

const toJobRecord = (row: typeof jobs.$inferSelect): JobRecord => ({
  assignedAgentId: row.assignedAgentId ? asAgentId(row.assignedAgentId) : null,
  assignedAgentRevisionId: row.assignedAgentRevisionId
    ? asAgentRevisionId(row.assignedAgentRevisionId)
    : null,
  completedAt: row.completedAt,
  createdAt: row.createdAt,
  currentRunId: row.currentRunId ? asRunId(row.currentRunId) : null,
  id: asJobId(row.id),
  inputJson: row.inputJson,
  kind: row.kind,
  lastHeartbeatAt: row.lastHeartbeatAt,
  lastSchedulerSyncAt: row.lastSchedulerSyncAt,
  nextSchedulerCheckAt: row.nextSchedulerCheckAt,
  parentJobId: row.parentJobId ? asJobId(row.parentJobId) : null,
  priority: row.priority,
  queuedAt: row.queuedAt,
  resultJson: row.resultJson,
  rootJobId: asJobId(row.rootJobId),
  sessionId: asWorkSessionId(row.sessionId),
  statusReasonJson: row.statusReasonJson,
  status: row.status,
  tenantId: asTenantId(row.tenantId),
  threadId: row.threadId ? asSessionThreadId(row.threadId) : null,
  title: row.title,
  updatedAt: row.updatedAt,
  version: row.version,
})

const buildUpdatePatch = (input: UpdateJobInput): Partial<typeof jobs.$inferInsert> => {
  const patch: Partial<typeof jobs.$inferInsert> = {
    updatedAt: input.updatedAt,
  }

  if (input.assignedAgentId !== undefined) {
    patch.assignedAgentId = input.assignedAgentId
  }
  if (input.assignedAgentRevisionId !== undefined) {
    patch.assignedAgentRevisionId = input.assignedAgentRevisionId
  }
  if (input.completedAt !== undefined) {
    patch.completedAt = input.completedAt
  }
  if (input.currentRunId !== undefined) {
    patch.currentRunId = input.currentRunId
  }
  if (input.inputJson !== undefined) {
    patch.inputJson = input.inputJson
  }
  if (input.lastHeartbeatAt !== undefined) {
    patch.lastHeartbeatAt = input.lastHeartbeatAt
  }
  if (input.lastSchedulerSyncAt !== undefined) {
    patch.lastSchedulerSyncAt = input.lastSchedulerSyncAt
  }
  if (input.nextSchedulerCheckAt !== undefined) {
    patch.nextSchedulerCheckAt = input.nextSchedulerCheckAt
  }
  if (input.queuedAt !== undefined) {
    patch.queuedAt = input.queuedAt
  }
  if (input.resultJson !== undefined) {
    patch.resultJson = input.resultJson
  }
  if (input.statusReasonJson !== undefined) {
    patch.statusReasonJson = input.statusReasonJson
  }
  if (input.status !== undefined) {
    patch.status = input.status
  }
  if (input.title !== undefined) {
    patch.title = input.title
  }

  return patch
}

export const createJobRepository = (db: RepositoryDatabase) => {
  const getById = (scope: TenantScope, jobId: JobId): Result<JobRecord, DomainError> => {
    const row = db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.tenantId, scope.tenantId)))
      .get()

    if (!row) {
      return err({
        message: `job ${jobId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toJobRecord(row))
  }

  return {
    create: (scope: TenantScope, input: CreateJobInput): Result<JobRecord, DomainError> => {
      try {
        const record: JobRecord = {
          assignedAgentId: input.assignedAgentId ?? null,
          assignedAgentRevisionId: input.assignedAgentRevisionId ?? null,
          completedAt: input.completedAt ?? null,
          createdAt: input.createdAt,
          currentRunId: input.currentRunId ?? null,
          id: input.id,
          inputJson: input.inputJson ?? null,
          kind: input.kind,
          lastHeartbeatAt: input.lastHeartbeatAt ?? null,
          lastSchedulerSyncAt: input.lastSchedulerSyncAt ?? null,
          nextSchedulerCheckAt: input.nextSchedulerCheckAt ?? null,
          parentJobId: input.parentJobId ?? null,
          priority: input.priority ?? 100,
          queuedAt: input.queuedAt ?? null,
          resultJson: input.resultJson ?? null,
          rootJobId: input.rootJobId,
          sessionId: input.sessionId,
          statusReasonJson: input.statusReasonJson ?? null,
          status: input.status,
          tenantId: scope.tenantId,
          threadId: input.threadId,
          title: input.title,
          updatedAt: input.updatedAt,
          version: 1,
        }

        db.insert(jobs)
          .values({
            ...record,
          })
          .run()

        return ok(record)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown job create failure'

        return err({
          message: `failed to create job ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getById,
    listBySessionId: (
      scope: TenantScope,
      sessionId: WorkSessionId,
    ): Result<JobRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(jobs)
          .where(and(eq(jobs.sessionId, sessionId), eq(jobs.tenantId, scope.tenantId)))
          .orderBy(asc(jobs.createdAt), asc(jobs.id))
          .all()

        return ok(rows.map(toJobRecord))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown job list failure'

        return err({
          message: `failed to list jobs for session ${sessionId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    listByThreadId: (
      scope: TenantScope,
      threadId: SessionThreadId,
    ): Result<JobRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(jobs)
          .where(and(eq(jobs.threadId, threadId), eq(jobs.tenantId, scope.tenantId)))
          .orderBy(asc(jobs.createdAt), asc(jobs.id))
          .all()

        return ok(rows.map(toJobRecord))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown thread job list failure'

        return err({
          message: `failed to list jobs for thread ${threadId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    update: (scope: TenantScope, input: UpdateJobInput): Result<JobRecord, DomainError> => {
      const current = getById(scope, input.jobId)

      if (!current.ok) {
        return current
      }

      try {
        db.update(jobs)
          .set({
            ...buildUpdatePatch(input),
            version: current.value.version + 1,
          })
          .where(and(eq(jobs.id, input.jobId), eq(jobs.tenantId, scope.tenantId)))
          .run()

        return getById(scope, input.jobId)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown job update failure'

        return err({
          message: `failed to update job ${input.jobId}: ${message}`,
          type: 'conflict',
        })
      }
    },
  }
}
