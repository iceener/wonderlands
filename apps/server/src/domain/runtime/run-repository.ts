import { and, asc, eq, inArray } from 'drizzle-orm'

import { runs } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  type AccountId,
  type AgentId,
  type AgentRevisionId,
  asAccountId,
  asAgentId,
  asAgentRevisionId,
  asJobId,
  asRunId,
  asSessionThreadId,
  asTenantId,
  asToolProfileId,
  asWorkSessionId,
  asWorkspaceId,
  type JobId,
  type RunId,
  type SessionThreadId,
  type TenantId,
  type ToolProfileId,
  type WorkSessionId,
  type WorkspaceId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

export interface RunRecord {
  actorAccountId: AccountId | null
  agentId: AgentId | null
  agentRevisionId: AgentRevisionId | null
  completedAt: string | null
  configSnapshot: Record<string, unknown>
  createdAt: string
  errorJson: unknown | null
  id: RunId
  lastProgressAt: string | null
  parentRunId: RunId | null
  resultJson: unknown | null
  rootRunId: RunId
  sessionId: WorkSessionId
  sourceCallId: string | null
  staleRecoveryCount: number
  startedAt: string | null
  status: 'pending' | 'running' | 'cancelling' | 'waiting' | 'completed' | 'failed' | 'cancelled'
  task: string
  tenantId: TenantId
  targetKind: 'assistant' | 'agent'
  threadId: SessionThreadId | null
  toolProfileId: ToolProfileId | null
  turnCount: number
  updatedAt: string
  version: number
  jobId: JobId | null
  workspaceId: WorkspaceId | null
  workspaceRef: string | null
}

export interface CreateRunInput {
  actorAccountId?: AccountId | null
  agentId?: AgentId | null
  agentRevisionId?: AgentRevisionId | null
  configSnapshot: Record<string, unknown>
  createdAt: string
  id: RunId
  parentRunId?: RunId | null
  resultJson?: unknown | null
  rootRunId: RunId
  sessionId: WorkSessionId
  sourceCallId?: string | null
  startedAt: string
  task: string
  targetKind?: RunRecord['targetKind']
  threadId: SessionThreadId | null
  toolProfileId?: ToolProfileId | null
  jobId?: JobId | null
  workspaceId?: WorkspaceId | null
  workspaceRef: string | null
}

export interface UpdateRunStartInput {
  configSnapshot: Record<string, unknown>
  expectedStatus: RunRecord['status']
  expectedVersion: number
  lastProgressAt: string
  runId: RunId
  startedAt: string
  updatedAt: string
}

export interface UpdateRunConfigSnapshotInput {
  configSnapshot: Record<string, unknown>
  expectedStatus: RunRecord['status']
  expectedVersion: number
  runId: RunId
  updatedAt: string
}

export interface CompleteRunInput {
  completedAt: string
  expectedStatus: RunRecord['status']
  expectedVersion: number
  lastProgressAt: string
  resultJson: unknown
  runId: RunId
  turnCount: number
  updatedAt: string
}

export interface WaitRunInput {
  expectedStatus: RunRecord['status']
  expectedVersion: number
  lastProgressAt: string
  resultJson: unknown
  runId: RunId
  updatedAt: string
}

export interface RefreshWaitingRunInput {
  expectedStatus: Extract<RunRecord['status'], 'waiting'>
  expectedVersion: number
  lastProgressAt: string
  resultJson: unknown
  runId: RunId
  updatedAt: string
}

export interface RequeueRunInput {
  expectedStatus: Extract<RunRecord['status'], 'running'>
  expectedVersion: number
  lastProgressAt: string
  resultJson?: unknown
  runId: RunId
  staleRecoveryCount?: number
  updatedAt: string
}

export interface CancelRunInput {
  completedAt: string
  expectedStatus: RunRecord['status']
  expectedVersion: number
  lastProgressAt: string
  resultJson: unknown
  runId: RunId
  updatedAt: string
}

export interface MarkRunCancellingInput {
  expectedStatus: Extract<RunRecord['status'], 'running'>
  expectedVersion: number
  lastProgressAt: string
  resultJson: unknown
  runId: RunId
  updatedAt: string
}

export interface FailRunInput {
  completedAt: string
  errorJson: unknown
  expectedStatus: RunRecord['status']
  expectedVersion: number
  lastProgressAt: string
  resultJson?: unknown
  runId: RunId
  turnCount: number
  updatedAt: string
}

