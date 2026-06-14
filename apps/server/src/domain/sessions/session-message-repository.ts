import { and, asc, eq, gt, sql } from 'drizzle-orm'

import { sessionMessages } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  type AccountId,
  asAccountId,
  asRunId,
  asSessionMessageId,
  asSessionThreadId,
  asTenantId,
  asWorkSessionId,
  type RunId,
  type SessionMessageId,
  type SessionThreadId,
  type TenantId,
  type WorkSessionId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'

export type SessionMessageContentPart = { text: string; type: 'text' }

export interface SessionMessageRecord {
  authorAccountId: AccountId | null
  authorKind: 'user' | 'assistant' | 'system' | 'tool'
  content: SessionMessageContentPart[]
  createdAt: string
  id: SessionMessageId
  metadata: unknown | null
  runId: RunId | null
  sequence: number
  sessionId: WorkSessionId
  tenantId: TenantId
  threadId: SessionThreadId
}

export interface CreateSessionMessageInput {
  authorAccountId: AccountId | null
  authorKind?: SessionMessageRecord['authorKind']
  content: SessionMessageContentPart[]
  createdAt: string
  id: SessionMessageId
  metadata?: unknown | null
  runId: RunId | null
  sequence: number
  sessionId: WorkSessionId
  threadId: SessionThreadId
}

export interface ListThreadMessagesInput {
  afterSequence?: number
  limit?: number
}

export interface UpdateSessionMessageInput {
  content?: SessionMessageContentPart[]
  messageId: SessionMessageId
  metadata?: unknown | null
  runId?: RunId | null
  sessionId: WorkSessionId
  threadId: SessionThreadId
}

const toSessionMessageRecord = (
  messageRow: typeof sessionMessages.$inferSelect,
): SessionMessageRecord => ({
  authorAccountId: messageRow.authorAccountId ? asAccountId(messageRow.authorAccountId) : null,
  authorKind: messageRow.authorKind,
  content: messageRow.content as SessionMessageContentPart[],
  createdAt: messageRow.createdAt,
  id: asSessionMessageId(messageRow.id),
  metadata: messageRow.metadata,
  runId: messageRow.runId ? asRunId(messageRow.runId) : null,
  sequence: messageRow.sequence,
  sessionId: asWorkSessionId(messageRow.sessionId),
  tenantId: asTenantId(messageRow.tenantId),
  threadId: asSessionThreadId(messageRow.threadId),
})

