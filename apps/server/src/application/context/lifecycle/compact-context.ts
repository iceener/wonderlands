import type { ContextSummaryRecord } from '../../../domain/runtime/context-summary-repository'
import type { ItemRecord } from '../../../domain/runtime/item-repository'
import type { RunDependencyRecord } from '../../../domain/runtime/run-dependency-repository'
import type { RunRecord } from '../../../domain/runtime/run-repository'
import type { CommandContext, CommandResult } from '../../commands/command-context'
import { maybeCompactMainThreadContext } from '../../runtime/execution/context-compaction'

/** Compatibility adapter around the existing deterministic compaction service. */
export const compactContext = (
  context: CommandContext,
  run: RunRecord,
  items: ItemRecord[],
  pendingWaits: RunDependencyRecord[],
): CommandResult<ContextSummaryRecord | null> =>
  maybeCompactMainThreadContext(
    {
      config: context.config,
      createId: context.services.ids.create,
      db: context.db,
      nowIso: () => context.services.clock.nowIso(),
      scope: context.tenantScope,
    },
    run,
    items,
    pendingWaits,
  )
