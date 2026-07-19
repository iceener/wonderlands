import { createHash } from 'node:crypto'

import type {
  ContextArtifact,
  ContextArtifactPayload,
  ContextArtifactTransformation,
  ContextAuthority,
  ContextProvenanceSourceType,
} from './contracts'

export const CONTEXT_MANIFEST_VERSION = 'context/v2' as const

/** Closed, content-free reason vocabulary shared by every manifest decision category. */
export type ContextManifestReasonCode =
  | 'expired'
  | 'superseded'
  | 'duplicate'
  | 'conflict_lower_authority'
  | 'token_budget'
  | 'missing_dependency'
  | 'policy_rejected'
  | 'provider_unsupported'
  | 'not_relevant'

export interface ContextManifestBudgetSummary {
  readonly availableInputTokens: number | null
  readonly consideredArtifactTokens: number
  readonly droppedArtifactTokens: number
  readonly inputTokenLimit: number | null
  readonly reservedOutputTokens: number | null
  readonly selectedArtifactTokens: number
}

export interface ContextManifestArtifactEntry {
  readonly artifactId: string
  readonly authority: ContextAuthority
  readonly estimatedTokens: number
  readonly freshness: {
    readonly capturedAt: string
    readonly expiresAt: string | null
  }
  readonly layer: ContextArtifact['layer']
  readonly metadataStatus: ContextArtifact['metadataStatus']
  readonly payloadKind: ContextArtifactPayload['kind']
  readonly sensitivity: ContextArtifact['sensitivity']
  readonly source: {
    readonly ids: readonly string[]
    readonly type: ContextProvenanceSourceType
  }
  readonly transformation: ContextArtifactTransformation
}

export interface ContextManifestArtifactDecisionInput {
  readonly artifact: ContextArtifact
  readonly reasonCodes: readonly ContextManifestReasonCode[]
}

export interface ContextManifestArtifactDecision {
  readonly artifact: ContextManifestArtifactEntry
  readonly reasonCodes: readonly ContextManifestReasonCode[]
}

export interface ContextManifestConflictDecisionInput {
  readonly losers: readonly ContextArtifact[]
  readonly reasonCodes: readonly ContextManifestReasonCode[]
  readonly winner: ContextArtifact
}

export interface ContextManifestConflictDecision {
  readonly losers: readonly ContextManifestArtifactEntry[]
  readonly reasonCodes: readonly ContextManifestReasonCode[]
  readonly winner: ContextManifestArtifactEntry
}

export interface BuildContextManifestInput {
  readonly assemblerVersion: string
  readonly budget: ContextManifestBudgetSummary
  readonly conflicts?: readonly ContextManifestConflictDecisionInput[]
  readonly dropped?: readonly ContextManifestArtifactDecisionInput[]
  readonly generatedAt: string
  readonly model: string
  /** Storage identity is retained for correlation but deliberately excluded from replayHash. */
  readonly persistenceId?: string | null
  readonly provider: string
  readonly rejected?: readonly ContextManifestArtifactDecisionInput[]
  readonly runId: string
  readonly selectedArtifacts: readonly ContextArtifact[]
  readonly threadId: string
  readonly transformed?: readonly ContextManifestArtifactDecisionInput[]
  readonly turn: number
}

