import { and, asc, eq } from 'drizzle-orm'

import { jobDependencies } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  asJobDependencyId,
  asJobId,
  asTenantId,
  asWorkSessionId,
  type JobDependencyId,
  type JobId,
  type TenantId,
  type WorkSessionId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'
import type { JobDependencyType } from './job-types'

export interface JobDependencyRecord {
  createdAt: string
  fromJobId: JobId
  id: JobDependencyId
  metadataJson: unknown | null
  sessionId: WorkSessionId
  tenantId: TenantId
  toJobId: JobId
  type: JobDependencyType
}

export interface CreateJobDependencyInput {
  createdAt: string
  fromJobId: JobId
  id: JobDependencyId
  metadataJson?: unknown | null
  sessionId: WorkSessionId
  toJobId: JobId
  type: JobDependencyType
}

const toJobDependencyRecord = (row: typeof jobDependencies.$inferSelect): JobDependencyRecord => ({
  createdAt: row.createdAt,
  fromJobId: asJobId(row.fromJobId),
  id: asJobDependencyId(row.id),
  metadataJson: row.metadataJson,
  sessionId: asWorkSessionId(row.sessionId),
  tenantId: asTenantId(row.tenantId),
  toJobId: asJobId(row.toJobId),
  type: row.type,
})

export const createJobDependencyRepository = (db: RepositoryDatabase) => ({
  create: (
    scope: TenantScope,
    input: CreateJobDependencyInput,
  ): Result<JobDependencyRecord, DomainError> => {
    try {
      const record: JobDependencyRecord = {
        createdAt: input.createdAt,
        fromJobId: input.fromJobId,
        id: input.id,
        metadataJson: input.metadataJson ?? null,
        sessionId: input.sessionId,
        tenantId: scope.tenantId,
        toJobId: input.toJobId,
        type: input.type,
      }

      db.insert(jobDependencies)
        .values({
          ...record,
        })
        .run()

      return ok(record)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown job dependency create failure'

      return err({
        message: `failed to create job dependency ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listByFromJobId: (
    scope: TenantScope,
    jobId: JobId,
  ): Result<JobDependencyRecord[], DomainError> => {
    try {
      const rows = db
        .select()
        .from(jobDependencies)
        .where(
          and(eq(jobDependencies.fromJobId, jobId), eq(jobDependencies.tenantId, scope.tenantId)),
        )
        .orderBy(asc(jobDependencies.createdAt), asc(jobDependencies.id))
        .all()

      return ok(rows.map(toJobDependencyRecord))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown job dependency list failure'

      return err({
        message: `failed to list dependencies from job ${jobId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listByToJobId: (scope: TenantScope, jobId: JobId): Result<JobDependencyRecord[], DomainError> => {
    try {
      const rows = db
        .select()
        .from(jobDependencies)
        .where(
          and(eq(jobDependencies.toJobId, jobId), eq(jobDependencies.tenantId, scope.tenantId)),
        )
        .orderBy(asc(jobDependencies.createdAt), asc(jobDependencies.id))
        .all()

      return ok(rows.map(toJobDependencyRecord))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown reverse job dependency list failure'

      return err({
        message: `failed to list dependencies to job ${jobId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
