import { createAgentRepository } from '../persistence/repositories'
import { createAgentRevisionRepository } from '../persistence/repositories'
import { createAgentSubagentLinkRepository } from '../persistence/repositories'
import { createMemoryRecordRepository } from '../persistence/repositories'
import { withTransaction } from '../../db/transaction'
import type { MemoryRecordRecord } from '../../domain/memory/memory-record-repository'
import { createContextSummaryRepository } from '../persistence/repositories'
import { createRunDependencyRepository } from '../persistence/repositories'
import type { RunRecord } from '../../domain/runtime/run-repository'
import { ok } from '../../shared/result'
import { getAgentDescription, listAgentCapabilities } from '../agents/agent-capabilities'
import type { CommandContext, CommandResult } from '../commands/command-context'
import { loadThreadAttachmentRefs } from '../files/attachment-ref-context'
import { loadVisibleFileContext } from '../files/file-context'
import { loadGardenAgentContext } from '../garden/garden-agent-context'
import { resolveReadableMemoryScopes, resolveWritableMemoryScope } from '../memory/memory-scope'
import { estimateObservationTokenCount, observeSummary } from '../memory/observe-summary'
import {
  estimateReflectionTokenCount,
  reflectRunLocalMemory,
} from '../memory/reflect-run-local-memory'
import { maybeCompactMainThreadContext } from '../runtime/execution/context-compaction'
import {
  ensureProjectedThreadContext,
  listVisibleMessages,
} from '../runtime/projection/run-projection'
import { emitProgressReported, tryAppendRunTelemetryEvent } from '../runtime/run-telemetry'
import type { ThreadContextData } from './context-bundle'

const loadAgentProfile = (
  context: CommandContext,
  run: RunRecord,
): CommandResult<ThreadContextData['agentProfile']> => {
  if (!run.agentRevisionId) {
    return ok(null)
  }

  const revisionRepository = createAgentRevisionRepository(context.db)
  const revision = revisionRepository.getById(context.tenantScope, run.agentRevisionId)

  if (!revision.ok) {
    return revision
  }

  const subagentLinkRepository = createAgentSubagentLinkRepository(context.db)
  const subagentLinks = subagentLinkRepository.listByParentRevisionId(
    context.tenantScope,
    revision.value.id,
  )

  if (!subagentLinks.ok) {
    return subagentLinks
  }

  const agentRepository = createAgentRepository(context.db)
  const subagents: NonNullable<ThreadContextData['agentProfile']>['subagents'] = []

  for (const link of subagentLinks.value) {
    const childAgent = agentRepository.getById(context.tenantScope, link.childAgentId)

    if (!childAgent.ok) {
      return childAgent
    }

    if (childAgent.value.status !== 'active') {
      continue
    }

    let childDescription: string | null = null
    let tools: NonNullable<ThreadContextData['agentProfile']>['subagents'][number]['tools'] = []

    if (childAgent.value.activeRevisionId) {
      const childRevision = revisionRepository.getById(
        context.tenantScope,
        childAgent.value.activeRevisionId,
      )

      if (!childRevision.ok) {
        return childRevision
      }

      const parsedChildDescription = getAgentDescription(childRevision.value)

      if (!parsedChildDescription.ok) {
        return parsedChildDescription
      }

      childDescription = parsedChildDescription.value

      const childCapabilities = listAgentCapabilities({
        db: context.db,
        revision: childRevision.value,
        scope: context.tenantScope,
        toolRegistry: context.services.tools,
      })

      if (!childCapabilities.ok) {
        return childCapabilities
      }

      tools = childCapabilities.value
    }

    subagents.push({
      alias: link.alias,
      childAgentId: link.childAgentId,
      childDescription,
      childName: childAgent.value.name,
      childSlug: childAgent.value.slug,
      delegationMode: link.delegationMode,
      tools,
    })
  }

  return ok({
    instructionsMd: revision.value.instructionsMd,
    revisionId: revision.value.id,
    subagents,
  })
}

