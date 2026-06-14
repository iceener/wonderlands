import type { BackendUsage } from '@wonderlands/contracts/chat'
import type { ThreadBudgetSnapshot } from '../../services/api'
import type { ContextBudget } from '../types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const estimateTextTokens = (text: string): number => {
  const normalized = text.trim()

  if (normalized.length === 0) {
    return 0
  }

  return Math.max(1, Math.ceil(normalized.length / 4))
}

const toNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export const parseUsage = (
  value: BackendUsage | Record<string, unknown> | null | undefined,
): {
  cachedTokens: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  totalTokens: number | null
} | null => {
  if (!value || !isRecord(value)) {
    return null
  }

  return {
    cachedTokens: toNumberOrNull(value.cachedTokens),
    inputTokens: toNumberOrNull(value.inputTokens),
    outputTokens: toNumberOrNull(value.outputTokens),
    reasoningTokens: toNumberOrNull(value.reasoningTokens),
    totalTokens: toNumberOrNull(value.totalTokens),
  }
}

export const toContextBudget = (budget: ThreadBudgetSnapshot): ContextBudget => ({
  actualInputTokens: budget.actualInputTokens,
  actualOutputTokens: budget.actualOutputTokens,
  actualTotalTokens: budget.actualTotalTokens,
  cachedInputTokens: budget.cachedInputTokens,
  contextWindow: budget.contextWindow,
  estimatedInputTokens: budget.estimatedInputTokens,
  liveOutputTokens: 0,
  liveOutputText: '',
  measuredAt: budget.measuredAt,
  model: budget.model,
  provider: budget.provider,
  reasoningTokens: budget.reasoningTokens,
  reservedOutputTokens: budget.reservedOutputTokens,
  stablePrefixTokens: budget.stablePrefixTokens,
  turn: budget.turn,
  volatileSuffixTokens: budget.volatileSuffixTokens,
})

export const withStreamingBudgetStart = (
  budget: ContextBudget | null,
  input: {
    estimatedInputTokens: number
    reservedOutputTokens: number | null
    stablePrefixTokens: number | null
    turn: number | null
    volatileSuffixTokens: number | null
  },
): ContextBudget => ({
  actualInputTokens: null,
  actualOutputTokens: null,
  actualTotalTokens: null,
  cachedInputTokens: null,
  contextWindow: budget?.contextWindow ?? null,
  estimatedInputTokens: input.estimatedInputTokens,
  liveOutputTokens: 0,
  liveOutputText: '',
  measuredAt: null,
  model: budget?.model ?? null,
  provider: budget?.provider ?? null,
  reasoningTokens: null,
  reservedOutputTokens: input.reservedOutputTokens,
  stablePrefixTokens: input.stablePrefixTokens,
  turn: input.turn,
  volatileSuffixTokens: input.volatileSuffixTokens,
})

export const withEstimatedOutputDelta = (
  budget: ContextBudget | null,
  delta: string,
): ContextBudget | null => {
  if (!budget) {
    return null
  }

  const liveOutputText = budget.liveOutputText + delta

  return {
    ...budget,
    liveOutputText,
    liveOutputTokens: estimateTextTokens(liveOutputText),
  }
}

export const withReconciledUsage = (
  budget: ContextBudget | null,
  usage: ReturnType<typeof parseUsage>,
  measuredAt: string,
  model: string | null,
  provider: string | null,
  fallbackOutputText: string,
): ContextBudget | null => {
  if (!budget) {
    return null
  }

  const actualOutputTokens = usage?.outputTokens ?? estimateTextTokens(fallbackOutputText)

  return {
    ...budget,
    actualInputTokens: usage?.inputTokens ?? null,
    actualOutputTokens,
    actualTotalTokens: usage?.totalTokens ?? null,
    cachedInputTokens: usage?.cachedTokens ?? null,
    liveOutputTokens: actualOutputTokens,
    liveOutputText: fallbackOutputText,
    measuredAt,
    model: model ?? budget.model,
    provider: provider ?? budget.provider,
    reasoningTokens: usage?.reasoningTokens ?? null,
  }
}
