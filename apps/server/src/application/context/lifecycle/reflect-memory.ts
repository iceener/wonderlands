import { withTransaction } from '../../../db/transaction'
import type { MemoryRecordRecord } from '../../../domain/memory/memory-record-repository'
import type { RunRecord } from '../../../domain/runtime/run-repository'
import { ok } from '../../../shared/result'
import type { CommandContext, CommandResult } from '../../commands/command-context'
import { resolveReadableMemoryScopes, resolveWritableMemoryScope } from '../../memory/memory-scope'
import {
  estimateReflectionTokenCount,
  reflectRunLocalMemory,
} from '../../memory/reflect-run-local-memory'
import { createMemoryRecordRepository } from '../../persistence/repositories'
import { emitProgressReported, tryAppendRunTelemetryEvent } from '../../runtime/run-telemetry'

export interface ScopedMemoryState {
  activeReflection: MemoryRecordRecord | null
  observationSourceTokenCount: number
  observations: MemoryRecordRecord[]
}

/** Read-only memory snapshot retained for loader compatibility and the forthcoming facts collector. */
export const loadScopedMemoryState = (
  context: CommandContext,
  run: RunRecord,
): CommandResult<ScopedMemoryState> => {
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

/**
 * Attempts the legacy root-run reflection lifecycle work. Eligibility and failures retain the
 * prior best-effort semantics.
 */
export const ensureRunLocalReflected = async (
  context: CommandContext,
  run: RunRecord,
): Promise<void> => {
  if (!run.threadId || run.parentRunId !== null) {
    return
  }

  const scopedMemory = loadScopedMemoryState(context, run)

  if (!scopedMemory.ok || scopedMemory.value.observations.length === 0) {
    return
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
    return
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
}
