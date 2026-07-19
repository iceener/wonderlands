import type { RunRecord } from '../../domain/runtime/run-repository'
import { err, ok } from '../../shared/result'
import type { CommandContext, CommandResult } from '../commands/command-context'
import {
  createContextSummaryRepository,
  createItemRepository,
  createRunDependencyRepository,
  createSessionMessageRepository,
} from '../persistence/repositories'
import type { PreparedContextState } from './prepare-context-state'

/**
 * Reads the currently durable context boundaries without preparing or repairing them. In
 * particular, an empty item projection remains empty so collection/assembly can use visible
 * message history as its fallback without causing projection writes.
 */
export const readContextState = (
  context: CommandContext,
  run: RunRecord,
): CommandResult<PreparedContextState> => {
  if (!run.threadId && run.parentRunId === null) {
    return err({
      message: `run ${run.id} is missing a thread binding`,
      type: 'conflict',
    })
  }

  const visibleMessages = run.threadId
    ? createSessionMessageRepository(context.db).listByThreadId(context.tenantScope, run.threadId)
    : ok([])

  if (!visibleMessages.ok) {
    return visibleMessages
  }

  const projectedItems = createItemRepository(context.db).listByRunId(context.tenantScope, run.id)

  if (!projectedItems.ok) {
    return projectedItems
  }

  const pendingWaits = createRunDependencyRepository(context.db).listPendingByRunId(
    context.tenantScope,
    run.id,
  )

  if (!pendingWaits.ok) {
    return pendingWaits
  }

  const latestSummary = createContextSummaryRepository(context.db).getLatestByRunId(
    context.tenantScope,
    run.id,
  )

  if (!latestSummary.ok) {
    return latestSummary
  }

  const latestSummaryRecord = latestSummary.value
  const liveTailItems = latestSummaryRecord
    ? projectedItems.value.filter((item) => item.sequence > latestSummaryRecord.throughSequence)
    : projectedItems.value

  return ok({
    latestSummary: latestSummaryRecord,
    liveTailItems,
    pendingWaits: pendingWaits.value,
    projectedItems: projectedItems.value,
    readiness: {
      compaction: 'disabled',
      observation: 'disabled',
      projection: 'ready',
      reflection: 'disabled',
    },
    run,
    visibleMessages: visibleMessages.value,
  })
}
