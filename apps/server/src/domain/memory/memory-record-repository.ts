import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import { contextSummaries, memoryRecordSources, memoryRecords } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  asRunId,
  asSessionThreadId,
  asTenantId,
  asWorkSessionId,
  type RunId,
  type SessionThreadId,
  type TenantId,
  type WorkSessionId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

export interface ObservationMemoryContent {
  observations: Array<{
    text: string
  }>
  source: 'observer_v1'
}

export interface ReflectionMemoryContent {
  reflection: string
  source: 'reflector_v1'
}

export interface MemoryRecordRecord {
  content: ObservationMemoryContent | ReflectionMemoryContent | Record<string, unknown>
  createdAt: string
  generation: number
  id: string
  kind: 'observation' | 'reflection'
  ownerRunId: RunId | null
  parentRecordId: string | null
  rootRunId: RunId | null
  scopeKind: 'run_local' | 'thread_shared' | 'session_shared' | 'agent_profile'
  scopeRef: string
  sessionId: WorkSessionId | null
  status: 'active' | 'superseded'
  tenantId: TenantId
  threadId: SessionThreadId | null
  tokenCount: number | null
  visibility: 'private' | 'promoted'
}

export interface CreateObservationRecordInput {
  content: ObservationMemoryContent
  createdAt: string
  fromSequence: number
  id: string
  ownerRunId: RunId
  rootRunId: RunId
  sessionId: WorkSessionId
  scopeKind: MemoryRecordRecord['scopeKind']
  scopeRef: string
  sourceRunId: RunId
  sourceSummaryId: string
  sourceId: string
  threadId: SessionThreadId
  throughSequence: number
  tokenCount?: number | null
}

export interface CreateReflectionRecordInput {
  content: ReflectionMemoryContent
  createdAt: string
  id: string
  ownerRunId: RunId
  previousReflectionId?: string | null
  previousReflectionGeneration?: number | null
  rootRunId: RunId
  scopeKind: MemoryRecordRecord['scopeKind']
  scopeRef: string
  sessionId: WorkSessionId
  sourceIds: string[]
  sourceRecordIds: string[]
  sourceRunId: RunId
  threadId: SessionThreadId
  tokenCount?: number | null
}

const toMemoryRecord = (row: typeof memoryRecords.$inferSelect): MemoryRecordRecord => ({
  content: row.content as
    | ObservationMemoryContent
    | ReflectionMemoryContent
    | Record<string, unknown>,
  createdAt: row.createdAt,
  generation: row.generation,
  id: row.id,
  kind: row.kind,
  ownerRunId: row.ownerRunId ? asRunId(row.ownerRunId) : null,
  parentRecordId: row.parentRecordId,
  rootRunId: row.rootRunId ? asRunId(row.rootRunId) : null,
  scopeKind: row.scopeKind,
  scopeRef: row.scopeRef,
  sessionId: row.sessionId ? asWorkSessionId(row.sessionId) : null,
  status: row.status,
  tenantId: asTenantId(row.tenantId),
  threadId: row.threadId ? asSessionThreadId(row.threadId) : null,
  tokenCount: row.tokenCount,
  visibility: row.visibility,
})

