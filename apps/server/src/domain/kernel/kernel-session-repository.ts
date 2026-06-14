import { and, asc, count, eq, inArray } from 'drizzle-orm'

import { kernelSessions } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  asKernelSessionId,
  asRunId,
  asSessionThreadId,
  asTenantId,
  asWorkSessionId,
  type KernelSessionId,
  type RunId,
  type SessionThreadId,
  type TenantId,
  type WorkSessionId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'
import type { KernelProvider, KernelSessionStatus } from './types'

export interface KernelSessionRecord {
  completedAt: string | null
  createdAt: string
  durationMs: number | null
  endpoint: string | null
  errorText: string | null
  id: KernelSessionId
  policySnapshotJson: Record<string, unknown>
  provider: KernelProvider
  requestJson: Record<string, unknown>
  resultJson: Record<string, unknown> | null
  runId: RunId
  sessionId: WorkSessionId
  startedAt: string | null
  status: KernelSessionStatus
  stderrText: string | null
  stdoutText: string | null
  tenantId: TenantId
  threadId: SessionThreadId | null
  toolExecutionId: string | null
}

export interface CreateKernelSessionInput {
  createdAt: string
  endpoint?: string | null
  id: KernelSessionId
  policySnapshotJson: Record<string, unknown>
  provider: KernelProvider
  requestJson: Record<string, unknown>
  runId: RunId
  sessionId: WorkSessionId
  status: KernelSessionStatus
  threadId?: SessionThreadId | null
  toolExecutionId?: string | null
}

export interface UpdateKernelSessionInput {
  completedAt?: string | null
  durationMs?: number | null
  endpoint?: string | null
  errorText?: string | null
  id: KernelSessionId
  resultJson?: Record<string, unknown> | null
  startedAt?: string | null
  status?: KernelSessionStatus
  stderrText?: string | null
  stdoutText?: string | null
}

const toRecord = (row: typeof kernelSessions.$inferSelect): KernelSessionRecord => ({
  completedAt: row.completedAt,
  createdAt: row.createdAt,
  durationMs: row.durationMs,
  endpoint: row.endpoint,
  errorText: row.errorText,
  id: asKernelSessionId(row.id),
  policySnapshotJson: row.policySnapshotJson as Record<string, unknown>,
  provider: row.provider,
  requestJson: row.requestJson as Record<string, unknown>,
  resultJson: row.resultJson ? (row.resultJson as Record<string, unknown>) : null,
  runId: asRunId(row.runId),
  sessionId: asWorkSessionId(row.sessionId),
  startedAt: row.startedAt,
  status: row.status,
  stderrText: row.stderrText,
  stdoutText: row.stdoutText,
  tenantId: asTenantId(row.tenantId),
  threadId: row.threadId ? asSessionThreadId(row.threadId) : null,
  toolExecutionId: row.toolExecutionId,
})

const buildPatch = (
  input: UpdateKernelSessionInput,
): Partial<typeof kernelSessions.$inferInsert> => {
  const patch: Partial<typeof kernelSessions.$inferInsert> = {}

  if (input.completedAt !== undefined) {
    patch.completedAt = input.completedAt
  }
  if (input.durationMs !== undefined) {
    patch.durationMs = input.durationMs
  }
  if (input.endpoint !== undefined) {
    patch.endpoint = input.endpoint
  }
  if (input.errorText !== undefined) {
    patch.errorText = input.errorText
  }
  if (input.resultJson !== undefined) {
    patch.resultJson = input.resultJson
  }
  if (input.startedAt !== undefined) {
    patch.startedAt = input.startedAt
  }
  if (input.status !== undefined) {
    patch.status = input.status
  }
  if (input.stderrText !== undefined) {
    patch.stderrText = input.stderrText
  }
  if (input.stdoutText !== undefined) {
    patch.stdoutText = input.stdoutText
  }

  return patch
}

export const createKernelSessionRepository = (db: RepositoryDatabase) => {
  const getById = (
    scope: TenantScope,
    id: KernelSessionId,
  ): Result<KernelSessionRecord, DomainError> => {
    const row = db
      .select()
      .from(kernelSessions)
      .where(and(eq(kernelSessions.id, id), eq(kernelSessions.tenantId, scope.tenantId)))
      .get()

    if (!row) {
      return err({
        message: `kernel session ${id} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toRecord(row))
  }

  return {
    create: (
      scope: TenantScope,
      input: CreateKernelSessionInput,
    ): Result<KernelSessionRecord, DomainError> => {
      try {
        const record: KernelSessionRecord = {
          completedAt: null,
          createdAt: input.createdAt,
          durationMs: null,
          endpoint: input.endpoint ?? null,
          errorText: null,
          id: input.id,
          policySnapshotJson: input.policySnapshotJson,
          provider: input.provider,
          requestJson: input.requestJson,
          resultJson: null,
          runId: input.runId,
          sessionId: input.sessionId,
          startedAt: null,
          status: input.status,
          stderrText: null,
          stdoutText: null,
          tenantId: scope.tenantId,
          threadId: input.threadId ?? null,
          toolExecutionId: input.toolExecutionId ?? null,
        }

        db.insert(kernelSessions)
          .values({ ...record })
          .run()

        return ok(record)
      } catch (error) {
        return err({
          message: `failed to create kernel session ${input.id}: ${error instanceof Error ? error.message : 'Unknown kernel session create failure'}`,
          type: 'conflict',
        })
      }
    },
    countActive: (scope: TenantScope): Result<number, DomainError> => {
      try {
        const row = db
          .select({ value: count() })
          .from(kernelSessions)
          .where(
            and(
              eq(kernelSessions.tenantId, scope.tenantId),
              inArray(kernelSessions.status, ['pending', 'running']),
            ),
          )
          .get()

        return ok(row?.value ?? 0)
      } catch (error) {
        return err({
          message: `failed to count active kernel sessions: ${error instanceof Error ? error.message : 'Unknown kernel session count failure'}`,
          type: 'conflict',
        })
      }
    },
    getById,
    listByRunId: (scope: TenantScope, runId: RunId): Result<KernelSessionRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(kernelSessions)
          .where(and(eq(kernelSessions.runId, runId), eq(kernelSessions.tenantId, scope.tenantId)))
          .orderBy(asc(kernelSessions.createdAt), asc(kernelSessions.id))
          .all()

        return ok(rows.map(toRecord))
      } catch (error) {
        return err({
          message: `failed to list kernel sessions for run ${runId}: ${error instanceof Error ? error.message : 'Unknown kernel session list failure'}`,
          type: 'conflict',
        })
      }
    },
    update: (
      scope: TenantScope,
      input: UpdateKernelSessionInput,
    ): Result<KernelSessionRecord, DomainError> => {
      try {
        const result = db
          .update(kernelSessions)
          .set(buildPatch(input))
          .where(and(eq(kernelSessions.id, input.id), eq(kernelSessions.tenantId, scope.tenantId)))
          .run()

        if (result.changes === 0) {
          return err({
            message: `kernel session ${input.id} could not be updated`,
            type: 'conflict',
          })
        }

        return getById(scope, input.id)
      } catch (error) {
        return err({
          message: `failed to update kernel session ${input.id}: ${error instanceof Error ? error.message : 'Unknown kernel session update failure'}`,
          type: 'conflict',
        })
      }
    },
  }
}
