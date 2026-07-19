import type { ContextSummaryRecord } from '../../domain/runtime/context-summary-repository'
import type { ItemRecord } from '../../domain/runtime/item-repository'
import type { RunDependencyRecord } from '../../domain/runtime/run-dependency-repository'
import type { RunRecord } from '../../domain/runtime/run-repository'
import type { SessionMessageRecord } from '../../domain/sessions/session-message-repository'
import { ok } from '../../shared/result'
import type { CommandContext, CommandResult } from '../commands/command-context'
import {
  createContextSummaryRepository,
  createRunDependencyRepository,
} from '../persistence/repositories'
import {
  ensureProjectedThreadContext,
  listVisibleMessages,
} from '../runtime/projection/run-projection'
import { compactContext } from './lifecycle/compact-context'
import { ensureLatestSummaryObserved } from './lifecycle/observe-summary'
import { ensureRunLocalReflected } from './lifecycle/reflect-memory'

export interface PrepareContextStateOptions {
  compact?: boolean
  observe?: boolean
  reflect?: boolean
}

export interface ContextStatePreparationReadiness {
  compaction: 'completed' | 'disabled' | 'ineligible_child_run'
  observation: 'completed' | 'disabled'
  projection: 'ready'
  reflection: 'completed' | 'disabled' | 'ineligible_child_run'
}

/**
 * Durable boundaries established before read-only context facts are collected. `projectedItems`
 * is the complete run projection; `liveTailItems` is bounded by `latestSummary`.
 */
export interface PreparedContextState {
  latestSummary: ContextSummaryRecord | null
  liveTailItems: ItemRecord[]
  pendingWaits: RunDependencyRecord[]
  projectedItems: ItemRecord[]
  readiness: ContextStatePreparationReadiness
  run: RunRecord
  visibleMessages: SessionMessageRecord[]
}

export interface PreparedContextBoundaries extends Omit<PreparedContextState, 'readiness'> {
  readiness: Pick<ContextStatePreparationReadiness, 'compaction' | 'projection'>
}

/**
 * Migration-only compatibility hooks. New callers should not provide hooks: preparation runs to
 * completion, then the read-only collector consumes the returned state.
 */
export interface PrepareContextStateHooks {
  beforeMemoryLifecycle?: (
    state: PreparedContextBoundaries,
  ) => CommandResult<null> | Promise<CommandResult<null>>
  visibleMessages?: SessionMessageRecord[]
}

/**
 * Establishes projection and compaction boundaries, then runs memory lifecycle work in the legacy
 * order: observer before reflector. Observer/reflector failures remain best-effort inside their
 * lifecycle adapters; durable read/projection/compaction failures are returned.
 */
export const prepareContextState = async (
  context: CommandContext,
  run: RunRecord,
  options: PrepareContextStateOptions = {},
  hooks: PrepareContextStateHooks = {},
): Promise<CommandResult<PreparedContextState>> => {
  const compact = options.compact ?? true
  const observe = options.observe ?? true
  const reflect = options.reflect ?? true
  const visibleMessagesResult = hooks.visibleMessages
    ? ok(hooks.visibleMessages)
    : listVisibleMessages(context, run)

  if (!visibleMessagesResult.ok) {
    return visibleMessagesResult
  }

  const visibleMessages = visibleMessagesResult.value
  const projectedItems = ensureProjectedThreadContext(context, run, visibleMessages)

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

  let compactionReadiness: ContextStatePreparationReadiness['compaction'] = 'disabled'

  if (compact && run.parentRunId === null) {
    const compacted = compactContext(context, run, projectedItems.value, pendingWaits.value)

    if (!compacted.ok) {
      return compacted
    }

    compactionReadiness = 'completed'
  } else if (compact) {
    compactionReadiness = 'ineligible_child_run'
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
  const boundaries: PreparedContextBoundaries = {
    latestSummary: latestSummaryRecord,
    liveTailItems,
    pendingWaits: pendingWaits.value,
    projectedItems: projectedItems.value,
    readiness: {
      compaction: compactionReadiness,
      projection: 'ready',
    },
    run,
    visibleMessages,
  }

  if (hooks.beforeMemoryLifecycle) {
    const hookResult = await hooks.beforeMemoryLifecycle(boundaries)

    if (!hookResult.ok) {
      return hookResult
    }
  }

  if (observe) {
    await ensureLatestSummaryObserved(context, run, latestSummaryRecord)
  }

  if (reflect) {
    await ensureRunLocalReflected(context, run)
  }

  return ok({
    ...boundaries,
    readiness: {
      ...boundaries.readiness,
      observation: observe ? 'completed' : 'disabled',
      reflection: reflect
        ? run.parentRunId === null
          ? 'completed'
          : 'ineligible_child_run'
        : 'disabled',
    },
  })
}
