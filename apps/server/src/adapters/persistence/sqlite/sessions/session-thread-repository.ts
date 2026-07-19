import { and, asc, desc, eq, isNull } from 'drizzle-orm'

import { sessionThreads, workSessions } from '../../../../db/schema'
import type {
  CreateSessionThreadInput,
  ListVisibleThreadsByAccountOptions,
  SessionThreadRecord,
  SessionThreadRepository,
  UpdateSessionThreadInput,
} from '../../../../domain/sessions/session-thread-repository'
import type { DomainError } from '../../../../shared/errors'
import {
  asAccountId,
  asSessionMessageId,
  asSessionThreadId,
  asTenantId,
  asWorkSessionId,
  type SessionThreadId,
  type WorkSessionId,
} from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import type { RepositoryDatabase } from '../repository-database'

interface RawSessionThreadRow {
  branchFromMessageId: string | null
  branchFromSequence: number | null
  createdAt: string
  createdByAccountId: string | null
  id: string
  parentThreadId: string | null
  sessionId: string
  status: SessionThreadRecord['status']
  tenantId: string
  title: string | null
  titleSource: SessionThreadRecord['titleSource']
  updatedAt: string
}

const toSessionThreadRecord = (
  threadRow: typeof sessionThreads.$inferSelect,
): SessionThreadRecord => ({
  branchFromMessageId: threadRow.branchFromMessageId
    ? asSessionMessageId(threadRow.branchFromMessageId)
    : null,
  branchFromSequence: threadRow.branchFromSequence,
  createdAt: threadRow.createdAt,
  createdByAccountId: threadRow.createdByAccountId
    ? asAccountId(threadRow.createdByAccountId)
    : null,
  id: asSessionThreadId(threadRow.id),
  parentThreadId: threadRow.parentThreadId ? asSessionThreadId(threadRow.parentThreadId) : null,
  sessionId: asWorkSessionId(threadRow.sessionId),
  status: threadRow.status,
  tenantId: asTenantId(threadRow.tenantId),
  title: threadRow.title,
  titleSource: threadRow.titleSource,
  updatedAt: threadRow.updatedAt,
})

const toSessionThreadRecordFromRaw = (threadRow: RawSessionThreadRow): SessionThreadRecord =>
  toSessionThreadRecord(threadRow)

const buildConversationSearchQuery = (query: string): string | null => {
  const terms = Array.from(
    new Set(
      query
        .normalize('NFKC')
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? [],
    ),
  ).slice(0, 8)

  if (terms.length === 0) {
    return null
  }

  return terms.map((term) => `${term}*`).join(' AND ')
}

