import { and, asc, eq, isNull } from 'drizzle-orm'

import { toolExecutions } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import { asRunId, asTenantId, type RunId, type TenantId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'
import type { ToolDomain } from '../tooling/tool-registry'

export interface ToolExecutionRecord {
  argsJson: unknown | null
  completedAt: string | null
  createdAt: string
  domain: ToolDomain
  durationMs: number | null
  errorText: string | null
  id: string
  outcomeJson: unknown | null
  runId: RunId
  startedAt: string | null
  tenantId: TenantId
  tool: string
}

export interface CreateToolExecutionInput {
  argsJson: unknown | null
  createdAt: string
  domain: ToolDomain
  id: string
  runId: RunId
  startedAt: string
  tool: string
}

export interface CompleteToolExecutionInput {
  completedAt: string
  durationMs: number | null
  id: string
  outcomeJson: unknown
}

export interface FailToolExecutionInput {
  completedAt: string
  durationMs: number | null
  errorText: string
  id: string
  outcomeJson?: unknown | null
}

const toToolExecutionRecord = (row: typeof toolExecutions.$inferSelect): ToolExecutionRecord => ({
  argsJson: row.argsJson,
  completedAt: row.completedAt,
  createdAt: row.createdAt,
  domain: row.domain,
  durationMs: row.durationMs,
  errorText: row.errorText,
  id: row.id,
  outcomeJson: row.outcomeJson,
  runId: asRunId(row.runId),
  startedAt: row.startedAt,
  tenantId: asTenantId(row.tenantId),
  tool: row.tool,
})

export const createToolExecutionRepository = (db: RepositoryDatabase) => {
  const getById = (scope: TenantScope, id: string): Result<ToolExecutionRecord, DomainError> => {
    const row = db
      .select()
      .from(toolExecutions)
      .where(and(eq(toolExecutions.id, id), eq(toolExecutions.tenantId, scope.tenantId)))
      .get()

    if (!row) {
      return err({
        message: `tool execution ${id} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toToolExecutionRecord(row))
  }

  return {
    complete: (
      scope: TenantScope,
      input: CompleteToolExecutionInput,
    ): Result<ToolExecutionRecord, DomainError> => {
      try {
        const result = db
          .update(toolExecutions)
          .set({
            completedAt: input.completedAt,
            durationMs: input.durationMs,
            errorText: null,
            outcomeJson: input.outcomeJson,
          })
          .where(
            and(
              eq(toolExecutions.id, input.id),
              eq(toolExecutions.tenantId, scope.tenantId),
              isNull(toolExecutions.completedAt),
            ),
          )
          .run()

        if (result.changes === 0) {
          return err({
            message: `tool execution ${input.id} could not be completed`,
            type: 'conflict',
          })
        }

        return getById(scope, input.id)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown tool execution completion failure'

        return err({
          message: `failed to complete tool execution ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    create: (
      scope: TenantScope,
      input: CreateToolExecutionInput,
    ): Result<ToolExecutionRecord, DomainError> => {
      try {
        const record: ToolExecutionRecord = {
          argsJson: input.argsJson,
          completedAt: null,
          createdAt: input.createdAt,
          domain: input.domain,
          durationMs: null,
          errorText: null,
          id: input.id,
          outcomeJson: null,
          runId: input.runId,
          startedAt: input.startedAt,
          tenantId: scope.tenantId,
          tool: input.tool,
        }

        db.insert(toolExecutions)
          .values({
            ...record,
          })
          .run()

        return ok(record)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown tool execution create failure'

        return err({
          message: `failed to create tool execution ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    fail: (
      scope: TenantScope,
      input: FailToolExecutionInput,
    ): Result<ToolExecutionRecord, DomainError> => {
      try {
        const result = db
          .update(toolExecutions)
          .set({
            completedAt: input.completedAt,
            durationMs: input.durationMs,
            errorText: input.errorText,
            outcomeJson: input.outcomeJson ?? null,
          })
          .where(
            and(
              eq(toolExecutions.id, input.id),
              eq(toolExecutions.tenantId, scope.tenantId),
              isNull(toolExecutions.completedAt),
            ),
          )
          .run()

        if (result.changes === 0) {
          return err({
            message: `tool execution ${input.id} could not be marked failed`,
            type: 'conflict',
          })
        }

        return getById(scope, input.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown tool execution failure'

        return err({
          message: `failed to fail tool execution ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getById,
    listByRunId: (scope: TenantScope, runId: RunId): Result<ToolExecutionRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(toolExecutions)
          .where(and(eq(toolExecutions.runId, runId), eq(toolExecutions.tenantId, scope.tenantId)))
          .orderBy(asc(toolExecutions.createdAt), asc(toolExecutions.id))
          .all()

        return ok(rows.map(toToolExecutionRecord))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown tool execution list failure'

        return err({
          message: `failed to list tool executions for run ${runId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    listIncompleteByRunId: (
      scope: TenantScope,
      runId: RunId,
    ): Result<ToolExecutionRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(toolExecutions)
          .where(
            and(
              eq(toolExecutions.runId, runId),
              eq(toolExecutions.tenantId, scope.tenantId),
              isNull(toolExecutions.completedAt),
            ),
          )
          .orderBy(asc(toolExecutions.createdAt), asc(toolExecutions.id))
          .all()

        return ok(rows.map(toToolExecutionRecord))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown incomplete tool execution list failure'

        return err({
          message: `failed to list incomplete tool executions for run ${runId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    toRecord: toToolExecutionRecord,
  }
}