export const createMemoryRecordRepository = (db: RepositoryDatabase) => ({
  createObservationForSummary: (
    scope: TenantScope,
    input: CreateObservationRecordInput,
  ): Result<MemoryRecordRecord, DomainError> => {
    try {
      const record: MemoryRecordRecord = {
        content: input.content,
        createdAt: input.createdAt,
        generation: 1,
        id: input.id,
        kind: 'observation',
        ownerRunId: input.ownerRunId,
        parentRecordId: null,
        rootRunId: input.rootRunId,
        scopeKind: input.scopeKind,
        scopeRef: input.scopeRef,
        sessionId: input.sessionId,
        status: 'active',
        tenantId: scope.tenantId,
        threadId: input.threadId,
        tokenCount: input.tokenCount ?? null,
        visibility: 'private',
      }

      db.insert(memoryRecords)
        .values({
          ...record,
        })
        .run()

      db.insert(memoryRecordSources)
        .values({
          createdAt: input.createdAt,
          fromSequence: input.fromSequence,
          id: input.sourceId,
          recordId: input.id,
          sourceRecordId: null,
          sourceRunId: input.sourceRunId,
          sourceSummaryId: input.sourceSummaryId,
          tenantId: scope.tenantId,
          throughSequence: input.throughSequence,
        })
        .run()

      return ok(record)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown memory observation create failure'

      return err({
        message: `failed to create observation memory ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  hasObservationForSummary: (
    scope: TenantScope,
    summaryId: string,
  ): Result<boolean, DomainError> => {
    try {
      const row = db
        .select({
          count: sql<number>`count(*)`,
        })
        .from(memoryRecordSources)
        .innerJoin(
          memoryRecords,
          and(
            eq(memoryRecordSources.recordId, memoryRecords.id),
            eq(memoryRecordSources.tenantId, memoryRecords.tenantId),
          ),
        )
        .where(
          and(
            eq(memoryRecordSources.sourceSummaryId, summaryId),
            eq(memoryRecordSources.tenantId, scope.tenantId),
            eq(memoryRecords.kind, 'observation'),
          ),
        )
        .get()

      return ok((row?.count ?? 0) > 0)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown summary observation lookup failure'

      return err({
        message: `failed to check observation memory for summary ${summaryId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listActiveObservationsByScope: (
    scope: TenantScope,
    input: Pick<MemoryRecordRecord, 'scopeKind' | 'scopeRef'>,
  ): Result<MemoryRecordRecord[], DomainError> => {
    try {
      const rows = db
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.tenantId, scope.tenantId),
            eq(memoryRecords.kind, 'observation'),
            eq(memoryRecords.status, 'active'),
            eq(memoryRecords.scopeKind, input.scopeKind),
            eq(memoryRecords.scopeRef, input.scopeRef),
          ),
        )
        .orderBy(asc(memoryRecords.createdAt), asc(memoryRecords.id))
        .all()

      return ok(rows.map(toMemoryRecord))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown observation memory list failure'

      return err({
        message: `failed to list observation memory for scope ${input.scopeKind}:${input.scopeRef}: ${message}`,
        type: 'conflict',
      })
    }
  },
  getActiveObservationSourceTokenCountByScope: (
    scope: TenantScope,
    input: Pick<MemoryRecordRecord, 'scopeKind' | 'scopeRef'>,
  ): Result<number, DomainError> => {
    try {
      const rows = db
        .select({
          sourceSummaryId: memoryRecordSources.sourceSummaryId,
          tokensBefore: contextSummaries.tokensBefore,
        })
        .from(memoryRecords)
        .innerJoin(
          memoryRecordSources,
          and(
            eq(memoryRecordSources.recordId, memoryRecords.id),
            eq(memoryRecordSources.tenantId, memoryRecords.tenantId),
          ),
        )
        .innerJoin(
          contextSummaries,
          and(
            eq(contextSummaries.id, memoryRecordSources.sourceSummaryId),
            eq(contextSummaries.tenantId, memoryRecordSources.tenantId),
          ),
        )
        .where(
          and(
            eq(memoryRecords.tenantId, scope.tenantId),
            eq(memoryRecords.kind, 'observation'),
            eq(memoryRecords.status, 'active'),
            eq(memoryRecords.scopeKind, input.scopeKind),
            eq(memoryRecords.scopeRef, input.scopeRef),
          ),
        )
        .all()

      const seenSummaryIds = new Set<string>()
      let total = 0

      for (const row of rows) {
        if (!row.sourceSummaryId || seenSummaryIds.has(row.sourceSummaryId)) {
          continue
        }

        seenSummaryIds.add(row.sourceSummaryId)
        total += row.tokensBefore ?? 0
      }

      return ok(total)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown observation source token lookup failure'

      return err({
        message: `failed to read observation source tokens for scope ${input.scopeKind}:${input.scopeRef}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listActiveByThread: (
    scope: TenantScope,
    threadId: SessionThreadId,
  ): Result<MemoryRecordRecord[], DomainError> => {
    try {
      const rows = db
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.tenantId, scope.tenantId),
            eq(memoryRecords.threadId, threadId),
            eq(memoryRecords.status, 'active'),
          ),
        )
        .orderBy(asc(memoryRecords.createdAt), asc(memoryRecords.id))
        .all()

      return ok(rows.map(toMemoryRecord))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown memory list failure'

      return err({
        message: `failed to list memory for thread ${threadId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  getLatestActiveReflectionByThread: (
    scope: TenantScope,
    threadId: SessionThreadId,
  ): Result<MemoryRecordRecord | null, DomainError> => {
    try {
      const row = db
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.tenantId, scope.tenantId),
            eq(memoryRecords.threadId, threadId),
            eq(memoryRecords.kind, 'reflection'),
            eq(memoryRecords.status, 'active'),
          ),
        )
        .orderBy(desc(memoryRecords.generation), desc(memoryRecords.createdAt))
        .get()

      return ok(row ? toMemoryRecord(row) : null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown reflection memory lookup failure'

      return err({
        message: `failed to read active reflection for thread ${threadId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  getLatestActiveReflectionByScope: (
    scope: TenantScope,
    input: Pick<MemoryRecordRecord, 'scopeKind' | 'scopeRef'>,
  ): Result<MemoryRecordRecord | null, DomainError> => {
    try {
      const row = db
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.tenantId, scope.tenantId),
            eq(memoryRecords.kind, 'reflection'),
            eq(memoryRecords.status, 'active'),
            eq(memoryRecords.scopeKind, input.scopeKind),
            eq(memoryRecords.scopeRef, input.scopeRef),
          ),
        )
        .orderBy(desc(memoryRecords.generation), desc(memoryRecords.createdAt))
        .get()

      return ok(row ? toMemoryRecord(row) : null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown reflection memory lookup failure'

      return err({
        message: `failed to read active reflection memory for scope ${input.scopeKind}:${input.scopeRef}: ${message}`,
        type: 'conflict',
      })
    }
  },
  updateContent: (
    scope: TenantScope,
    recordId: string,
    input: Pick<MemoryRecordRecord, 'content' | 'tokenCount'>,
  ): Result<MemoryRecordRecord, DomainError> => {
    try {
      db.update(memoryRecords)
        .set({
          content: input.content,
          tokenCount: input.tokenCount ?? null,
        })
        .where(
          and(
            eq(memoryRecords.id, recordId),
            eq(memoryRecords.tenantId, scope.tenantId),
            eq(memoryRecords.status, 'active'),
          ),
        )
        .run()

      const row = db
        .select()
        .from(memoryRecords)
        .where(and(eq(memoryRecords.id, recordId), eq(memoryRecords.tenantId, scope.tenantId)))
        .get()

      if (!row) {
        return err({
          message: `memory record ${recordId} was not found`,
          type: 'not_found',
        })
      }

      return ok(toMemoryRecord(row))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown memory update failure'

      return err({
        message: `failed to update memory record ${recordId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  createReflection: (
    scope: TenantScope,
    input: CreateReflectionRecordInput,
  ): Result<MemoryRecordRecord, DomainError> => {
    if (input.sourceRecordIds.length !== input.sourceIds.length) {
      return err({
        message: 'reflection source ids must align with source record ids',
        type: 'validation',
      })
    }

    try {
      const generation = (input.previousReflectionGeneration ?? 0) + 1
      const record: MemoryRecordRecord = {
        content: input.content,
        createdAt: input.createdAt,
        generation,
        id: input.id,
        kind: 'reflection',
        ownerRunId: input.ownerRunId,
        parentRecordId: input.previousReflectionId ?? null,
        rootRunId: input.rootRunId,
        scopeKind: input.scopeKind,
        scopeRef: input.scopeRef,
        sessionId: input.sessionId,
        status: 'active',
        tenantId: scope.tenantId,
        threadId: input.threadId,
        tokenCount: input.tokenCount ?? null,
        visibility: 'private',
      }

      db.insert(memoryRecords)
        .values({
          ...record,
        })
        .run()

      for (let index = 0; index < input.sourceRecordIds.length; index += 1) {
        db.insert(memoryRecordSources)
          .values({
            createdAt: input.createdAt,
            fromSequence: 0,
            id: input.sourceIds[index]!,
            recordId: input.id,
            sourceRecordId: input.sourceRecordIds[index]!,
            sourceRunId: input.sourceRunId,
            sourceSummaryId: null,
            tenantId: scope.tenantId,
            throughSequence: 0,
          })
          .run()
      }

      return ok(record)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown reflection memory create failure'

      return err({
        message: `failed to create reflection memory ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  supersedeRecords: (scope: TenantScope, recordIds: string[]): Result<null, DomainError> => {
    if (recordIds.length === 0) {
      return ok(null)
    }

    try {
      db.update(memoryRecords)
        .set({
          status: 'superseded',
        })
        .where(
          and(
            inArray(memoryRecords.id, recordIds),
            eq(memoryRecords.tenantId, scope.tenantId),
            eq(memoryRecords.status, 'active'),
          ),
        )
        .run()

      return ok(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown memory supersede failure'

      return err({
        message: `failed to supersede memory records: ${message}`,
        type: 'conflict',
      })
    }
  },
})