const ensureLatestSummaryObserved = async (
  context: CommandContext,
  run: RunRecord,
  summary: ThreadContextData['summary'],
): Promise<null> => {
  if (!summary || !run.threadId) {
    return null
  }

  const threadId = run.threadId
  const writableScope = resolveWritableMemoryScope(run)

  const memoryRepository = createMemoryRecordRepository(context.db)
  const hasObservation = memoryRepository.hasObservationForSummary(context.tenantScope, summary.id)

  if (!hasObservation.ok || hasObservation.value) {
    return null
  }

  tryAppendRunTelemetryEvent(context, context.db, run, 'memory.observation.started', {
    summaryId: summary.id,
  })
  const observed = await observeSummary(context, run, summary)

  if (!observed.ok || !observed.value) {
    return null
  }

  const observationContent = observed.value
  const observationTokenCount = estimateObservationTokenCount(observationContent)

  withTransaction(context.db, (tx) => {
    const txMemoryRepository = createMemoryRecordRepository(tx)
    const recordId = context.services.ids.create('mrec')

    const createdObservation = txMemoryRepository.createObservationForSummary(context.tenantScope, {
      content: observationContent,
      createdAt: context.services.clock.nowIso(),
      fromSequence: summary.fromSequence,
      id: recordId,
      ownerRunId: run.id,
      rootRunId: run.rootRunId,
      scopeKind: writableScope.scopeKind,
      scopeRef: writableScope.scopeRef,
      sessionId: run.sessionId,
      sourceId: context.services.ids.create('msrc'),
      sourceRunId: run.id,
      sourceSummaryId: summary.id,
      threadId,
      throughSequence: summary.throughSequence,
      tokenCount: observationTokenCount,
    })

    if (!createdObservation.ok) {
      return
    }

    tryAppendRunTelemetryEvent(context, tx, run, 'memory.observation.completed', {
      memoryRecordId: recordId,
      observationCount: observationContent.observations.length,
      source: observationContent.source,
      summaryId: summary.id,
      tokenCount: observationTokenCount,
    })
  })
  emitProgressReported(context, context.db, run, {
    detail: `Stored ${observationContent.observations.length} durable observation${observationContent.observations.length === 1 ? '' : 's'}`,
    percent: 8,
    stage: 'memory.observation.completed',
    turn: run.turnCount + 1,
  })

  return null
}

const ensureRunLocalReflected = async (context: CommandContext, run: RunRecord): Promise<null> => {
  if (!run.threadId || run.parentRunId !== null) {
    return null
  }

  const scopedMemory = loadScopedMemoryState(context, run)

  if (!scopedMemory.ok || scopedMemory.value.observations.length === 0) {
    return null
  }

  tryAppendRunTelemetryEvent(context, context.db, run, 'memory.reflection.started', {
    latestReflectionId: scopedMemory.value.activeReflection?.id ?? null,
    observationCount: scopedMemory.value.observations.length,
  })
  const reflected = await reflectRunLocalMemory(context, run, {
    latestReflection: scopedMemory.value.activeReflection,
    observationSourceTokenCount: scopedMemory.value.observationSourceTokenCount,
    observations: scopedMemory.value.observations,
  })

  if (!reflected.ok || !reflected.value) {
    return null
  }

  const reflectionContent = reflected.value
  const threadId = run.threadId
  const reflectionTokenCount = estimateReflectionTokenCount(reflectionContent)
  const writableScope = resolveWritableMemoryScope(run)

  withTransaction(context.db, (tx) => {
    const txMemoryRepository = createMemoryRecordRepository(tx)
    const recordId = context.services.ids.create('mrec')
    const createdReflection = txMemoryRepository.createReflection(context.tenantScope, {
      content: reflectionContent,
      createdAt: context.services.clock.nowIso(),
      id: recordId,
      ownerRunId: run.id,
      previousReflectionGeneration: scopedMemory.value.activeReflection?.generation ?? null,
      previousReflectionId: scopedMemory.value.activeReflection?.id ?? null,
      rootRunId: run.rootRunId,
      scopeKind: writableScope.scopeKind,
      scopeRef: writableScope.scopeRef,
      sessionId: run.sessionId,
      sourceIds: [
        ...(scopedMemory.value.activeReflection ? [context.services.ids.create('msrc')] : []),
        ...scopedMemory.value.observations.map(() => context.services.ids.create('msrc')),
      ],
      sourceRecordIds: [
        ...(scopedMemory.value.activeReflection ? [scopedMemory.value.activeReflection.id] : []),
        ...scopedMemory.value.observations.map((record) => record.id),
      ],
      sourceRunId: run.id,
      threadId,
      tokenCount: reflectionTokenCount,
    })

    if (!createdReflection.ok) {
      return
    }

    txMemoryRepository.supersedeRecords(context.tenantScope, [
      ...(scopedMemory.value.activeReflection ? [scopedMemory.value.activeReflection.id] : []),
      ...scopedMemory.value.observations.map((record) => record.id),
    ])
    tryAppendRunTelemetryEvent(context, tx, run, 'memory.reflection.completed', {
      generation: createdReflection.value.generation,
      latestReflectionId: scopedMemory.value.activeReflection?.id ?? null,
      memoryRecordId: recordId,
      observationCount: scopedMemory.value.observations.length,
      source: reflectionContent.source,
      tokenCount: reflectionTokenCount,
    })
  })
  emitProgressReported(context, context.db, run, {
    detail: 'Compressed active observations into a reflection record',
    percent: 12,
    stage: 'memory.reflection.completed',
    turn: run.turnCount + 1,
  })

  return null
}