export interface ContextManifest {
  readonly assemblerVersion: string
  readonly budget: ContextManifestBudgetSummary
  readonly conflicts: readonly ContextManifestConflictDecision[]
  readonly coordinates: {
    readonly runId: string
    readonly threadId: string
    readonly turn: number
  }
  readonly dropped: readonly ContextManifestArtifactDecision[]
  readonly generatedAt: string
  readonly model: string
  readonly persistenceId: string | null
  readonly provider: string
  readonly rejected: readonly ContextManifestArtifactDecision[]
  /** Hash of replay semantics; generation time and persistence coordinates are excluded. */
  readonly replayHash: string
  readonly selected: readonly ContextManifestArtifactEntry[]
  readonly transformed: readonly ContextManifestArtifactDecision[]
  readonly version: typeof CONTEXT_MANIFEST_VERSION
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toCanonicalValue = (value: unknown, path: string): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Context manifest contains a non-finite number at ${path}`)
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => toCanonicalValue(entry, `${path}[${index}]`))
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, toCanonicalValue(value[key], `${path}.${key}`)]),
    )
  }

  throw new Error(`Context manifest contains unsupported data at ${path}`)
}

const canonicalJson = (value: unknown): string => JSON.stringify(toCanonicalValue(value, '$'))

const compareCanonical = (left: unknown, right: unknown): number => {
  const leftJson = canonicalJson(left)
  const rightJson = canonicalJson(right)

  if (leftJson === rightJson) {
    return 0
  }
  return leftJson < rightJson ? -1 : 1
}

const sortedUnique = <T extends string>(values: readonly T[]): readonly T[] =>
  Object.freeze([...new Set(values)].sort())

const cloneTransformation = (
  transformation: ContextArtifactTransformation,
): ContextArtifactTransformation => {
  switch (transformation.kind) {
    case 'none':
      return Object.freeze({ kind: 'none' })
    case 'truncated':
      return Object.freeze({
        includedBytes: transformation.includedBytes,
        kind: 'truncated',
        originalBytes: transformation.originalBytes,
      })
    case 'summarized':
      return Object.freeze({
        kind: 'summarized',
        sourceRefs: sortedUnique(transformation.sourceRefs),
        summarizerVersion: transformation.summarizerVersion,
      })
    case 'redacted':
      return Object.freeze({
        fields: sortedUnique(transformation.fields),
        kind: 'redacted',
      })
  }
}

/**
 * Projects an artifact through an explicit metadata allowlist. In particular, this function never
 * spreads an artifact and never reads its payload beyond the discriminating `kind` field.
 */
const toManifestEntry = (artifact: ContextArtifact): ContextManifestArtifactEntry =>
  Object.freeze({
    artifactId: artifact.id,
    authority: artifact.authority,
    estimatedTokens: artifact.estimatedTokens,
    freshness: Object.freeze({
      capturedAt: artifact.capturedAt,
      expiresAt: artifact.expiresAt,
    }),
    layer: artifact.layer,
    metadataStatus: artifact.metadataStatus,
    payloadKind: artifact.payload.kind,
    sensitivity: artifact.sensitivity,
    source: Object.freeze({
      ids: sortedUnique(artifact.provenance.sourceIds),
      type: artifact.provenance.sourceType,
    }),
    transformation: cloneTransformation(artifact.transformation),
  })

const toDecision = (
  decision: ContextManifestArtifactDecisionInput,
): ContextManifestArtifactDecision =>
  Object.freeze({
    artifact: toManifestEntry(decision.artifact),
    reasonCodes: sortedUnique(decision.reasonCodes),
  })

const toSortedDecisions = (
  decisions: readonly ContextManifestArtifactDecisionInput[] | undefined,
): readonly ContextManifestArtifactDecision[] =>
  Object.freeze((decisions ?? []).map(toDecision).sort(compareCanonical))

const toConflict = (
  conflict: ContextManifestConflictDecisionInput,
): ContextManifestConflictDecision =>
  Object.freeze({
    losers: Object.freeze(conflict.losers.map(toManifestEntry).sort(compareCanonical)),
    reasonCodes: sortedUnique(conflict.reasonCodes),
    winner: toManifestEntry(conflict.winner),
  })

const cloneBudget = (budget: ContextManifestBudgetSummary): ContextManifestBudgetSummary =>
  Object.freeze({
    availableInputTokens: budget.availableInputTokens,
    consideredArtifactTokens: budget.consideredArtifactTokens,
    droppedArtifactTokens: budget.droppedArtifactTokens,
    inputTokenLimit: budget.inputTokenLimit,
    reservedOutputTokens: budget.reservedOutputTokens,
    selectedArtifactTokens: budget.selectedArtifactTokens,
  })

const assertTimestamp = (value: string, field: string): void => {
  if (value.trim().length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Context manifest has invalid ${field}: "${value}"`)
  }
}

const assertNonEmpty = (value: string, field: string): void => {
  if (value.trim().length === 0) {
    throw new Error(`Context manifest has an empty ${field}`)
  }
}

const assertBudget = (budget: ContextManifestBudgetSummary): void => {
  for (const [field, value] of Object.entries(budget)) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(
        `Context manifest budget ${field} must be a non-negative safe integer or null`,
      )
    }
  }
}

const assertArtifactTokens = (entries: readonly ContextManifestArtifactEntry[]): void => {
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.estimatedTokens) || entry.estimatedTokens < 0) {
      throw new Error(
        `Context manifest artifact "${entry.artifactId}" has invalid estimated tokens`,
      )
    }
  }
}

/**
 * Builds a deterministic, content-free context/v2 shadow manifest. The function has no clock or
 * random access: callers must supply generatedAt and all assembly facts explicitly.
 */
export const buildContextManifest = (input: BuildContextManifestInput): ContextManifest => {
  assertTimestamp(input.generatedAt, 'generatedAt')
  assertNonEmpty(input.assemblerVersion, 'assemblerVersion')
  assertNonEmpty(input.model, 'model')
  assertNonEmpty(input.provider, 'provider')
  assertNonEmpty(input.runId, 'runId')
  assertNonEmpty(input.threadId, 'threadId')
  if (!Number.isSafeInteger(input.turn) || input.turn < 0) {
    throw new Error('Context manifest turn must be a non-negative safe integer')
  }
  assertBudget(input.budget)

  const budget = cloneBudget(input.budget)
  const selected = Object.freeze(
    input.selectedArtifacts.map(toManifestEntry).sort(compareCanonical),
  )
  const transformed = toSortedDecisions(input.transformed)
  const dropped = toSortedDecisions(input.dropped)
  const rejected = toSortedDecisions(input.rejected)
  const conflicts = Object.freeze((input.conflicts ?? []).map(toConflict).sort(compareCanonical))
  const decisionEntries = [...transformed, ...dropped, ...rejected].map(
    (decision) => decision.artifact,
  )
  assertArtifactTokens([
    ...selected,
    ...decisionEntries,
    ...conflicts.flatMap((conflict) => [conflict.winner, ...conflict.losers]),
  ])

  const replaySemantics = {
    assemblerVersion: input.assemblerVersion,
    budget,
    conflicts,
    dropped,
    model: input.model,
    provider: input.provider,
    rejected,
    selected,
    transformed,
    version: CONTEXT_MANIFEST_VERSION,
  }
  const replayHash = `ctxm_${createHash('sha256').update(canonicalJson(replaySemantics)).digest('hex')}`

  return Object.freeze({
    ...replaySemantics,
    coordinates: Object.freeze({
      runId: input.runId,
      threadId: input.threadId,
      turn: input.turn,
    }),
    generatedAt: input.generatedAt,
    persistenceId: input.persistenceId ?? null,
    replayHash,
  })
}