export const createSessionThreadRepository = (db: RepositoryDatabase): SessionThreadRepository => {
  const getById = (
    scope: TenantScope,
    threadId: SessionThreadId,
  ): Result<SessionThreadRecord, DomainError> => {
    const threadRow = db
      .select()
      .from(sessionThreads)
      .where(and(eq(sessionThreads.id, threadId), eq(sessionThreads.tenantId, scope.tenantId)))
      .get()

    if (!threadRow) {
      return err({
        message: `thread ${threadId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toSessionThreadRecord(threadRow))
  }

  return {
    create: (
      scope: TenantScope,
      input: CreateSessionThreadInput,
    ): Result<SessionThreadRecord, DomainError> => {
      try {
        const threadRecord: SessionThreadRecord = {
          branchFromMessageId: input.branchFromMessageId ?? null,
          branchFromSequence: input.branchFromSequence ?? null,
          createdAt: input.createdAt,
          createdByAccountId: input.createdByAccountId,
          id: input.id,
          parentThreadId: input.parentThreadId ?? null,
          sessionId: input.sessionId,
          status: 'active',
          tenantId: scope.tenantId,
          title: input.title,
          titleSource: input.titleSource ?? null,
          updatedAt: input.updatedAt,
        }

        db.insert(sessionThreads)
          .values({
            ...threadRecord,
          })
          .run()

        return ok(threadRecord)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown thread create failure'

        return err({
          message: `failed to create root thread ${input.id}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getById,
    listBySessionId: (
      scope: TenantScope,
      sessionId: WorkSessionId,
    ): Result<SessionThreadRecord[], DomainError> => {
      try {
        const threadRows = db
          .select()
          .from(sessionThreads)
          .where(
            and(
              eq(sessionThreads.sessionId, sessionId),
              eq(sessionThreads.tenantId, scope.tenantId),
            ),
          )
          .orderBy(asc(sessionThreads.createdAt), asc(sessionThreads.id))
          .all()

        return ok(threadRows.map(toSessionThreadRecord))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown session thread list failure'

        return err({
          message: `failed to list threads for session ${sessionId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    listVisibleByAccount: (
      scope: TenantScope,
      options: ListVisibleThreadsByAccountOptions = {},
    ): Result<SessionThreadRecord[], DomainError> => {
      const limit = options.limit ?? 50
      const searchQuery = options.query?.trim() ?? ''

      try {
        if (searchQuery.length > 0) {
          const ftsQuery = buildConversationSearchQuery(searchQuery)

          if (!ftsQuery) {
            return ok([])
          }

          if (!db.sqlite) {
            return err({
              message: 'conversation search requires a SQLite-backed repository handle',
              type: 'conflict',
            })
          }

          const threadRows = db.sqlite
            .prepare(
              `
                WITH matched_threads AS (
                  SELECT
                    thread_id AS threadId,
                    session_id AS sessionId,
                    tenant_id AS tenantId,
                    rank
                  FROM conversation_search
                  WHERE conversation_search MATCH ?
                )
                SELECT
                  t.created_at AS createdAt,
                  t.branch_from_message_id AS branchFromMessageId,
                  t.branch_from_sequence AS branchFromSequence,
                  t.created_by_account_id AS createdByAccountId,
                  t.id AS id,
                  t.parent_thread_id AS parentThreadId,
                  t.session_id AS sessionId,
                  t.status AS status,
                  t.tenant_id AS tenantId,
                  t.title AS title,
                  t.title_source AS titleSource,
                  t.updated_at AS updatedAt
                FROM matched_threads AS matched
                INNER JOIN session_threads AS t
                  ON t.id = matched.threadId
                 AND t.session_id = matched.sessionId
                 AND t.tenant_id = matched.tenantId
                INNER JOIN work_sessions AS s
                  ON s.id = t.session_id
                 AND s.tenant_id = t.tenant_id
                WHERE t.tenant_id = ?
                  AND t.status = 'active'
                  AND s.created_by_account_id = ?
                GROUP BY
                  t.created_at,
                  t.branch_from_message_id,
                  t.branch_from_sequence,
                  t.created_by_account_id,
                  t.id,
                  t.parent_thread_id,
                  t.session_id,
                  t.status,
                  t.tenant_id,
                  t.title,
                  t.title_source,
                  t.updated_at
                ORDER BY min(matched.rank) ASC, t.updated_at DESC, t.id DESC
                LIMIT ?
              `,
            )
            .all(ftsQuery, scope.tenantId, scope.accountId, limit) as RawSessionThreadRow[]

          return ok(threadRows.map(toSessionThreadRecordFromRaw))
        }

        const threadRows = db
          .select({
            thread: sessionThreads,
          })
          .from(sessionThreads)
          .innerJoin(
            workSessions,
            and(
              eq(sessionThreads.sessionId, workSessions.id),
              eq(sessionThreads.tenantId, workSessions.tenantId),
            ),
          )
          .where(
            and(
              eq(sessionThreads.tenantId, scope.tenantId),
              eq(sessionThreads.status, 'active'),
              eq(workSessions.createdByAccountId, scope.accountId),
            ),
          )
          .orderBy(desc(sessionThreads.updatedAt), desc(sessionThreads.id))
          .limit(limit)
          .all()

        return ok(threadRows.map((row) => toSessionThreadRecord(row.thread)))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown account thread list failure'

        return err({
          message: `failed to list active threads for account ${scope.accountId} in tenant ${scope.tenantId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    listRootVisibleByAccount: (scope: TenantScope): Result<SessionThreadRecord[], DomainError> => {
      try {
        const threadRows = db
          .select({
            thread: sessionThreads,
          })
          .from(sessionThreads)
          .innerJoin(
            workSessions,
            and(
              eq(sessionThreads.sessionId, workSessions.id),
              eq(sessionThreads.tenantId, workSessions.tenantId),
            ),
          )
          .where(
            and(
              eq(sessionThreads.tenantId, scope.tenantId),
              eq(sessionThreads.status, 'active'),
              eq(workSessions.createdByAccountId, scope.accountId),
              isNull(sessionThreads.parentThreadId),
            ),
          )
          .orderBy(desc(sessionThreads.updatedAt), desc(sessionThreads.id))
          .all()

        return ok(threadRows.map((row) => toSessionThreadRecord(row.thread)))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown account root thread list failure'

        return err({
          message: `failed to list active root threads for account ${scope.accountId} in tenant ${scope.tenantId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    update: (
      scope: TenantScope,
      threadId: SessionThreadId,
      input: UpdateSessionThreadInput,
    ): Result<SessionThreadRecord, DomainError> => {
      const updates = {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.titleSource !== undefined ? { titleSource: input.titleSource } : {}),
      }

      if (Object.keys(updates).length === 0) {
        return getById(scope, threadId)
      }

      try {
        const result = db
          .update(sessionThreads)
          .set({
            ...updates,
            updatedAt: input.updatedAt ?? new Date().toISOString(),
          })
          .where(and(eq(sessionThreads.id, threadId), eq(sessionThreads.tenantId, scope.tenantId)))
          .run()

        if (result.changes === 0) {
          return err({
            message: `thread ${threadId} not found in tenant ${scope.tenantId}`,
            type: 'not_found',
          })
        }

        return getById(scope, threadId)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown thread update failure'

        return err({
          message: `failed to update thread ${threadId}: ${message}`,
          type: 'conflict',
        })
      }
    },
  }
}
