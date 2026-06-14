import { and, asc, eq, inArray } from 'drizzle-orm'

import { runDependencies } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import { asRunId, asTenantId, type RunId, type TenantId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'
import type { WaitTargetKind, WaitType } from '../tooling/tool-registry'

export type RunDependencyStatus = 'pending' | 'resolved' | 'cancelled' | 'timed_out'

export interface RunDependencyRecord {
  callId: string
  createdAt: string
  description: string | null
  id: string
  resolutionJson: unknown | null
  resolvedAt: string | null
  runId: RunId
  status: RunDependencyStatus
  targetKind: WaitTargetKind
  targetRef: string | null
  targetRunId: RunId | null
  tenantId: TenantId
  timeoutAt: string | null
  type: WaitType
}

export interface CreateRunDependencyInput {
  callId: string
  createdAt: string
  description?: string | null
  id: string
  runId: RunId
  targetKind: WaitTargetKind
  targetRef?: string | null
  targetRunId?: RunId | null
  timeoutAt?: string | null
  type: WaitType
}

export interface ResolveRunDependencyInput {
  id: string
  resolutionJson: unknown
  resolvedAt: string
  status: Extract<RunDependencyStatus, 'resolved' | 'cancelled' | 'timed_out'>
}

const toRunDependencyRecord = (row: typeof runDependencies.$inferSelect): RunDependencyRecord => ({
  callId: row.callId,
  createdAt: row.createdAt,
  description: row.description,
  id: row.id,
  resolutionJson: row.resolutionJson,
  resolvedAt: row.resolvedAt,
  runId: asRunId(row.runId),
  status: row.status,
  targetKind: row.targetKind,
  targetRef: row.targetRef,
  targetRunId: row.targetRunId ? asRunId(row.targetRunId) : null,
  tenantId: asTenantId(row.tenantId),
  timeoutAt: row.timeoutAt,
  type: row.type,
})

export const createRunDependencyRepository = (db: RepositoryDatabase) => {
  const getById = (
    scope: TenantScope,
    dependencyId: string,
  ): Result<RunDependencyRecord, DomainError> => {
    const row = db
      .select()
      .from(runDependencies)
      .where(
        and(eq(runDependencies.id, dependencyId), eq(runDependencies.tenantId, scope.tenantId)),
      )
      .get()

    if (!row) {
      return err({
        message: `run dependency ${dependencyId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toRunDependencyRecord(row))
  }

  return {
    create: (
      scope: TenantScope,
      input: CreateRunDependencyInput,
    ): Result<RunDependencyRecord, DomainError> => {
      try {
        const record: RunDependencyRecord = {
          callId: input.callId,
          createdAt: input.createdAt,
          description: input.description ?? null,
          id: input.id,
          resolutionJson: null,
          resolvedAt: null,
          runId: input.runId,
          status: 'pending',
          targetKind: input.targetKind,
          targetRef: input.targetRef ?? null,
          targetRunId: input.targetRunId ?? null,
          tenantId: scope.tenantId,
          timeoutAt: input.timeoutAt ?? null,
          type: input.type,
        }

        db.insert(runDependencies)
          .values({
            ...record,
          })
          .run()

        return ok(record)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown run dependency create failure'

        return err({
          message: `failed to create run dependency ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getById,
    listByRunId: (scope: TenantScope, runId: RunId): Result<RunDependencyRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(runDependencies)
          .where(
            and(eq(runDependencies.runId, runId), eq(runDependencies.tenantId, scope.tenantId)),
          )
          .orderBy(asc(runDependencies.createdAt), asc(runDependencies.id))
          .all()

        return ok(rows.map(toRunDependencyRecord))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown run dependency list failure'

        return err({
          message: `failed to list run dependencies for run ${runId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    listPendingByRunId: (
      scope: TenantScope,
      runId: RunId,
    ): Result<RunDependencyRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(runDependencies)
          .where(
            and(
              eq(runDependencies.runId, runId),
              eq(runDependencies.tenantId, scope.tenantId),
              eq(runDependencies.status, 'pending'),
            ),
          )
          .orderBy(asc(runDependencies.createdAt), asc(runDependencies.id))
          .all()

        return ok(rows.map(toRunDependencyRecord))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown pending run dependency list failure'

        return err({
          message: `failed to list pending run dependencies for run ${runId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    listPendingAgentByTargetRunId: (
      scope: TenantScope,
      targetRunId: RunId,
    ): Result<RunDependencyRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(runDependencies)
          .where(
            and(
              eq(runDependencies.targetRunId, targetRunId),
              eq(runDependencies.tenantId, scope.tenantId),
              eq(runDependencies.status, 'pending'),
              eq(runDependencies.type, 'agent'),
              eq(runDependencies.targetKind, 'run'),
            ),
          )
          .orderBy(asc(runDependencies.createdAt), asc(runDependencies.id))
          .all()

        return ok(rows.map(toRunDependencyRecord))
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown pending agent run dependency list failure'

        return err({
          message: `failed to list pending agent dependencies targeting run ${targetRunId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    resolve: (
      scope: TenantScope,
      input: ResolveRunDependencyInput,
    ): Result<RunDependencyRecord, DomainError> => {
      try {
        const result = db
          .update(runDependencies)
          .set({
            resolutionJson: input.resolutionJson,
            resolvedAt: input.resolvedAt,
            status: input.status,
          })
          .where(
            and(
              eq(runDependencies.id, input.id),
              eq(runDependencies.tenantId, scope.tenantId),
              eq(runDependencies.status, 'pending'),
            ),
          )
          .run()

        if (result.changes === 0) {
          return err({
            message: `run dependency ${input.id} could not be resolved`,
            type: 'conflict',
          })
        }

        return getById(scope, input.id)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown run dependency resolution failure'

        return err({
          message: `failed to resolve run dependency ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    resolveManyForRun: (
      scope: TenantScope,
      input: {
        ids: string[]
        resolutionJson: unknown
        resolvedAt: string
        runId: RunId
        status: Extract<RunDependencyStatus, 'cancelled' | 'timed_out'>
      },
    ): Result<number, DomainError> => {
      if (input.ids.length === 0) {
        return ok(0)
      }

      try {
        const result = db
          .update(runDependencies)
          .set({
            resolutionJson: input.resolutionJson,
            resolvedAt: input.resolvedAt,
            status: input.status,
          })
          .where(
            and(
              eq(runDependencies.runId, input.runId),
              eq(runDependencies.tenantId, scope.tenantId),
              inArray(runDependencies.id, input.ids),
              eq(runDependencies.status, 'pending'),
            ),
          )
          .run()

        return ok(result.changes)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown run wait bulk resolution failure'

        return err({
          message: `failed to update pending waits for run ${input.runId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    toRecord: toRunDependencyRecord,
  }
}
