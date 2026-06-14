import { and, asc, eq } from 'drizzle-orm'
import { sandboxExecutions } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  asJobId,
  asRunId,
  asSandboxExecutionId,
  asSessionThreadId,
  asTenantId,
  asWorkSessionId,
  asWorkspaceId,
  type JobId,
  type RunId,
  type SandboxExecutionId,
  type SessionThreadId,
  type TenantId,
  type WorkSessionId,
  type WorkspaceId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'
import type {
  SandboxExecutionStatus,
  SandboxNetworkMode,
  SandboxProvider,
  SandboxRuntime,
  SandboxVaultAccessMode,
} from './types'

export interface SandboxExecutionRecord {
  completedAt: string | null
  createdAt: string
  durationMs: number | null
  errorText: string | null
  externalSandboxId: string | null
  id: SandboxExecutionId
  jobId: JobId | null
  networkMode: SandboxNetworkMode
  policySnapshotJson: Record<string, unknown>
  provider: SandboxProvider
  queuedAt: string | null
  requestJson: Record<string, unknown>
  runId: RunId
  runtime: SandboxRuntime
  sessionId: WorkSessionId
  startedAt: string | null
  status: SandboxExecutionStatus
  stderrText: string | null
  stdoutText: string | null
  tenantId: TenantId
  threadId: SessionThreadId | null
  toolExecutionId: string | null
  vaultAccessMode: SandboxVaultAccessMode
  workspaceId: WorkspaceId | null
  workspaceRef: string | null
}

export interface CreateSandboxExecutionInput {
  createdAt: string
  id: SandboxExecutionId
  jobId?: JobId | null
  networkMode: SandboxNetworkMode
  policySnapshotJson: Record<string, unknown>
  provider: SandboxProvider
  queuedAt?: string | null
  requestJson: Record<string, unknown>
  runId: RunId
  runtime: SandboxRuntime
  sessionId: WorkSessionId
  status: SandboxExecutionStatus
  threadId?: SessionThreadId | null
  toolExecutionId?: string | null
  vaultAccessMode: SandboxVaultAccessMode
  workspaceId?: WorkspaceId | null
  workspaceRef?: string | null
}

export interface UpdateSandboxExecutionInput {
  completedAt?: string | null
  durationMs?: number | null
  errorText?: string | null
  externalSandboxId?: string | null
  id: SandboxExecutionId
  queuedAt?: string | null
  startedAt?: string | null
  status?: SandboxExecutionStatus
  stderrText?: string | null
  stdoutText?: string | null
}

export interface ClaimSandboxExecutionInput {
  id: SandboxExecutionId
  startedAt: string
}

const toRecord = (row: typeof sandboxExecutions.$inferSelect): SandboxExecutionRecord => ({
  completedAt: row.completedAt,
  createdAt: row.createdAt,
  durationMs: row.durationMs,
  errorText: row.errorText,
  externalSandboxId: row.externalSandboxId,
  id: asSandboxExecutionId(row.id),
  jobId: row.jobId ? asJobId(row.jobId) : null,
  networkMode: row.networkMode,
  policySnapshotJson: row.policySnapshotJson as Record<string, unknown>,
  provider: row.provider,
  queuedAt: row.queuedAt,
  requestJson: row.requestJson as Record<string, unknown>,
  runId: asRunId(row.runId),
  runtime: row.runtime,
  sessionId: asWorkSessionId(row.sessionId),
  startedAt: row.startedAt,
  status: row.status,
  stderrText: row.stderrText,
  stdoutText: row.stdoutText,
  tenantId: asTenantId(row.tenantId),
  threadId: row.threadId ? asSessionThreadId(row.threadId) : null,
  toolExecutionId: row.toolExecutionId,
  vaultAccessMode: row.vaultAccessMode,
  workspaceId: row.workspaceId ? asWorkspaceId(row.workspaceId) : null,
  workspaceRef: row.workspaceRef,
})

