import { describe, expect, test } from 'vitest'
import { searchCommands } from './search'
import type { CommandItem } from './types'

const item = (overrides: Partial<CommandItem> & { id: string; label: string }): CommandItem => ({
  group: 'Test',
  keywords: [],
  enabled: () => true,
  run: () => {},
  ...overrides,
})

const items: CommandItem[] = [
  item({ id: 'prefix', label: 'Alpha Tool', keywords: ['first'] }),
  item({ id: 'middle', label: 'Use Alpha Later' }),
  item({ id: 'keyword', label: 'Unrelated', keywords: ['alpha'] }),
  item({ id: 'disabled', label: 'Alpha Disabled', enabled: () => false }),
]

describe('searchCommands', () => {
  test('returns only enabled items for blank and unmatched queries', () => {
    const blank = searchCommands('   ', items)

    expect(blank.map(({ item: result }) => result.id)).toEqual(['prefix', 'middle', 'keyword'])
    expect(blank.every(({ matchRanges, score }) => score === 0 && matchRanges.length === 0)).toBe(
      true,
    )
    expect(searchCommands('no-match', items)).toEqual([])
  })

  test('ranks prefix, substring, and keyword matches while preserving highlight ranges', () => {
    const results = searchCommands('  ALPHA ', items)

    expect(results.map(({ item: result }) => result.id)).toEqual(['prefix', 'middle', 'keyword'])
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score)
    expect(results[1]!.score).toBeGreaterThan(results[2]!.score)
    expect(results.some(({ item: result }) => result.id === 'disabled')).toBe(false)

    for (const result of results.slice(0, 2)) {
      const range = result.matchRanges[0]!
      expect(result.item.label.slice(range.start, range.end).toLowerCase()).toBe('alpha')
    }
    expect(results[2]!.matchRanges).toEqual([])
  })
})
