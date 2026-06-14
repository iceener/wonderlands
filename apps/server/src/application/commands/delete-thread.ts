import { and, eq } from 'drizzle-orm'
import { runs, sessionThreads } from '../../db/schema'
import { withTransaction } from '../../db/transaction'
import { DomainErrorException } from '../../shared/errors'
import type { SessionThreadId } from '../../shared/ids'
import { err, ok } from '../../shared/result'
import { createResourceAccessService } from '../access/resource-access'
import type { CommandContext, CommandResult } from './command-context'
import { pruneThreadHistoryInTransaction } from './thread-history-pruning'

export interface DeleteThreadOutput {
  deleted: true
  threadId: SessionThreadId
}

const collectThreadSubtreeIds = (
  rows: Array<typeof sessionThreads.$inferSelect>,
  rootThreadId: string,
): string[] => {
  const childrenByParent = new Map<string, string[]>()

  for (const row of rows) {
    if (!row.parentThreadId) {
      continue
    }

    const children = childrenByParent.get(row.parentThreadId) ?? []
    children.push(row.id)
    childrenByParent.set(row.parentThreadId, children)
  }

  const seen = new Set<string>()
  const queue = [rootThreadId]
  const threadIds: string[] = []

  while (queue.length > 0) {
    const current = queue.shift()

    if (!current || seen.has(current)) {
      continue
    }

    seen.add(current)
    threadIds.push(current)

    for (const childThreadId of childrenByParent.get(current) ?? []) {
      queue.push(childThreadId)
    }
  }

  return threadIds
}

export const createDeleteThreadCommand = () => ({
  execute: async (
    context: CommandContext,
    threadId: SessionThreadId,
  ): Promise<CommandResult<DeleteThreadOutput>> => {
    const resourceAccess = createResourceAccessService(context.db)
    const authorizedThread = resourceAccess.authorizeThreadWrite(context.tenantScope, threadId)

    if (!authorizedThread.ok) {
      return authorizedThread
    }

    try {
      const blobStorageKeys = withTransaction(context.db, (tx) => {
        const sessionId = authorizedThread.value.session.id
        const sessionThreadRows = tx
          .select()
          .from(sessionThreads)
          .where(
            and(
              eq(sessionThreads.tenantId, context.tenantScope.tenantId),
              eq(sessionThreads.sessionId, sessionId),
            ),
          )
          .all()
        const threadIds = collectThreadSubtreeIds(sessionThreadRows, threadId)
        const sessionRunRows = tx
          .select()
          .from(runs)
          .where(
            and(eq(runs.tenantId, context.tenantScope.tenantId), eq(runs.sessionId, sessionId)),
          )
          .all()
        const rootRunIds = [
          ...new Set(
            sessionRunRows
              .filter((row) => row.threadId !== null && threadIds.includes(row.threadId))
              .map((row) => row.rootRunId),
          ),
        ]
        const pruned = pruneThreadHistoryInTransaction(tx, {
          rootRunIds,
          sessionId,
          tenantId: context.tenantScope.tenantId,
          threadIds,
        })

        if (!pruned.ok) {
          if (pruned.error.type === 'conflict') {
            throw new DomainErrorException({
              message: `thread ${threadId} cannot be permanently deleted while ${pruned.error.message.replace(/^history cannot be pruned while /, '')}`,
              type: 'conflict',
            })
          }

          throw new DomainErrorException(pruned.error)
        }

        return pruned.value.blobStorageKeys
      })

      for (const storageKey of blobStorageKeys) {
        const deletedBlob = await context.services.files.blobStore.delete(storageKey)

        if (!deletedBlob.ok) {
          return deletedBlob
        }
      }

      return ok({
        deleted: true,
        threadId,
      })
    } catch (error) {
      if (error instanceof DomainErrorException) {
        return err(error.domainError)
      }

      const message = error instanceof Error ? error.message : 'Unknown thread delete failure'

      return err({
        message: `failed to permanently delete thread ${threadId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
