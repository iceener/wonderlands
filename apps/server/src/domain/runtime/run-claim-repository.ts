import { and, eq, gte, lte } from 'drizzle-orm'

import { runClaims } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import { asRunId, asTenantId, type RunId, type TenantId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

export interface RunClaimRecord {
  acquiredAt: string
  expiresAt: string
  renewedAt: string
  runId: RunId
  tenantId: TenantId
  workerId: string
}

export interface ClaimRunInput {
  acquiredAt: string
  expiresAt: string
  renewedAt: string
  runId: RunId
  workerId: string
}

export interface HeartbeatRunClaimInput {
  expiresAt: string
  renewedAt: string
  runId: RunId
  workerId: string
}

const toRunClaimRecord = (row: typeof runClaims.$inferSelect): RunClaimRecord => ({
  acquiredAt: row.acquiredAt,
  expiresAt: row.expiresAt,
  renewedAt: row.renewedAt,
  runId: asRunId(row.runId),
  tenantId: asTenantId(row.tenantId),
  workerId: row.workerId,
})

export const createRunClaimRepository = (db: RepositoryDatabase) => ({
  claim: (scope: TenantScope, input: ClaimRunInput): Result<RunClaimRecord, DomainError> => {
    try {
      const existing = db
        .select()
        .from(runClaims)
        .where(and(eq(runClaims.runId, input.runId), eq(runClaims.tenantId, scope.tenantId)))
        .get()

      if (!existing) {
        const record: RunClaimRecord = {
          acquiredAt: input.acquiredAt,
          expiresAt: input.expiresAt,
          renewedAt: input.renewedAt,
          runId: input.runId,
          tenantId: scope.tenantId,
          workerId: input.workerId,
        }

        db.insert(runClaims)
          .values({
            ...record,
          })
          .run()

        return ok(record)
      }

      if (existing.workerId !== input.workerId && existing.expiresAt > input.acquiredAt) {
        return err({
          message: `run ${input.runId} is already claimed by worker ${existing.workerId}`,
          type: 'conflict',
        })
      }

      const result = db
        .update(runClaims)
        .set({
          acquiredAt: input.acquiredAt,
          expiresAt: input.expiresAt,
          renewedAt: input.renewedAt,
          workerId: input.workerId,
        })
        .where(
          and(
            eq(runClaims.runId, input.runId),
            eq(runClaims.tenantId, scope.tenantId),
            existing.workerId === input.workerId
              ? eq(runClaims.workerId, input.workerId)
              : lte(runClaims.expiresAt, input.acquiredAt),
          ),
        )
        .run()

      if (result.changes === 0) {
        return err({
          message: `run ${input.runId} could not be claimed`,
          type: 'conflict',
        })
      }

      return ok({
        acquiredAt: input.acquiredAt,
        expiresAt: input.expiresAt,
        renewedAt: input.renewedAt,
        runId: input.runId,
        tenantId: scope.tenantId,
        workerId: input.workerId,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown run claim failure'

      return err({
        message: `failed to claim run ${input.runId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  heartbeatClaim: (
    scope: TenantScope,
    input: HeartbeatRunClaimInput,
  ): Result<RunClaimRecord, DomainError> => {
    try {
      const result = db
        .update(runClaims)
        .set({
          expiresAt: input.expiresAt,
          renewedAt: input.renewedAt,
        })
        .where(
          and(
            eq(runClaims.runId, input.runId),
            eq(runClaims.tenantId, scope.tenantId),
            eq(runClaims.workerId, input.workerId),
            gte(runClaims.expiresAt, input.renewedAt),
          ),
        )
        .run()

      if (result.changes === 0) {
        return err({
          message: `run ${input.runId} claim could not be heartbeat-renewed`,
          type: 'conflict',
        })
      }

      const updated = db
        .select()
        .from(runClaims)
        .where(and(eq(runClaims.runId, input.runId), eq(runClaims.tenantId, scope.tenantId)))
        .get()

      if (!updated) {
        return err({
          message: `run ${input.runId} claim was not found after heartbeat`,
          type: 'conflict',
        })
      }

      return ok(toRunClaimRecord(updated))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown run claim heartbeat failure'

      return err({
        message: `failed to heartbeat run claim for ${input.runId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  releaseClaim: (
    scope: TenantScope,
    input: {
      runId: RunId
      workerId: string
    },
  ): Result<null, DomainError> => {
    try {
      db.delete(runClaims)
        .where(
          and(
            eq(runClaims.runId, input.runId),
            eq(runClaims.tenantId, scope.tenantId),
            eq(runClaims.workerId, input.workerId),
          ),
        )
        .run()

      return ok(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown run claim release failure'

      return err({
        message: `failed to release run claim for ${input.runId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  toRecord: toRunClaimRecord,
})
