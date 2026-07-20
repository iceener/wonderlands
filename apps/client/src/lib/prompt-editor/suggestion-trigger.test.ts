import { describe, expect, it } from 'vitest'

import { isTextBoundaryPrefix } from './suggestion-trigger'

describe('slash command trigger boundaries', () => {
  it.each([
    '',
    ' ',
    'hello ',
    'hello\n',
    '\t',
  ])('allows slash commands after a text boundary: %j', (prefix) => {
    expect(isTextBoundaryPrefix(prefix)).toBe(true)
  })

  it.each([
    '#apps',
    '#apps/server',
    'https:/',
    'src',
    '.',
    '~',
  ])('keeps slash literal inside paths and URLs: %j', (prefix) => {
    expect(isTextBoundaryPrefix(prefix)).toBe(false)
  })
})
