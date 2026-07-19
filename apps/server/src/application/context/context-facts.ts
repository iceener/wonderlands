import type { MemoryRecordRecord } from '../../domain/memory/memory-record-repository'
import type { ContextSummaryRecord } from '../../domain/runtime/context-summary-repository'
import type { ItemRecord } from '../../domain/runtime/item-repository'
import type { RunDependencyRecord } from '../../domain/runtime/run-dependency-repository'
import type { RunRecord } from '../../domain/runtime/run-repository'
import type { SessionMessageRecord } from '../../domain/sessions/session-message-repository'
import type { AttachmentRefDescriptor } from '../files/attachment-ref-context'
import type { VisibleFileContextEntry } from '../files/file-context'
import type { GardenAgentContext } from '../garden/garden-agent-context'
import type { AgentProfileContext, ThreadContextData } from '../interactions/context-bundle'
import type { ContextStatePreparationReadiness } from './prepare-context-state'

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer TEntry)[]
    ? readonly DeepReadonly<TEntry>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T

/**
 * Immutable durable inputs available after context preparation. Facts are data, not an assertion
 * that any value is model-visible. `capturedAt` is taken from the prepared run snapshot and never
 * from a collector clock.
 */
export interface ContextFacts {
  readonly activeReflection: DeepReadonly<MemoryRecordRecord> | null
  readonly agentProfile: DeepReadonly<AgentProfileContext> | null
  readonly attachmentRefs: readonly DeepReadonly<AttachmentRefDescriptor>[]
  readonly capturedAt: string
  readonly gardenContext: DeepReadonly<GardenAgentContext> | null
  readonly items: readonly DeepReadonly<ItemRecord>[]
  readonly observations: readonly DeepReadonly<MemoryRecordRecord>[]
  readonly pendingWaits: readonly DeepReadonly<RunDependencyRecord>[]
  readonly readiness: DeepReadonly<ContextStatePreparationReadiness>
  readonly run: DeepReadonly<RunRecord>
  readonly summary: DeepReadonly<ContextSummaryRecord> | null
  readonly visibleFiles: readonly DeepReadonly<VisibleFileContextEntry>[]
  readonly visibleMessages: readonly DeepReadonly<SessionMessageRecord>[]
}

type MutableContextFactsInput = {
  activeReflection: MemoryRecordRecord | null
  agentProfile: AgentProfileContext | null
  attachmentRefs: AttachmentRefDescriptor[]
  capturedAt: string
  gardenContext: GardenAgentContext | null
  items: ItemRecord[]
  observations: MemoryRecordRecord[]
  pendingWaits: RunDependencyRecord[]
  readiness: ContextStatePreparationReadiness
  run: RunRecord
  summary: ContextSummaryRecord | null
  visibleFiles: VisibleFileContextEntry[]
  visibleMessages: SessionMessageRecord[]
}

const freezeDeep = <T>(value: T): DeepReadonly<T> => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      freezeDeep(nested)
    }

    Object.freeze(value)
  }

  return value as DeepReadonly<T>
}

/** Creates a detached, runtime-frozen snapshot so repository and prepared-state values stay owned. */
export const createContextFactsSnapshot = (input: MutableContextFactsInput): ContextFacts =>
  freezeDeep(structuredClone(input))

/**
 * Compatibility projection for the current contributors and assembler. Snapshot-only readiness
 * and capture metadata are intentionally omitted, while every mutable array/object is detached.
 */
export const projectContextFactsToThreadContextData = (facts: ContextFacts): ThreadContextData =>
  structuredClone({
    activeReflection: facts.activeReflection,
    agentProfile: facts.agentProfile,
    attachmentRefs: facts.attachmentRefs,
    gardenContext: facts.gardenContext,
    items: facts.items,
    observations: facts.observations,
    pendingWaits: facts.pendingWaits,
    run: facts.run,
    summary: facts.summary,
    visibleFiles: facts.visibleFiles,
    visibleMessages: facts.visibleMessages,
  }) as ThreadContextData
