import { describe, expect, test } from 'vitest'
import { hasIncompleteCodeFence, repairIncompleteMarkdown } from './incomplete-markdown'

describe('hasIncompleteCodeFence', () => {
  test('detects an opening fence without a matching close', () => {
    expect(hasIncompleteCodeFence('```ts\nconst x = 1')).toBe(true)
  })

  test('treats a matching closing fence with the same marker as complete', () => {
    expect(hasIncompleteCodeFence('```ts\nconst x = 1\n```')).toBe(false)
    expect(hasIncompleteCodeFence('~~~md\nhello\n~~~')).toBe(false)
  })

  test('keeps the fence open when the closing marker uses the wrong character', () => {
    expect(hasIncompleteCodeFence('```ts\nconst x = 1\n~~~')).toBe(true)
  })
})

describe('repairIncompleteMarkdown', () => {
  test('closes an incomplete fenced code block', () => {
    expect(repairIncompleteMarkdown('```ts\nconst x = 1')).toBe('```ts\nconst x = 1\n```')
  })

  test('adds a zero-width space after trailing emphasis in ordered list items', () => {
    expect(repairIncompleteMarkdown('1. *')).toBe(`1. *\u200B`)
    expect(repairIncompleteMarkdown('2. **')).toBe(`2. **\u200B`)
  })

  test('leaves already-complete markdown unchanged', () => {
    const markdown = '1. **done**\n\n```ts\nconst x = 1\n```'
    expect(repairIncompleteMarkdown(markdown)).toBe(markdown)
  })
})