const buildPatch = (
  input: UpdateSandboxExecutionInput,
): Partial<typeof sandboxExecutions.$inferInsert> => {
  const patch: Partial<typeof sandboxExecutions.$inferInsert> = {}

  if (input.completedAt !== undefined) {
    patch.completedAt = input.completedAt
  }
  if (input.durationMs !== undefined) {
    patch.durationMs = input.durationMs
  }
  if (input.errorText !== undefined) {
    patch.errorText = input.errorText
  }
  if (input.externalSandboxId !== undefined) {
    patch.externalSandboxId = input.externalSandboxId
  }
  if (input.queuedAt !== undefined) {
    patch.queuedAt = input.queuedAt
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

export const createSandboxExecutionRepository = (db: RepositoryDatabase) => {
  const getById = (
    scope: TenantScope,
    id: SandboxExecutionId,
  ): Result<SandboxExecutionRecord, DomainError> => {
    const row = db
      .select()
      .from(sandboxExecutions)
      .where(and(eq(sandboxExecutions.id, id), eq(sandboxExecutions.tenantId, scope.tenantId)))
      .get()

    if (!row) {
      return err({
        message: `sandbox execution ${id} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toRecord(row))
  }

  return {
    claimQueued: (
      scope: TenantScope,
      input: ClaimSandboxExecutionInput,
    ): Result<SandboxExecutionRecord, DomainError> => {
      try {
        const result = db
          .update(sandboxExecutions)
          .set({
            startedAt: input.startedAt,
            status: 'running',
          })
          .where(
            and(
              eq(sandboxExecutions.id, input.id),
              eq(sandboxExecutions.tenantId, scope.tenantId),
              eq(sandboxExecutions.status, 'queued'),
            ),
          )
          .run()

        if (result.changes === 0) {
          return err({
            message: `sandbox execution ${input.id} could not be claimed`,
            type: 'conflict',
          })
        }

        return getById(scope, input.id)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown sandbox execution claim failure'

        return err({
          message: `failed to claim sandbox execution ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    create: (
      scope: TenantScope,
      input: CreateSandboxExecutionInput,
    ): Result<SandboxExecutionRecord, DomainError> => {
      try {
        const record: SandboxExecutionRecord = {
          completedAt: null,
          createdAt: input.createdAt,
          durationMs: null,
          errorText: null,
          externalSandboxId: null,
          id: input.id,
          jobId: input.jobId ?? null,
          networkMode: input.networkMode,
          policySnapshotJson: input.policySnapshotJson,
          provider: input.provider,
          queuedAt: input.queuedAt ?? null,
          requestJson: input.requestJson,
          runId: input.runId,
          runtime: input.runtime,
          sessionId: input.sessionId,
          startedAt: null,
          status: input.status,
          stderrText: null,
          stdoutText: null,
          tenantId: scope.tenantId,
          threadId: input.threadId ?? null,
          toolExecutionId: input.toolExecutionId ?? null,
          vaultAccessMode: input.vaultAccessMode,
          workspaceId: input.workspaceId ?? null,
          workspaceRef: input.workspaceRef ?? null,
        }

        db.insert(sandboxExecutions)
          .values({ ...record })
          .run()

        return ok(record)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown sandbox execution create failure'

        return err({
          message: `failed to create sandbox execution ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getById,
    listByRunId: (
      scope: TenantScope,
      runId: RunId,
    ): Result<SandboxExecutionRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(sandboxExecutions)
          .where(
            and(eq(sandboxExecutions.runId, runId), eq(sandboxExecutions.tenantId, scope.tenantId)),
          )
          .orderBy(asc(sandboxExecutions.createdAt), asc(sandboxExecutions.id))
          .all()

        return ok(rows.map(toRecord))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown sandbox execution list failure'

        return err({
          message: `failed to list sandbox executions for run ${runId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    listQueued: (scope: TenantScope, limit = 25): Result<SandboxExecutionRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(sandboxExecutions)
          .where(
            and(
              eq(sandboxExecutions.status, 'queued'),
              eq(sandboxExecutions.tenantId, scope.tenantId),
            ),
          )
          .orderBy(asc(sandboxExecutions.createdAt), asc(sandboxExecutions.id))
          .limit(limit)
          .all()

        return ok(rows.map(toRecord))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown queued sandbox execution list failure'

        return err({
          message: `failed to list queued sandbox executions: ${message}`,
          type: 'conflict',
        })
      }
    },
    listQueuedGlobal: (limit = 25): Result<SandboxExecutionRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(sandboxExecutions)
          .where(eq(sandboxExecutions.status, 'queued'))
          .orderBy(asc(sandboxExecutions.createdAt), asc(sandboxExecutions.id))
          .limit(limit)
          .all()

        return ok(rows.map(toRecord))
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown global queued sandbox execution list failure'

        return err({
          message: `failed to list queued sandbox executions globally: ${message}`,
          type: 'conflict',
        })
      }
    },
    update: (
      scope: TenantScope,
      input: UpdateSandboxExecutionInput,
    ): Result<SandboxExecutionRecord, DomainError> => {
      try {
        const patch = buildPatch(input)
        const result = db
          .update(sandboxExecutions)
          .set(patch)
          .where(
            and(eq(sandboxExecutions.id, input.id), eq(sandboxExecutions.tenantId, scope.tenantId)),
          )
          .run()

        if (result.changes === 0) {
          return err({
            message: `sandbox execution ${input.id} could not be updated`,
            type: 'conflict',
          })
        }

        return getById(scope, input.id)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown sandbox execution update failure'

        return err({
          message: `failed to update sandbox execution ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
  }
}
