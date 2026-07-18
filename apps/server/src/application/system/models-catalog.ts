import type { AppConfig } from '../../app/config'
import type { AppServices } from '../../app/runtime'
import type { AiModelTarget, AiReasoningEffort } from '../../domain/ai/types'

const REASONING_MODES: Array<{ effort: AiReasoningEffort; label: string }> = [
  { effort: 'none', label: 'No reasoning' },
  { effort: 'minimal', label: 'Minimal' },
  { effort: 'low', label: 'Low' },
  { effort: 'medium', label: 'Medium' },
  { effort: 'high', label: 'High' },
  { effort: 'xhigh', label: 'Very high' },
  { effort: 'max', label: 'Maximum' },
]

const GOOGLE_REASONING_MODES: AiReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high']
const OPENAI_REASONING_MODES: AiReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]
const GPT_5_6_SOL_REASONING_MODES: AiReasoningEffort[] = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

/** Known context window sizes (max input tokens) per model prefix. */
const KNOWN_CONTEXT_WINDOWS: Array<[pattern: RegExp, tokens: number]> = [
  [/^openai\/gpt-5/iu, 1_047_576],
  [/^openai\/gpt-4\.1/iu, 1_047_576],
  [/^gpt-5/iu, 1_047_576],
  [/^gpt-4\.1/iu, 1_047_576],
  [/^gpt-4o/iu, 128_000],
  [/^gpt-4-turbo/iu, 128_000],
  [/^o\d/iu, 200_000],
  [/^gemini-3/iu, 1_048_576],
  [/^gemini-2/iu, 1_048_576],
  [/^gemini-1\.5-pro/iu, 2_097_152],
  [/^gemini-1\.5-flash/iu, 1_048_576],
]

const DEFAULT_CONTEXT_WINDOW = 128_000

export const resolveContextWindowForModel = (model: string): number => {
  for (const [pattern, tokens] of KNOWN_CONTEXT_WINDOWS) {
    if (pattern.test(model)) return tokens
  }
  return DEFAULT_CONTEXT_WINDOW
}

const openAiReasoningPattern = /^(openai\/)?(o\d|gpt-5)/iu
const gpt56SolPattern = /^(openai\/)?gpt-5\.6-sol$/iu
const googleReasoningPattern = /^gemini/iu

const getReasoningModesForTarget = (target: AiModelTarget): AiReasoningEffort[] => {
  if (target.provider === 'google' && googleReasoningPattern.test(target.model)) {
    return GOOGLE_REASONING_MODES
  }

  if (
    (target.provider === 'openai' || target.provider === 'openrouter') &&
    gpt56SolPattern.test(target.model)
  ) {
    return GPT_5_6_SOL_REASONING_MODES
  }

  if (
    (target.provider === 'openai' || target.provider === 'openrouter') &&
    openAiReasoningPattern.test(target.model)
  ) {
    return OPENAI_REASONING_MODES
  }

  return []
}

export const buildModelsCatalog = (config: AppConfig, services: AppServices['ai']) => ({
  aliases: Object.entries(services.modelRegistry.aliases).map(([alias, target]) => {
    const reasoningModes = getReasoningModesForTarget(target)

    return {
      alias,
      configured: services.providers[target.provider].configured,
      contextWindow: resolveContextWindowForModel(target.model),
      isDefault: alias === services.modelRegistry.defaultAlias,
      model: target.model,
      provider: target.provider,
      reasoningModes,
      supportsReasoning: reasoningModes.length > 0,
    }
  }),
  defaultAlias: services.modelRegistry.defaultAlias,
  defaultModel: config.ai.defaults.model,
  defaultProvider: config.ai.defaults.provider,
  providers: {
    google: {
      configured: services.providers.google.configured,
      defaultModel: config.ai.providers.google.defaultModel,
    },
    openai: {
      configured: services.providers.openai.configured,
      defaultModel: config.ai.providers.openai.defaultModel,
    },
    openrouter: {
      configured: services.providers.openrouter.configured,
      defaultModel: config.ai.providers.openrouter.defaultModel,
    },
  },
  reasoningModes: REASONING_MODES,
})