const loadScopedMemoryState = (
  context: CommandContext,
  run: RunRecord,
): CommandResult<{
  activeReflection: MemoryRecordRecord | null
  observationSourceTokenCount: number
  observations: MemoryRecordRecord[]
}> => {
  const memoryRepository = createMemoryRecordRepository(context.db)
  let activeReflection: MemoryRecordRecord | null = null
  let observationSourceTokenCount = 0
  let observations: MemoryRecordRecord[] = []

  for (const readableScope of resolveReadableMemoryScopes(run)) {
    const scopedObservations = memoryRepository.listActiveObservationsByScope(
      context.tenantScope,
      readableScope,
    )

    if (!scopedObservations.ok) {
      return scopedObservations
    }

    const scopedReflection = memoryRepository.getLatestActiveReflectionByScope(
      context.tenantScope,
      readableScope,
    )

    if (!scopedReflection.ok) {
      return scopedReflection
    }

    const scopedObservationSourceTokens =
      memoryRepository.getActiveObservationSourceTokenCountByScope(
        context.tenantScope,
        readableScope,
      )

    if (!scopedObservationSourceTokens.ok) {
      return scopedObservationSourceTokens
    }

    observations = scopedObservations.value
    activeReflection = scopedReflection.value
    observationSourceTokenCount = scopedObservationSourceTokens.value

    if (observations.length > 0 || activeReflection) {
      break
    }
  }

  return ok({
    activeReflection,
    observationSourceTokenCount,
    observations,
  })
}

export const loadThreadContext = async (
  context: CommandContext,
  run: RunRecord,
  options: {
    compact?: boolean
    observe?: boolean
    reflect?: boolean
  } = {},
): Promise<CommandResult<ThreadContextData>> => {
  const compact = options.compact ?? true
  const observe = options.observe ?? true
  const reflect = options.reflect ?? true
  const visibleMessages = listVisibleMessages(context, run)

  if (!visibleMessages.ok) {
    return visibleMessages
  }

  const visibleFiles = await loadVisibleFileContext(context, visibleMessages.value, run.id)

  if (!visibleFiles.ok) {
    return visibleFiles
  }

  const items = ensureProjectedThreadContext(context, run, visibleMessages.value)

  if (!items.ok) {
    return items
  }

  const pendingWaits = createRunDependencyRepository(context.db).listPendingByRunId(
    context.tenantScope,
    run.id,
  )

  if (!pendingWaits.ok) {
    return pendingWaits
  }

  if (compact) {
    const compacted = maybeCompactMainThreadContext(
      {
        config: context.config,
        createId: context.services.ids.create,
        db: context.db,
        nowIso: () => context.services.clock.nowIso(),
        scope: context.tenantScope,
      },
      run,
      items.value,
      pendingWaits.value,
    )

    if (!compacted.ok) {
      return compacted
    }
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
    ? items.value.filter((item) => item.sequence > latestSummaryRecord.throughSequence)
    : items.value
  const attachmentRefs = loadThreadAttachmentRefs(context, {
    liveTailItems,
    visibleMessages: visibleMessages.value,
  })

  if (!attachmentRefs.ok) {
    return attachmentRefs
  }
  const agentProfile = loadAgentProfile(context, run)

  if (!agentProfile.ok) {
    return agentProfile
  }

  const gardenContext = loadGardenAgentContext(context.db, context.tenantScope, run.agentRevisionId)

  if (!gardenContext.ok) {
    return gardenContext
  }

  if (observe) {
    await ensureLatestSummaryObserved(context, run, latestSummaryRecord)
  }

  if (reflect) {
    await ensureRunLocalReflected(context, run)
  }

  const scopedMemory = loadScopedMemoryState(context, run)

  if (!scopedMemory.ok) {
    return scopedMemory
  }

  return ok({
    attachmentRefs: attachmentRefs.value,
    agentProfile: agentProfile.value,
    activeReflection: scopedMemory.value.activeReflection,
    gardenContext: gardenContext.value.gardens.length > 0 ? gardenContext.value : null,
    items: liveTailItems,
    observations: scopedMemory.value.observations,
    pendingWaits: pendingWaits.value,
    run,
    summary: latestSummaryRecord,
    visibleFiles: visibleFiles.value,
    visibleMessages: visibleMessages.value,
  })
}
