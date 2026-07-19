import { and, eq, inArray } from 'drizzle-orm'

import { accountThreadActivitySeen } from '../../../../db/schema'
import type {
  ThreadActivitySeenRecord,
  ThreadActivitySeenRepository,
  UpsertThreadActivitySeenInput,
} from '../../../../domain/sessions/thread-activity-seen-repository'
import type { DomainError } from '../../../../shared/errors'
import {
  asAccountId,
  asRunId,
  asSessionThreadId,
  asTenantId,
  type SessionThreadId,
} from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import type { RepositoryDatabase } from '../repository-database'

const toThreadActivitySeenRecord = (
  row: typeof accountThreadActivitySeen.$inferSelect,
): ThreadActivitySeenRecord => ({
  accountId: asAccountId(row.accountId),
  seenCompletedAt: row.seenCompletedAt,
  seenCompletedRunId: asRunId(row.seenCompletedRunId),
  tenantId: asTenantId(row.tenantId),
  threadId: asSessionThreadId(row.threadId),
  updatedAt: row.updatedAt,
})

export const createThreadActivitySeenRepository = (
  db: RepositoryDatabase,
): ThreadActivitySeenRepository => ({
  listByThreadIds: (
    scope: TenantScope,
    threadIds: SessionThreadId[],
  ): Result<ThreadActivitySeenRecord[], DomainError> => {
    if (threadIds.length === 0) {
      return ok([])
    }

    try {
      const rows = db
        .select()
        .from(accountThreadActivitySeen)
        .where(
          and(
            eq(accountThreadActivitySeen.tenantId, scope.tenantId),
            eq(accountThreadActivitySeen.accountId, scope.accountId),
            inArray(accountThreadActivitySeen.threadId, threadIds),
          ),
        )
        .all()

      return ok(rows.map(toThreadActivitySeenRecord))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown thread activity seen list failure'

      return err({
        message: `failed to list thread activity seen rows for account ${scope.accountId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  upsert: (
    scope: TenantScope,
    input: UpsertThreadActivitySeenInput,
  ): Result<ThreadActivitySeenRecord, DomainError> => {
    try {
      db.insert(accountThreadActivitySeen)
        .values({
          accountId: scope.accountId,
          seenCompletedAt: input.seenCompletedAt,
          seenCompletedRunId: input.seenCompletedRunId,
          tenantId: scope.tenantId,
          threadId: input.threadId,
          updatedAt: input.updatedAt,
        })
        .onConflictDoUpdate({
          set: {
            seenCompletedAt: input.seenCompletedAt,
            seenCompletedRunId: input.seenCompletedRunId,
            updatedAt: input.updatedAt,
          },
          target: [
            accountThreadActivitySeen.tenantId,
            accountThreadActivitySeen.accountId,
            accountThreadActivitySeen.threadId,
          ],
        })
        .run()

      const row = db
        .select()
        .from(accountThreadActivitySeen)
        .where(
          and(
            eq(accountThreadActivitySeen.tenantId, scope.tenantId),
            eq(accountThreadActivitySeen.accountId, scope.accountId),
            eq(accountThreadActivitySeen.threadId, input.threadId),
          ),
        )
        .get()

      if (!row) {
        return err({
          message: `thread activity seen row for thread ${input.threadId} not found after upsert`,
          type: 'not_found',
        })
      }

      return ok(toThreadActivitySeenRecord(row))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown thread activity seen upsert failure'

      return err({
        message: `failed to upsert thread activity seen row for thread ${input.threadId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
