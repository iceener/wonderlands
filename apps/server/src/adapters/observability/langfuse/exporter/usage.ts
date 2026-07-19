import type { UsageDetails } from '@langfuse/core'

import { isRecord } from '../../../../domain/ai/json-utils'
import { asNumber, toNumericRecord } from './normalization'
import type { EventPayload } from './types'

export const normalizeUsageKey = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')

export const findUsageValue = (
  usage: EventPayload,
  candidates: readonly string[],
): number | null => {
  for (const key of candidates) {
    const entry = asNumber(usage[key])

    if (entry !== null) {
      return entry
    }
  }

  return null
}

export const collectUsageDetails = (
  usage: EventPayload,
  prefix: 'input' | 'output',
  candidates: readonly string[],
): Record<string, number> => {
  const details: Record<string, number> = {}

  for (const key of candidates) {
    const value = usage[key]

    if (!isRecord(value)) {
      continue
    }

    for (const [detailKey, detailValue] of Object.entries(value)) {
      const numericValue = asNumber(detailValue)

      if (numericValue === null) {
        continue
      }

      const normalizedDetailKey = normalizeUsageKey(detailKey)

      if (normalizedDetailKey.length === 0) {
        continue
      }

      details[`${prefix}_${normalizedDetailKey}`] = numericValue
    }
  }

  return details
}

export const toCanonicalUsageKey = (key: string): string | null => {
  const normalizedKey = normalizeUsageKey(key)

  if (normalizedKey.length === 0) {
    return null
  }

  if (
    normalizedKey === 'input' ||
    normalizedKey === 'input_tokens' ||
    normalizedKey === 'prompt_tokens'
  ) {
    return 'input'
  }

  if (
    normalizedKey === 'output' ||
    normalizedKey === 'output_tokens' ||
    normalizedKey === 'completion_tokens'
  ) {
    return 'output'
  }

  if (normalizedKey === 'total' || normalizedKey === 'total_tokens') {
    return 'total'
  }

  if (normalizedKey === 'cached_tokens') {
    return 'input_cached_tokens'
  }

  if (normalizedKey === 'reasoning_tokens') {
    return 'output_reasoning_tokens'
  }

  if (
    normalizedKey === 'input_tokens_details' ||
    normalizedKey === 'output_tokens_details' ||
    normalizedKey === 'prompt_tokens_details' ||
    normalizedKey === 'completion_tokens_details'
  ) {
    return null
  }

  return normalizedKey
}

export const toGenerationUsageDetails = (
  payload: EventPayload | null,
): UsageDetails | undefined => {
  const usage = payload?.usage

  if (!isRecord(usage)) {
    return undefined
  }

  const input = findUsageValue(usage, [
    'input',
    'inputTokens',
    'input_tokens',
    'promptTokens',
    'prompt_tokens',
  ])
  const output = findUsageValue(usage, [
    'output',
    'outputTokens',
    'output_tokens',
    'completionTokens',
    'completion_tokens',
  ])
  const total = findUsageValue(usage, ['total', 'totalTokens', 'total_tokens'])
  const normalizedUsage: Record<string, number> = {
    ...collectUsageDetails(usage, 'input', ['input_tokens_details', 'prompt_tokens_details']),
    ...collectUsageDetails(usage, 'output', ['output_tokens_details', 'completion_tokens_details']),
  }

  for (const [key, value] of Object.entries(usage)) {
    const numericValue = asNumber(value)

    if (numericValue === null) {
      continue
    }

    const canonicalKey = toCanonicalUsageKey(key)

    if (!canonicalKey) {
      continue
    }

    normalizedUsage[canonicalKey] = numericValue
  }

  if (input !== null) {
    normalizedUsage.input = input
  }

  if (output !== null) {
    normalizedUsage.output = output
  }

  if (total !== null) {
    normalizedUsage.total = total
  }

  if (
    normalizedUsage.total === undefined &&
    (normalizedUsage.input !== undefined || normalizedUsage.output !== undefined)
  ) {
    normalizedUsage.total = (normalizedUsage.input ?? 0) + (normalizedUsage.output ?? 0)
  }

  if (normalizedUsage.total === undefined && Object.keys(normalizedUsage).length > 0) {
    normalizedUsage.total = Object.entries(normalizedUsage).reduce(
      (sum, [key, value]) => (key === 'total' ? sum : sum + value),
      0,
    )
  }

  if (Object.keys(normalizedUsage).length > 0) {
    return normalizedUsage
  }

  return toNumericRecord(usage)
}
