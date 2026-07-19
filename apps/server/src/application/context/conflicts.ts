import type { ContextArtifact, ContextAuthority } from './contracts'

export type ContextResolutionReasonCode = 'conflict_lower_authority' | 'duplicate' | 'superseded'

export interface ContextResolutionDecision {
  readonly artifact: ContextArtifact
  readonly reasonCodes: readonly ContextResolutionReasonCode[]
}

export interface ContextResolutionConflict {
  /** All equally authoritative winners survive. The first is the deterministic representative. */
  readonly winners: readonly ContextArtifact[]
  readonly losers: readonly ContextArtifact[]
  readonly reasonCodes: readonly Extract<ContextResolutionReasonCode, 'conflict_lower_authority'>[]
}

export interface ContextResolutionResult {
  readonly conflicts: readonly ContextResolutionConflict[]
  readonly dropped: readonly ContextResolutionDecision[]
  readonly selected: readonly ContextArtifact[]
}

const AUTHORITY_RANK: Readonly<Record<ContextAuthority, number>> = Object.freeze({
  platform: 110,
  user_correction: 100,
  authoritative_integration: 90,
  user_input: 80,
  tool_result: 70,
  agent_configuration: 60,
  conversation: 50,
  user_preference: 40,
  reflection: 30,
  observation: 20,
  summary: 10,
  inferred: 5,
  legacy: 0,
})

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const timestamp = (artifact: ContextArtifact): number => {
  const value = Date.parse(artifact.capturedAt)
  if (!Number.isFinite(value)) {
    throw new Error(`Context artifact "${artifact.id}" has an invalid capturedAt timestamp`)
  }
  return value
}

/** Negative means left is the preferred deterministic winner. */
const compareWinner = (left: ContextArtifact, right: ContextArtifact): number => {
  const authority = AUTHORITY_RANK[right.authority] - AUTHORITY_RANK[left.authority]
  if (authority !== 0) return authority

  const freshness = timestamp(right) - timestamp(left)
  if (freshness !== 0) return freshness

  const priority = right.priority - left.priority
  if (priority !== 0) return priority

  const tokenCost = left.estimatedTokens - right.estimatedTokens
  if (tokenCost !== 0) return tokenCost

  return compareText(left.id, right.id)
}

const groupByKey = (
  artifacts: readonly ContextArtifact[],
  readKey: (artifact: ContextArtifact) => string | null,
): Map<string, ContextArtifact[]> => {
  const groups = new Map<string, ContextArtifact[]>()
  for (const artifact of artifacts) {
    const key = readKey(artifact)
    if (key === null) continue
    const group = groups.get(key) ?? []
    group.push(artifact)
    groups.set(key, group)
  }
  return groups
}

const assertCandidates = (artifacts: readonly ContextArtifact[]): Map<string, ContextArtifact> => {
  const byId = new Map<string, ContextArtifact>()
  for (const artifact of artifacts) {
    if (byId.has(artifact.id)) {
      throw new Error(`Duplicate context resolution candidate id "${artifact.id}"`)
    }
    byId.set(artifact.id, artifact)
  }

  for (const artifact of artifacts) {
    for (const targetId of artifact.supersedes) {
      if (targetId === artifact.id) {
        throw new Error(`Context artifact "${artifact.id}" cannot supersede itself`)
      }
      if (!byId.has(targetId)) {
        throw new Error(
          `Context artifact "${artifact.id}" supersedes missing artifact "${targetId}"`,
        )
      }
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      throw new Error(`Context artifact supersession cycle includes "${id}"`)
    }
    if (visited.has(id)) return
    visiting.add(id)
    for (const target of byId.get(id)?.supersedes ?? []) visit(target)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of byId.keys()) visit(id)

  return byId
}

/**
 * Resolves explicit supersession, semantic duplicates, and authority conflicts without I/O.
 * Candidate order is treated as canonical and is retained in the selected/dropped outputs.
 */
export const resolveContextArtifactConflicts = (
  artifacts: readonly ContextArtifact[],
): ContextResolutionResult => {
  assertCandidates(artifacts)
  const droppedReasons = new Map<string, Set<ContextResolutionReasonCode>>()
  const drop = (id: string, reason: ContextResolutionReasonCode): void => {
    const reasons = droppedReasons.get(id) ?? new Set<ContextResolutionReasonCode>()
    reasons.add(reason)
    droppedReasons.set(id, reasons)
  }

  for (const artifact of artifacts) {
    for (const targetId of artifact.supersedes) drop(targetId, 'superseded')
  }

  const notDropped = (): ContextArtifact[] =>
    artifacts.filter((artifact) => !droppedReasons.has(artifact.id))

  for (const group of groupByKey(notDropped(), (artifact) => artifact.dedupeKey).values()) {
    if (group.length < 2) continue
    const [winner, ...duplicates] = [...group].sort(compareWinner)
    if (!winner) continue
    for (const duplicate of duplicates) drop(duplicate.id, 'duplicate')
  }

  const conflicts: ContextResolutionConflict[] = []
  for (const group of groupByKey(notDropped(), (artifact) => artifact.conflictKey).values()) {
    if (group.length < 2) continue
    const highestRank = Math.max(...group.map((artifact) => AUTHORITY_RANK[artifact.authority]))
    const winners = group
      .filter((artifact) => AUTHORITY_RANK[artifact.authority] === highestRank)
      .sort(compareWinner)
    const losers = group
      .filter((artifact) => AUTHORITY_RANK[artifact.authority] < highestRank)
      .sort(compareWinner)

    for (const loser of losers) drop(loser.id, 'conflict_lower_authority')
    if (losers.length > 0) {
      conflicts.push(
        Object.freeze({
          losers: Object.freeze(losers),
          reasonCodes: Object.freeze(['conflict_lower_authority'] as const),
          winners: Object.freeze(winners),
        }),
      )
    }
  }

  return Object.freeze({
    conflicts: Object.freeze(conflicts),
    dropped: Object.freeze(
      artifacts.flatMap((artifact) => {
        const reasons = droppedReasons.get(artifact.id)
        return reasons
          ? [
              Object.freeze({
                artifact,
                reasonCodes: Object.freeze([...reasons].sort()),
              }),
            ]
          : []
      }),
    ),
    selected: Object.freeze(artifacts.filter((artifact) => !droppedReasons.has(artifact.id))),
  })
}