export const createSessionMessageRepository = (db: RepositoryDatabase) => ({
  assignRun: (
    scope: TenantScope,
    input: {
      messageId: SessionMessageId
      runId: RunId
      sessionId: WorkSessionId
      threadId: SessionThreadId
    },
  ): Result<SessionMessageRecord, DomainError> => {
    try {
      const result = db
        .update(sessionMessages)
        .set({
          runId: input.runId,
        })
        .where(
          and(
            eq(sessionMessages.id, input.messageId),
            eq(sessionMessages.sessionId, input.sessionId),
            eq(sessionMessages.threadId, input.threadId),
            eq(sessionMessages.tenantId, scope.tenantId),
          ),
        )
        .run()

      if (result.changes === 0) {
        return err({
          message: `message ${input.messageId} could not be assigned to run ${input.runId}`,
          type: 'conflict',
        })
      }

      return getById(db, scope, input.messageId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown message run binding failure'

      return err({
        message: `failed to bind message ${input.messageId} to run ${input.runId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  createAssistantMessage: (
    scope: TenantScope,
    input: Omit<CreateSessionMessageInput, 'authorAccountId' | 'authorKind'>,
  ): Result<SessionMessageRecord, DomainError> =>
    createMessage(db, scope, {
      ...input,
      authorAccountId: null,
      authorKind: 'assistant',
    }),
  create: (
    scope: TenantScope,
    input: CreateSessionMessageInput,
  ): Result<SessionMessageRecord, DomainError> => createMessage(db, scope, input),
  getNextSequence: (scope: TenantScope, threadId: SessionThreadId): Result<number, DomainError> => {
    try {
      const currentSequence = db
        .select({
          sequence: sql<number>`coalesce(max(${sessionMessages.sequence}), 0)`,
        })
        .from(sessionMessages)
        .where(
          and(eq(sessionMessages.threadId, threadId), eq(sessionMessages.tenantId, scope.tenantId)),
        )
        .get()

      return ok((currentSequence?.sequence ?? 0) + 1)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown message sequence lookup failure'

      return err({
        message: `failed to read message sequence for thread ${threadId} in tenant ${scope.tenantId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  getById: (
    scope: TenantScope,
    messageId: SessionMessageId,
  ): Result<SessionMessageRecord, DomainError> => getById(db, scope, messageId),
  listAfterSequence: (
    scope: TenantScope,
    threadId: SessionThreadId,
    sequence: number,
  ): Result<SessionMessageRecord[], DomainError> =>
    listByThread(db, scope, threadId, {
      afterSequence: sequence,
    }),
  listByThreadId: (
    scope: TenantScope,
    threadId: SessionThreadId,
  ): Result<SessionMessageRecord[], DomainError> => listByThread(db, scope, threadId, {}),
  listWindowByThreadId: (
    scope: TenantScope,
    threadId: SessionThreadId,
    options: ListThreadMessagesInput,
  ): Result<SessionMessageRecord[], DomainError> => listByThread(db, scope, threadId, options),
  update: (
    scope: TenantScope,
    input: UpdateSessionMessageInput,
  ): Result<SessionMessageRecord, DomainError> => {
    try {
      const patch: Partial<typeof sessionMessages.$inferInsert> = {}

      if (input.content !== undefined) {
        patch.content = input.content
      }

      if (input.metadata !== undefined) {
        patch.metadata = input.metadata
      }

      if (input.runId !== undefined) {
        patch.runId = input.runId
      }

      const result = db
        .update(sessionMessages)
        .set(patch)
        .where(
          and(
            eq(sessionMessages.id, input.messageId),
            eq(sessionMessages.sessionId, input.sessionId),
            eq(sessionMessages.threadId, input.threadId),
            eq(sessionMessages.tenantId, scope.tenantId),
          ),
        )
        .run()

      if (result.changes === 0) {
        return err({
          message: `message ${input.messageId} could not be updated`,
          type: 'conflict',
        })
      }

      return getById(db, scope, input.messageId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown message update failure'

      return err({
        message: `failed to update message ${input.messageId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  toRecord: toSessionMessageRecord,
})

const createMessage = (
  db: RepositoryDatabase,
  scope: TenantScope,
  input: CreateSessionMessageInput,
): Result<SessionMessageRecord, DomainError> => {
  try {
    const messageRecord: SessionMessageRecord = {
      authorAccountId: input.authorAccountId,
      authorKind: input.authorKind ?? 'user',
      content: input.content,
      createdAt: input.createdAt,
      id: input.id,
      metadata: input.metadata ?? null,
      runId: input.runId,
      sequence: input.sequence,
      sessionId: input.sessionId,
      tenantId: scope.tenantId,
      threadId: input.threadId,
    }

    db.insert(sessionMessages)
      .values({
        ...messageRecord,
      })
      .run()

    return ok(messageRecord)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown message create failure'

    return err({
      message: `failed to create session message ${input.id}: ${message}`,
      type: 'conflict',
    })
  }
}

const getById = (
  db: RepositoryDatabase,
  scope: TenantScope,
  messageId: SessionMessageId,
): Result<SessionMessageRecord, DomainError> => {
  const messageRow = db
    .select()
    .from(sessionMessages)
    .where(and(eq(sessionMessages.id, messageId), eq(sessionMessages.tenantId, scope.tenantId)))
    .get()

  if (!messageRow) {
    return err({
      message: `message ${messageId} not found in tenant ${scope.tenantId}`,
      type: 'not_found',
    })
  }

  return ok(toSessionMessageRecord(messageRow))
}

const listByThread = (
  db: RepositoryDatabase,
  scope: TenantScope,
  threadId: SessionThreadId,
  options: ListThreadMessagesInput,
): Result<SessionMessageRecord[], DomainError> => {
  try {
    const query = db
      .select()
      .from(sessionMessages)
      .where(
        and(
          eq(sessionMessages.threadId, threadId),
          eq(sessionMessages.tenantId, scope.tenantId),
          options.afterSequence === undefined
            ? undefined
            : gt(sessionMessages.sequence, options.afterSequence),
        ),
      )
      .orderBy(asc(sessionMessages.sequence))

    const rows = options.limit === undefined ? query.all() : query.limit(options.limit).all()

    return ok(rows.map(toSessionMessageRecord))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown thread message read failure'

    return err({
      message: `failed to read messages for thread ${threadId}: ${message}`,
      type: 'conflict',
    })
  }
}
