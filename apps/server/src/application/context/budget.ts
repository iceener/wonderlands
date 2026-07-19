export interface ContextPlanningBudget {
  /** Input tokens left after output reservation and provider wrapper overhead. */
  readonly availableInputTokens: number
  readonly inputTokenLimit: number
  /** Wrapper/protocol overhead only; tool/request artifacts are already candidate costs. */
  readonly providerOverheadTokens: number
  readonly reservedOutputTokens: number
}

export interface CreateContextPlanningBudgetInput {
  readonly inputTokenLimit: number
  readonly providerOverheadTokens?: number
  readonly reservedOutputTokens?: number
}

const assertTokens = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
}

/**
 * Request-control artifacts already include tools/native tools/options. Callers must pass only
 * provider wrapper/protocol cost as `providerOverheadTokens` to avoid double counting them.
 */
export const createContextPlanningBudget = (
  input: CreateContextPlanningBudgetInput,
): ContextPlanningBudget => {
  const reservedOutputTokens = input.reservedOutputTokens ?? 0
  const providerOverheadTokens = input.providerOverheadTokens ?? 0
  assertTokens(input.inputTokenLimit, 'inputTokenLimit')
  assertTokens(reservedOutputTokens, 'reservedOutputTokens')
  assertTokens(providerOverheadTokens, 'providerOverheadTokens')

  return Object.freeze({
    availableInputTokens: Math.max(
      0,
      input.inputTokenLimit - reservedOutputTokens - providerOverheadTokens,
    ),
    inputTokenLimit: input.inputTokenLimit,
    providerOverheadTokens,
    reservedOutputTokens,
  })
}
