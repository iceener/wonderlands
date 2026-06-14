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
  item({ id: 'new', label: 'New Conversation', group: 'Chat', keywords: ['reset', 'clear'] }),
  item({ id: 'model', label: 'Cycle Model', group: 'Settings', keywords: ['switch', 'gpt'] }),
  item({ id: 'typewriter', label: 'Cycle Typewriter Speed', group: 'Settings' }),
  item({ id: 'disabled', label: 'Disabled Command', enabled: () => false }),
]

describe('searchCommands', () => {
  test('returns all enabled items when query is empty', async () => {
    const results = searchCommands('', items)

    expect(results.length).toBe(3)
    expect(results.every((r) => r.score === 0)).toBe(true)
    expect(results.every((r) => r.matchRanges.length === 0)).toBe(true)
  })

  test('filters out disabled items', async () => {
    const results = searchCommands('', items)
    const ids = results.map((r) => r.item.id)

    expect(ids).not.toContain('disabled')
  })

  test('matches substring in label', async () => {
    const results = searchCommands('cycle', items)

    expect(results.length).toBe(2)
    expect(results[0].item.id).toBe('model')
    expect(results[0].matchRanges.length).toBeGreaterThan(0)
  })

  test('scores start-of-label matches highest', async () => {
    const results = searchCommands('new', items)

    expect(results.length).toBe(1)
    expect(results[0].item.id).toBe('new')
    expect(results[0].score).toBeGreaterThan(50)
  })

  test('matches against keywords when label does not match', async () => {
    const results = searchCommands('gpt', items)

    expect(results.length).toBe(1)
    expect(results[0].item.id).toBe('model')
  })

  test('returns empty array when nothing matches', async () => {
    const results = searchCommands('zzz_no_match', items)

    expect(results.length).toBe(0)
  })

  test('is case insensitive', async () => {
    const results = searchCommands('CYCLE', items)

    expect(results.length).toBe(2)
  })

  test('provides correct match ranges for highlighting', async () => {
    const results = searchCommands('type', items)

    const typewriterResult = results.find((r) => r.item.id === 'typewriter')
    expect(typewriterResult).toBeDefined()

    const range = typewriterResult!.matchRanges[0]
    const label = typewriterResult!.item.label
    expect(label.slice(range.start, range.end).toLowerCase()).toBe('type')
  })

  test('sorts results by score descending', async () => {
    const testItems = [
      item({ id: 'mid', label: 'The Cycle Command' }),
      item({ id: 'start', label: 'Cycle Model' }),
    ]
    const results = searchCommands('cycle', testItems)

    expect(results[0].item.id).toBe('start')
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)
  })

  test('trims whitespace from query', async () => {
    const results = searchCommands('  cycle  ', items)

    expect(results.length).toBe(2)
  })
})
