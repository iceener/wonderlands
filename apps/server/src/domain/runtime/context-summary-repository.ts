import { and, asc, desc, eq } from 'drizzle-orm'

import { contextSummaries } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import { asRunId, asTenantId, type RunId, type TenantId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

export interface ContextSummaryRecord {
  content: string
  createdAt: string
  fromSequence: number
  id: string
  modelKey: string
  previousSummaryId: string | null
  runId: RunId
  tenantId: TenantId
  throughSequence: number
  tokensAfter: number | null
  tokensBefore: number | null
  turnNumber: number | null
}

export interface CreateContextSummaryInput {
  content: string
  createdAt: string
  fromSequence: number
  id: string
  modelKey: string
  previousSummaryId?: string | null
  runId: RunId
  throughSequence: number
  tokensAfter?: number | null
  tokensBefore?: number | null
  turnNumber?: number | null
}

const toRecord = (row: typeof contextSummaries.$inferSelect): ContextSummaryRecord => ({
  content: row.content,
  createdAt: row.createdAt,
  fromSequence: row.fromSequence,
  id: row.id,
  modelKey: row.modelKey,
  previousSummaryId: row.previousSummaryId,
  runId: asRunId(row.runId),
  tenantId: asTenantId(row.tenantId),
  throughSequence: row.throughSequence,
  tokensAfter: row.tokensAfter,
  tokensBefore: row.tokensBefore,
  turnNumber: row.turnNumber,
})

export const createContextSummaryRepository = (db: RepositoryDatabase) => ({
  create: (
    scope: TenantScope,
    input: CreateContextSummaryInput,
  ): Result<ContextSummaryRecord, DomainError> => {
    try {
      const record: ContextSummaryRecord = {
        content: input.content,
        createdAt: input.createdAt,
        fromSequence: input.fromSequence,
        id: input.id,
        modelKey: input.modelKey,
        previousSummaryId: input.previousSummaryId ?? null,
        runId: input.runId,
        tenantId: scope.tenantId,
        throughSequence: input.throughSequence,
        tokensAfter: input.tokensAfter ?? null,
        tokensBefore: input.tokensBefore ?? null,
        turnNumber: input.turnNumber ?? null,
      }

      db.insert(contextSummaries)
        .values({
          ...record,
        })
        .run()

      return ok(record)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown context summary create failure'

      return err({
        message: `failed to create context summary ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  getLatestByRunId: (
    scope: TenantScope,
    runId: RunId,
  ): Result<ContextSummaryRecord | null, DomainError> => {
    try {
      const row = db
        .select()
        .from(contextSummaries)
        .where(
          and(eq(contextSummaries.runId, runId), eq(contextSummaries.tenantId, scope.tenantId)),
        )
        .orderBy(desc(contextSummaries.throughSequence), desc(contextSummaries.createdAt))
        .get()

      return ok(row ? toRecord(row) : null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown context summary lookup failure'

      return err({
        message: `failed to read latest context summary for run ${runId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listByRunId: (scope: TenantScope, runId: RunId): Result<ContextSummaryRecord[], DomainError> => {
    try {
      const rows = db
        .select()
        .from(contextSummaries)
        .where(
          and(eq(contextSummaries.runId, runId), eq(contextSummaries.tenantId, scope.tenantId)),
        )
        .orderBy(asc(contextSummaries.fromSequence), asc(contextSummaries.createdAt))
        .all()

      return ok(rows.map(toRecord))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown context summary list failure'

      return err({
        message: `failed to list context summaries for run ${runId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
