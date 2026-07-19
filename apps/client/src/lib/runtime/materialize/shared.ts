import type { ProviderName } from '@wonderlands/contracts/chat'

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const parseProviderName = (value: unknown): ProviderName =>
  value === 'google' || value === 'openrouter' || value === 'openai' ? value : 'openai'
