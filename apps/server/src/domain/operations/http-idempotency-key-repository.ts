import { and, eq, lte } from 'drizzle-orm'

import { httpIdempotencyKeys } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import { createPrefixedId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

export type HttpIdempotencyStatus = 'in_progress' | 'completed'

export interface HttpIdempotencyKeyRecord {
  completedAt: string | null
  createdAt: string
  expiresAt: string | null
  id: string
  idempotencyKey: string
  requestHash: string
  responseDataJson: unknown | null
  scope: string
  status: HttpIdempotencyStatus
  statusCode: number | null
  tenantId: string
  updatedAt: string
}

export interface BeginIdempotencyRequestInput {
  expiresAt: string
  idempotencyKey: string
  now: string
  requestHash: string
  scope: string
}

export interface CompleteIdempotencyRequestInput {
  completedAt: string
  id: string
  responseDataJson: unknown
  statusCode: number
  updatedAt: string
}

export interface RecordIdempotencyProgressInput {
  id: string
  responseDataJson: unknown
  updatedAt: string
}

const toRecord = (row: typeof httpIdempotencyKeys.$inferSelect): HttpIdempotencyKeyRecord => ({
  completedAt: row.completedAt,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  id: row.id,
  idempotencyKey: row.idempotencyKey,
  requestHash: row.requestHash,
  responseDataJson: row.responseDataJson,
  scope: row.scope,
  status: row.status,
  statusCode: row.statusCode,
  tenantId: row.tenantId,
  updatedAt: row.updatedAt,
})

export type BeginIdempotencyRequestResult =
  | {
      kind: 'execute'
      record: HttpIdempotencyKeyRecord
    }
  | {
      kind: 'replay'
      record: HttpIdempotencyKeyRecord
    }

export const createHttpIdempotencyKeyRepository = (db: RepositoryDatabase) => ({
  getByKey: (
    scope: TenantScope,
    input: {
      idempotencyKey: string
      scope: string
    },
  ): Result<HttpIdempotencyKeyRecord | null, DomainError> => {
    try {
      const row = db
        .select()
        .from(httpIdempotencyKeys)
        .where(
          and(
            eq(httpIdempotencyKeys.tenantId, scope.tenantId),
            eq(httpIdempotencyKeys.scope, input.scope),
            eq(httpIdempotencyKeys.idempotencyKey, input.idempotencyKey),
          ),
        )
        .get()

      return ok(row ? toRecord(row) : null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown idempotency lookup failure'

      return err({
        message: `failed to read idempotency key "${input.idempotencyKey}": ${message}`,
        type: 'conflict',
      })
    }
  },
  abandon: (
    scope: TenantScope,
    input: {
      id: string
    },
  ): Result<null, DomainError> => {
    try {
      db.delete(httpIdempotencyKeys)
        .where(
          and(
            eq(httpIdempotencyKeys.id, input.id),
            eq(httpIdempotencyKeys.tenantId, scope.tenantId),
            eq(httpIdempotencyKeys.status, 'in_progress'),
          ),
        )
        .run()

      return ok(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown idempotency abandon failure'

      return err({
        message: `failed to abandon idempotency key ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  begin: (
    scope: TenantScope,
    input: BeginIdempotencyRequestInput,
  ): Result<BeginIdempotencyRequestResult, DomainError> => {
    try {
      const existing = db
        .select()
        .from(httpIdempotencyKeys)
        .where(
          and(
            eq(httpIdempotencyKeys.tenantId, scope.tenantId),
            eq(httpIdempotencyKeys.scope, input.scope),
            eq(httpIdempotencyKeys.idempotencyKey, input.idempotencyKey),
          ),
        )
        .get()

      if (!existing) {
        const record: HttpIdempotencyKeyRecord = {
          completedAt: null,
          createdAt: input.now,
          expiresAt: input.expiresAt,
          id: createPrefixedId('idp'),
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          responseDataJson: null,
          scope: input.scope,
          status: 'in_progress',
          statusCode: null,
          tenantId: scope.tenantId,
          updatedAt: input.now,
        }

        db.insert(httpIdempotencyKeys).values(record).run()

        return ok({
          kind: 'execute',
          record,
        })
      }

      if (existing.requestHash !== input.requestHash) {
        return err({
          message: `idempotency key "${input.idempotencyKey}" was already used with a different request payload`,
          type: 'conflict',
        })
      }

      if (existing.status === 'completed') {
        return ok({
          kind: 'replay',
          record: toRecord(existing),
        })
      }

      const reclaimResult = db
        .update(httpIdempotencyKeys)
        .set({
          completedAt: null,
          expiresAt: input.expiresAt,
          requestHash: input.requestHash,
          responseDataJson: null,
          status: 'in_progress',
          statusCode: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(httpIdempotencyKeys.id, existing.id),
            eq(httpIdempotencyKeys.tenantId, scope.tenantId),
            eq(httpIdempotencyKeys.status, 'in_progress'),
            lte(httpIdempotencyKeys.expiresAt, input.now),
          ),
        )
        .run()

      if (reclaimResult.changes === 0) {
        return err({
          message: `idempotent request "${input.idempotencyKey}" is already in progress`,
          type: 'conflict',
        })
      }

      return ok({
        kind: 'execute',
        record: {
          ...toRecord(existing),
          expiresAt: input.expiresAt,
          requestHash: input.requestHash,
          responseDataJson: null,
          status: 'in_progress',
          statusCode: null,
          updatedAt: input.now,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown idempotency begin failure'

      return err({
        message: `failed to begin idempotent request "${input.idempotencyKey}": ${message}`,
        type: 'conflict',
      })
    }
  },
  complete: (
    scope: TenantScope,
    input: CompleteIdempotencyRequestInput,
  ): Result<HttpIdempotencyKeyRecord, DomainError> => {
    try {
      const result = db
        .update(httpIdempotencyKeys)
        .set({
          completedAt: input.completedAt,
          expiresAt: null,
          responseDataJson: input.responseDataJson,
          status: 'completed',
          statusCode: input.statusCode,
          updatedAt: input.updatedAt,
        })
        .where(
          and(
            eq(httpIdempotencyKeys.id, input.id),
            eq(httpIdempotencyKeys.tenantId, scope.tenantId),
            eq(httpIdempotencyKeys.status, 'in_progress'),
          ),
        )
        .run()

      if (result.changes === 0) {
        return err({
          message: `idempotency key ${input.id} could not be completed`,
          type: 'conflict',
        })
      }

      const row = db
        .select()
        .from(httpIdempotencyKeys)
        .where(
          and(
            eq(httpIdempotencyKeys.id, input.id),
            eq(httpIdempotencyKeys.tenantId, scope.tenantId),
          ),
        )
        .get()

      if (!row) {
        return err({
          message: `idempotency key ${input.id} was not found after completion`,
          type: 'conflict',
        })
      }

      return ok(toRecord(row))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown idempotency completion failure'

      return err({
        message: `failed to complete idempotency key ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  recordProgress: (
    scope: TenantScope,
    input: RecordIdempotencyProgressInput,
  ): Result<HttpIdempotencyKeyRecord, DomainError> => {
    try {
      const result = db
        .update(httpIdempotencyKeys)
        .set({
          responseDataJson: input.responseDataJson,
          updatedAt: input.updatedAt,
        })
        .where(
          and(
            eq(httpIdempotencyKeys.id, input.id),
            eq(httpIdempotencyKeys.tenantId, scope.tenantId),
            eq(httpIdempotencyKeys.status, 'in_progress'),
          ),
        )
        .run()

      if (result.changes === 0) {
        return err({
          message: `idempotency key ${input.id} could not record progress`,
          type: 'conflict',
        })
      }

      const row = db
        .select()
        .from(httpIdempotencyKeys)
        .where(
          and(
            eq(httpIdempotencyKeys.id, input.id),
            eq(httpIdempotencyKeys.tenantId, scope.tenantId),
          ),
        )
        .get()

      if (!row) {
        return err({
          message: `idempotency key ${input.id} was not found after recording progress`,
          type: 'conflict',
        })
      }

      return ok(toRecord(row))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown idempotency progress failure'

      return err({
        message: `failed to record progress for idempotency key ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
