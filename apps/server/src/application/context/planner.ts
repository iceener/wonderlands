import type { ContextPlanningBudget } from './budget'
import type { ContextArtifact, ContextArtifactRequirement, ContextAuthority } from './contracts'

export interface ContextPlanDrop {
  readonly artifact: ContextArtifact
  readonly reasonCodes: readonly ['token_budget']
}

export interface ContextPlanSuccess {
  readonly dropped: readonly ContextPlanDrop[]
  readonly outcome: 'planned'
  readonly selected: readonly ContextArtifact[]
  readonly selectedTokens: number
}

export interface ContextPlanCapacityError {
  readonly availableTokens: number
  readonly mandatoryArtifacts: readonly ContextArtifact[]
  readonly outcome: 'capacity_error'
  readonly requiredTokens: number
}

export type ContextPlanResult = ContextPlanSuccess | ContextPlanCapacityError

export interface PlanContextArtifactsOptions {
  /** Injected ISO time used only for deterministic freshness scoring. */
  readonly now: string
}

const REQUIREMENT_SCORE: Readonly<Record<ContextArtifactRequirement, number>> = Object.freeze({
  mandatory: 3_000_000,
  preferred: 2_000_000,
  optional: 1_000_000,
})

const AUTHORITY_SCORE: Readonly<Record<ContextAuthority, number>> = Object.freeze({
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

const parseTimestamp = (value: string, field: string): number => {
  const result = Date.parse(value)
  if (!Number.isFinite(result)) throw new Error(`${field} must be a valid ISO timestamp`)
  return result
}

const assertBudget = (budget: ContextPlanningBudget): void => {
  for (const [field, value] of Object.entries(budget)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Context planning budget ${field} must be a non-negative safe integer`)
    }
  }
  const expected = Math.max(
    0,
    budget.inputTokenLimit - budget.reservedOutputTokens - budget.providerOverheadTokens,
  )
  if (budget.availableInputTokens !== expected) {
    throw new Error('Context planning budget availableInputTokens is inconsistent')
  }
}

const assertArtifacts = (artifacts: readonly ContextArtifact[]): void => {
  const ids = new Set<string>()
  for (const artifact of artifacts) {
    if (ids.has(artifact.id))
      throw new Error(`Duplicate context planning artifact "${artifact.id}"`)
    ids.add(artifact.id)
    if (!Number.isSafeInteger(artifact.estimatedTokens) || artifact.estimatedTokens < 0) {
      throw new Error(`Context artifact "${artifact.id}" has invalid estimatedTokens`)
    }
    if (!Number.isFinite(artifact.priority)) {
      throw new Error(`Context artifact "${artifact.id}" has invalid priority`)
    }
  }
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const utility = (artifact: ContextArtifact, nowMs: number): number => {
  const capturedAt = parseTimestamp(artifact.capturedAt, `capturedAt for ${artifact.id}`)
  const ageMinutes = Math.max(0, Math.floor((nowMs - capturedAt) / 60_000))
  const freshness = Math.max(0, 100_000 - Math.min(ageMinutes, 100_000))
  const boundedPriority = Math.max(-100_000, Math.min(100_000, Math.trunc(artifact.priority)))
  const tokenPenalty = Math.min(artifact.estimatedTokens, 1_000_000)

  return (
    REQUIREMENT_SCORE[artifact.requirement] +
    AUTHORITY_SCORE[artifact.authority] * 10_000 +
    boundedPriority * 10 +
    freshness -
    tokenPenalty
  )
}

/**
 * Selects candidates greedily by deterministic utility, then restores canonical input order.
 * Transformations are intentionally not executed in v1; a future transformer can produce new
 * candidate artifacts before this function is called.
 */
export const planContextArtifacts = (
  artifacts: readonly ContextArtifact[],
  budget: ContextPlanningBudget,
  options: PlanContextArtifactsOptions,
): ContextPlanResult => {
  assertBudget(budget)
  assertArtifacts(artifacts)
  const nowMs = parseTimestamp(options.now, 'now')
  const mandatory = artifacts.filter((artifact) => artifact.requirement === 'mandatory')
  const mandatoryTokens = mandatory.reduce((total, artifact) => total + artifact.estimatedTokens, 0)

  if (mandatoryTokens > budget.availableInputTokens) {
    return Object.freeze({
      availableTokens: budget.availableInputTokens,
      mandatoryArtifacts: Object.freeze(mandatory),
      outcome: 'capacity_error',
      requiredTokens: mandatoryTokens,
    })
  }

  const selectedIds = new Set(mandatory.map((artifact) => artifact.id))
  let selectedTokens = mandatoryTokens
  const ranked = artifacts
    .filter((artifact) => artifact.requirement !== 'mandatory')
    .map((artifact) => ({ artifact, utility: utility(artifact, nowMs) }))
    .sort((left, right) => {
      const score = right.utility - left.utility
      return score !== 0 ? score : compareText(left.artifact.id, right.artifact.id)
    })

  for (const { artifact } of ranked) {
    if (selectedTokens + artifact.estimatedTokens <= budget.availableInputTokens) {
      selectedIds.add(artifact.id)
      selectedTokens += artifact.estimatedTokens
    }
  }

  return Object.freeze({
    dropped: Object.freeze(
      artifacts.flatMap((artifact) =>
        selectedIds.has(artifact.id)
          ? []
          : [Object.freeze({ artifact, reasonCodes: Object.freeze(['token_budget'] as const) })],
      ),
    ),
    outcome: 'planned',
    selected: Object.freeze(artifacts.filter((artifact) => selectedIds.has(artifact.id))),
    selectedTokens,
  })
}
