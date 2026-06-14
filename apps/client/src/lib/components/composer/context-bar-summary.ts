export interface ContextBarUsageBudget {
  actualInputTokens: number | null
  actualOutputTokens: number | null
  cachedInputTokens: number | null
}

export const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

export const buildLastCallSummary = (budget: ContextBarUsageBudget | null): string | null => {
  if (!budget) {
    return null
  }

  if (
    typeof budget.actualInputTokens !== 'number' &&
    typeof budget.actualOutputTokens !== 'number'
  ) {
    return null
  }

  const segments = [
    typeof budget.actualInputTokens === 'number'
      ? `${formatTokens(budget.actualInputTokens)} in`
      : null,
    typeof budget.actualOutputTokens === 'number'
      ? `${formatTokens(budget.actualOutputTokens)} out`
      : null,
    typeof budget.cachedInputTokens === 'number' && budget.cachedInputTokens > 0
      ? `${formatTokens(budget.cachedInputTokens)} cache hit`
      : null,
  ].filter((value): value is string => value !== null)

  return segments.length > 0 ? `Last call: ${segments.join(' / ')}` : null
}
