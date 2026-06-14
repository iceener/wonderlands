import { describe, expect, test } from 'vitest'

import { buildLastCallSummary, formatTokens } from './context-bar-summary'

describe('context-bar-summary', () => {
  test('formats token counts for compact display', () => {
    expect(formatTokens(18)).toBe('18')
    expect(formatTokens(6_000)).toBe('6k')
    expect(formatTokens(1_000_000)).toBe('1.0M')
  })

  test('includes prompt cache hits in the last call summary when present', () => {
    expect(
      buildLastCallSummary({
        actualInputTokens: 20_000,
        actualOutputTokens: 18,
        cachedInputTokens: 14_000,
      }),
    ).toBe('Last call: 20k in / 18 out / 14k cache hit')
  })

  test('omits the cache segment when there was no cache hit', () => {
    expect(
      buildLastCallSummary({
        actualInputTokens: 4_100,
        actualOutputTokens: 7,
        cachedInputTokens: 0,
      }),
    ).toBe('Last call: 4k in / 7 out')
  })

  test('returns null when no actual usage is available', () => {
    expect(
      buildLastCallSummary({
        actualInputTokens: null,
        actualOutputTokens: null,
        cachedInputTokens: 120,
      }),
    ).toBeNull()
  })
})