const toRunRecord = (runRow: typeof runs.$inferSelect): RunRecord => ({
  actorAccountId: runRow.actorAccountId ? asAccountId(runRow.actorAccountId) : null,
  agentId: runRow.agentId ? asAgentId(runRow.agentId) : null,
  agentRevisionId: runRow.agentRevisionId ? asAgentRevisionId(runRow.agentRevisionId) : null,
  completedAt: runRow.completedAt,
  configSnapshot: runRow.configSnapshot as Record<string, unknown>,
  createdAt: runRow.createdAt,
  errorJson: runRow.errorJson,
  id: asRunId(runRow.id),
  lastProgressAt: runRow.lastProgressAt,
  parentRunId: runRow.parentRunId ? asRunId(runRow.parentRunId) : null,
  resultJson: runRow.resultJson,
  rootRunId: asRunId(runRow.rootRunId),
  sessionId: asWorkSessionId(runRow.sessionId),
  sourceCallId: runRow.sourceCallId,
  staleRecoveryCount: runRow.staleRecoveryCount,
  startedAt: runRow.startedAt,
  status: runRow.status,
  task: runRow.task,
  tenantId: asTenantId(runRow.tenantId),
  targetKind: runRow.targetKind,
  threadId: runRow.threadId ? asSessionThreadId(runRow.threadId) : null,
  toolProfileId: runRow.toolProfileId ? asToolProfileId(runRow.toolProfileId) : null,
  turnCount: runRow.turnCount,
  updatedAt: runRow.updatedAt,
  version: runRow.version,
  jobId: runRow.jobId ? asJobId(runRow.jobId) : null,
  workspaceId: runRow.workspaceId ? asWorkspaceId(runRow.workspaceId) : null,
  workspaceRef: runRow.workspaceRef,
})

