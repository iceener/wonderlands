import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import { items, runs } from '../../../../db/schema'
import type {
  CreateFunctionCallItemInput,
  CreateFunctionCallOutputItemInput,
  CreateItemInput,
  CreateReasoningItemInput,
  ItemContentPart,
  ItemRecord,
  ItemRepository,
} from '../../../../domain/runtime/item-repository'
import type { DomainError } from '../../../../shared/errors'
import {
  asItemId,
  asRunId,
  asTenantId,
  type RunId,
  type SessionThreadId,
} from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import type { RepositoryDatabase } from '../repository-database'

const toItemRecord = (itemRow: typeof items.$inferSelect): ItemRecord => ({
  arguments: itemRow.arguments,
  callId: itemRow.callId,
  content: itemRow.content as ItemContentPart[] | null,
  createdAt: itemRow.createdAt,
  id: asItemId(itemRow.id),
  name: itemRow.name,
  output: itemRow.output,
  providerPayload: itemRow.providerPayload,
  role: itemRow.role,
  runId: asRunId(itemRow.runId),
  sequence: itemRow.sequence,
  summary: itemRow.summary,
  tenantId: asTenantId(itemRow.tenantId),
  type: itemRow.type,
})

const createMessage = (
  db: RepositoryDatabase,
  scope: TenantScope,
  input: CreateItemInput,
): Result<ItemRecord, DomainError> => {
  try {
    const itemRecord: ItemRecord = {
      arguments: null,
      callId: null,
      content: input.content,
      createdAt: input.createdAt,
      id: input.id,
      name: null,
      output: null,
      providerPayload: input.providerPayload ?? null,
      role: input.role,
      runId: input.runId,
      sequence: input.sequence,
      summary: null,
      tenantId: scope.tenantId,
      type: 'message',
    }

    db.insert(items)
      .values({
        ...itemRecord,
      })
      .run()

    return ok(itemRecord)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown item create failure'

    return err({
      message: `failed to append item ${input.id}: ${message}`,
      type: 'conflict',
    })
  }
}

export const createItemRepository = (db: RepositoryDatabase): ItemRepository => ({
  createFunctionCall: (
    scope: TenantScope,
    input: CreateFunctionCallItemInput,
  ): Result<ItemRecord, DomainError> => {
    try {
      const itemRecord: ItemRecord = {
        arguments: input.argumentsJson,
        callId: input.callId,
        content: null,
        createdAt: input.createdAt,
        id: input.id,
        name: input.name,
        output: null,
        providerPayload: input.providerPayload ?? null,
        role: null,
        runId: input.runId,
        sequence: input.sequence,
        summary: null,
        tenantId: scope.tenantId,
        type: 'function_call',
      }

      db.insert(items)
        .values({
          ...itemRecord,
        })
        .run()

      return ok(itemRecord)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown function call item create failure'

      return err({
        message: `failed to append function call item ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  createFunctionCallOutput: (
    scope: TenantScope,
    input: CreateFunctionCallOutputItemInput,
  ): Result<ItemRecord, DomainError> => {
    try {
      const itemRecord: ItemRecord = {
        arguments: null,
        callId: input.callId,
        content: null,
        createdAt: input.createdAt,
        id: input.id,
        name: null,
        output: input.output,
        providerPayload: input.providerPayload ?? null,
        role: null,
        runId: input.runId,
        sequence: input.sequence,
        summary: null,
        tenantId: scope.tenantId,
        type: 'function_call_output',
      }

      db.insert(items)
        .values({
          ...itemRecord,
        })
        .run()

      return ok(itemRecord)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown function call output item create failure'

      return err({
        message: `failed to append function call output item ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  createMessage: (scope: TenantScope, input: CreateItemInput): Result<ItemRecord, DomainError> =>
    createMessage(db, scope, input),
  createReasoning: (
    scope: TenantScope,
    input: CreateReasoningItemInput,
  ): Result<ItemRecord, DomainError> => {
    try {
      const itemRecord: ItemRecord = {
        arguments: null,
        callId: null,
        content: null,
        createdAt: input.createdAt,
        id: input.id,
        name: null,
        output: null,
        providerPayload: input.providerPayload ?? null,
        role: null,
        runId: input.runId,
        sequence: input.sequence,
        summary: input.summary,
        tenantId: scope.tenantId,
        type: 'reasoning',
      }

      db.insert(items)
        .values({
          ...itemRecord,
        })
        .run()

      return ok(itemRecord)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown reasoning item create failure'

      return err({
        message: `failed to append reasoning item ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  createAssistantMessage: (
    scope: TenantScope,
    input: Omit<CreateItemInput, 'role'>,
  ): Result<ItemRecord, DomainError> =>
    createMessage(db, scope, {
      ...input,
      role: 'assistant',
    }),
  createUserMessage: (
    scope: TenantScope,
    input: Omit<CreateItemInput, 'role'>,
  ): Result<ItemRecord, DomainError> =>
    createMessage(db, scope, {
      ...input,
      role: 'user',
    }),
  getNextSequence: (scope: TenantScope, runId: RunId): Result<number, DomainError> => {
    try {
      const currentSequence = db
        .select({
          sequence: sql<number>`coalesce(max(${items.sequence}), 0)`,
        })
        .from(items)
        .where(and(eq(items.runId, runId), eq(items.tenantId, scope.tenantId)))
        .get()

      return ok((currentSequence?.sequence ?? 0) + 1)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown item sequence lookup failure'

      return err({
        message: `failed to read item sequence for run ${runId} in tenant ${scope.tenantId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listByRunId: (scope: TenantScope, runId: RunId): Result<ItemRecord[], DomainError> => {
    try {
      const itemRows = db
        .select()
        .from(items)
        .where(and(eq(items.runId, runId), eq(items.tenantId, scope.tenantId)))
        .orderBy(asc(items.sequence))
        .all()

      return ok(itemRows.map(toItemRecord))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown run item read failure'

      return err({
        message: `failed to read items for run ${runId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listByRunIds: (scope: TenantScope, runIds: RunId[]): Result<ItemRecord[], DomainError> => {
    if (runIds.length === 0) {
      return ok([])
    }

    try {
      const itemRows = db
        .select()
        .from(items)
        .where(and(inArray(items.runId, runIds), eq(items.tenantId, scope.tenantId)))
        .orderBy(asc(items.runId), asc(items.sequence))
        .all()

      return ok(itemRows.map(toItemRecord))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown run item list failure'

      return err({
        message: `failed to read items for runs ${runIds.join(', ')}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listByThreadId: (
    scope: TenantScope,
    threadId: SessionThreadId,
  ): Result<ItemRecord[], DomainError> => {
    try {
      const rows = db
        .select({
          item: items,
        })
        .from(items)
        .innerJoin(runs, and(eq(items.runId, runs.id), eq(items.tenantId, runs.tenantId)))
        .where(and(eq(runs.threadId, threadId), eq(items.tenantId, scope.tenantId)))
        .orderBy(asc(runs.createdAt), asc(items.sequence))
        .all()

      return ok(rows.map((row) => toItemRecord(row.item)))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown thread item read failure'

      return err({
        message: `failed to read items for thread ${threadId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