export const createRunRepository = (db: RepositoryDatabase) => {
  const getById = (scope: TenantScope, runId: RunId): Result<RunRecord, DomainError> => {
    const runRecord = db
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.tenantId, scope.tenantId)))
      .get()

    if (!runRecord) {
      return err({
        message: `run ${runId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toRunRecord(runRecord))
  }

  const buildOptimisticRunTransitionWhere = (
    scope: TenantScope,
    input: {
      expectedStatus: RunRecord['status']
      expectedVersion: number
      runId: RunId
    },
  ) =>
    and(
      eq(runs.id, input.runId),
      eq(runs.tenantId, scope.tenantId),
      eq(runs.status, input.expectedStatus),
      eq(runs.version, input.expectedVersion),
    )

  const updateRunAndReload = (
    scope: TenantScope,
    input: {
      catchMessage: string
      conflictMessage: string
      expectedStatus: RunRecord['status']
      expectedVersion: number
      runId: RunId
      values: Partial<typeof runs.$inferInsert>
    },
  ): Result<RunRecord, DomainError> => {
    try {
      const result = db
        .update(runs)
        .set(input.values)
        .where(
          buildOptimisticRunTransitionWhere(scope, {
            expectedStatus: input.expectedStatus,
            expectedVersion: input.expectedVersion,
            runId: input.runId,
          }),
        )
        .run()

      if (result.changes === 0) {
        return err({
          message: input.conflictMessage,
          type: 'conflict',
        })
      }

      return getById(scope, input.runId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown run update failure'

      return err({
        message: `${input.catchMessage}: ${message}`,
        type: 'conflict',
      })
    }
  }

  return {
    complete: (scope: TenantScope, input: CompleteRunInput): Result<RunRecord, DomainError> =>
      updateRunAndReload(scope, {
        catchMessage: `failed to complete run ${input.runId}`,
        conflictMessage: `run ${input.runId} could not transition to completed from ${input.expectedStatus}`,
        expectedStatus: input.expectedStatus,
        expectedVersion: input.expectedVersion,
        runId: input.runId,
        values: {
          completedAt: input.completedAt,
          errorJson: null,
          lastProgressAt: input.lastProgressAt,
          resultJson: input.resultJson,
          status: 'completed',
          turnCount: input.turnCount + 1,
          updatedAt: input.updatedAt,
          version: input.expectedVersion + 1,
        },
      }),
    cancel: (scope: TenantScope, input: CancelRunInput): Result<RunRecord, DomainError> =>
      updateRunAndReload(scope, {
        catchMessage: `failed to cancel run ${input.runId}`,
        conflictMessage: `run ${input.runId} could not transition to cancelled from ${input.expectedStatus}`,
        expectedStatus: input.expectedStatus,
        expectedVersion: input.expectedVersion,
        runId: input.runId,
        values: {
          completedAt: input.completedAt,
          errorJson: null,
          lastProgressAt: input.lastProgressAt,
          resultJson: input.resultJson,
          status: 'cancelled',
          updatedAt: input.updatedAt,
          version: input.expectedVersion + 1,
        },
      }),
    create: (scope: TenantScope, input: CreateRunInput): Result<RunRecord, DomainError> => {
      try {
        const runRecord: RunRecord = {
          actorAccountId: input.actorAccountId ?? scope.accountId,
          agentId: input.agentId ?? null,
          agentRevisionId: input.agentRevisionId ?? null,
          completedAt: null,
          configSnapshot: input.configSnapshot,
          createdAt: input.createdAt,
          errorJson: null,
          id: input.id,
          lastProgressAt: input.startedAt,
          parentRunId: input.parentRunId ?? null,
          resultJson: input.resultJson ?? null,
          rootRunId: input.rootRunId,
          sessionId: input.sessionId,
          sourceCallId: input.sourceCallId ?? null,
          staleRecoveryCount: 0,
          startedAt: input.startedAt,
          status: 'pending',
          task: input.task,
          tenantId: scope.tenantId,
          targetKind: input.targetKind ?? (input.agentId ? 'agent' : 'assistant'),
          threadId: input.threadId,
          toolProfileId: input.toolProfileId ?? null,
          turnCount: 0,
          updatedAt: input.createdAt,
          version: 1,
          jobId: input.jobId ?? null,
          workspaceId: input.workspaceId ?? null,
          workspaceRef: input.workspaceRef,
        }

        db.insert(runs)
          .values({
            actorAccountId: runRecord.actorAccountId,
            agentId: runRecord.agentId,
            agentRevisionId: runRecord.agentRevisionId,
            completedAt: runRecord.completedAt,
            configSnapshot: runRecord.configSnapshot,
            createdAt: runRecord.createdAt,
            errorJson: runRecord.errorJson,
            id: runRecord.id,
            jobId: runRecord.jobId,
            lastProgressAt: runRecord.lastProgressAt,
            parentRunId: runRecord.parentRunId,
            resultJson: runRecord.resultJson,
            rootRunId: runRecord.rootRunId,
            sessionId: runRecord.sessionId,
            sourceCallId: runRecord.sourceCallId,
            staleRecoveryCount: runRecord.staleRecoveryCount,
            startedAt: runRecord.startedAt,
            status: runRecord.status,
            targetKind: runRecord.targetKind,
            task: runRecord.task,
            tenantId: runRecord.tenantId,
            threadId: runRecord.threadId,
            toolProfileId: runRecord.toolProfileId,
            turnCount: runRecord.turnCount,
            updatedAt: runRecord.updatedAt,
            version: runRecord.version,
            workspaceId: runRecord.workspaceId,
            workspaceRef: runRecord.workspaceRef,
          })
          .run()

        return ok(runRecord)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown run create failure'

        return err({
          message: `failed to create run ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    fail: (scope: TenantScope, input: FailRunInput): Result<RunRecord, DomainError> =>
      updateRunAndReload(scope, {
        catchMessage: `failed to fail run ${input.runId}`,
        conflictMessage: `run ${input.runId} could not transition to failed from ${input.expectedStatus}`,
        expectedStatus: input.expectedStatus,
        expectedVersion: input.expectedVersion,
        runId: input.runId,
        values: {
          completedAt: input.completedAt,
          errorJson: input.errorJson,
          lastProgressAt: input.lastProgressAt,
          resultJson: input.resultJson ?? null,
          status: 'failed',
          turnCount: input.turnCount + 1,
          updatedAt: input.updatedAt,
          version: input.expectedVersion + 1,
        },
      }),
    getById,
    listActiveByThreadId: (
      scope: TenantScope,
      threadId: SessionThreadId,
    ): Result<RunRecord[], DomainError> => {
      try {
        const runRows = db
          .select()
          .from(runs)
          .where(
            and(
              eq(runs.threadId, threadId),
              eq(runs.tenantId, scope.tenantId),
              inArray(runs.status, ['pending', 'running', 'cancelling', 'waiting']),
            ),
          )
          .orderBy(asc(runs.createdAt), asc(runs.id))
          .all()

        return ok(runRows.map(toRunRecord))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown active run list failure'

        return err({
          message: `failed to list active runs for thread ${threadId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    listByThreadId: (
      scope: TenantScope,
      threadId: SessionThreadId,
    ): Result<RunRecord[], DomainError> => {
      try {
        const runRows = db
          .select()
          .from(runs)
          .where(and(eq(runs.threadId, threadId), eq(runs.tenantId, scope.tenantId)))
          .orderBy(asc(runs.createdAt), asc(runs.id))
          .all()

        return ok(runRows.map(toRunRecord))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown thread run list failure'

        return err({
          message: `failed to list runs for thread ${threadId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    listByParentRunId: (
      scope: TenantScope,
      parentRunId: RunId,
    ): Result<RunRecord[], DomainError> => {
      try {
        const runRows = db
          .select()
          .from(runs)
          .where(and(eq(runs.parentRunId, parentRunId), eq(runs.tenantId, scope.tenantId)))
          .orderBy(asc(runs.createdAt), asc(runs.id))
          .all()

        return ok(runRows.map(toRunRecord))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown child run list failure'

        return err({
          message: `failed to list child runs for parent ${parentRunId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    markRunning: (scope: TenantScope, input: UpdateRunStartInput): Result<RunRecord, DomainError> =>
      updateRunAndReload(scope, {
        catchMessage: `failed to start run ${input.runId}`,
        conflictMessage: `run ${input.runId} could not transition to running from ${input.expectedStatus}`,
        expectedStatus: input.expectedStatus,
        expectedVersion: input.expectedVersion,
        runId: input.runId,
        values: {
          configSnapshot: input.configSnapshot,
          lastProgressAt: input.lastProgressAt,
          startedAt: input.startedAt,
          status: 'running',
          updatedAt: input.updatedAt,
          version: input.expectedVersion + 1,
        },
      }),
    markPending: (scope: TenantScope, input: RequeueRunInput): Result<RunRecord, DomainError> =>
      updateRunAndReload(scope, {
        catchMessage: `failed to requeue run ${input.runId}`,
        conflictMessage: `run ${input.runId} could not transition to pending from ${input.expectedStatus}`,
        expectedStatus: input.expectedStatus,
        expectedVersion: input.expectedVersion,
        runId: input.runId,
        values: {
          lastProgressAt: input.lastProgressAt,
          ...(input.resultJson !== undefined ? { resultJson: input.resultJson } : {}),
          ...(input.staleRecoveryCount !== undefined
            ? { staleRecoveryCount: input.staleRecoveryCount }
            : {}),
          status: 'pending',
          updatedAt: input.updatedAt,
          version: input.expectedVersion + 1,
        },
      }),
    markCancelling: (
      scope: TenantScope,
      input: MarkRunCancellingInput,
    ): Result<RunRecord, DomainError> =>
      updateRunAndReload(scope, {
        catchMessage: `failed to mark run ${input.runId} cancelling`,
        conflictMessage: `run ${input.runId} could not transition to cancelling from ${input.expectedStatus}`,
        expectedStatus: input.expectedStatus,
        expectedVersion: input.expectedVersion,
        runId: input.runId,
        values: {
          errorJson: null,
          lastProgressAt: input.lastProgressAt,
          resultJson: input.resultJson,
          status: 'cancelling',
          updatedAt: input.updatedAt,
          version: input.expectedVersion + 1,
        },
      }),
    updateConfigSnapshot: (
      scope: TenantScope,
      input: UpdateRunConfigSnapshotInput,
    ): Result<RunRecord, DomainError> =>
      updateRunAndReload(scope, {
        catchMessage: `failed to update config for run ${input.runId}`,
        conflictMessage: `run ${input.runId} could not refresh config while ${input.expectedStatus}`,
        expectedStatus: input.expectedStatus,
        expectedVersion: input.expectedVersion,
        runId: input.runId,
        values: {
          configSnapshot: input.configSnapshot,
          updatedAt: input.updatedAt,
          version: input.expectedVersion + 1,
        },
      }),
    markWaiting: (scope: TenantScope, input: WaitRunInput): Result<RunRecord, DomainError> =>
      updateRunAndReload(scope, {
        catchMessage: `failed to mark run ${input.runId} waiting`,
        conflictMessage: `run ${input.runId} could not transition to waiting from ${input.expectedStatus}`,
        expectedStatus: input.expectedStatus,
        expectedVersion: input.expectedVersion,
        runId: input.runId,
        values: {
          lastProgressAt: input.lastProgressAt,
          resultJson: input.resultJson,
          status: 'waiting',
          updatedAt: input.updatedAt,
          version: input.expectedVersion + 1,
        },
      }),
    refreshWaiting: (
      scope: TenantScope,
      input: RefreshWaitingRunInput,
    ): Result<RunRecord, DomainError> =>
      updateRunAndReload(scope, {
        catchMessage: `failed to refresh waiting run ${input.runId}`,
        conflictMessage: `run ${input.runId} could not refresh while waiting`,
        expectedStatus: input.expectedStatus,
        expectedVersion: input.expectedVersion,
        runId: input.runId,
        values: {
          lastProgressAt: input.lastProgressAt,
          resultJson: input.resultJson,
          updatedAt: input.updatedAt,
          version: input.expectedVersion + 1,
        },
      }),
    toRecord: toRunRecord,
  }
}
