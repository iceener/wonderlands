import { describe, expect, test } from 'vitest'

import { shouldRearmDeferredTypewriter } from './text-block-typewriter'

describe('shouldRearmDeferredTypewriter', () => {
  test('re-arms a fresh block that was revealed before typewriter could start', () => {
    expect(
      shouldRearmDeferredTypewriter({
        completeFired: false,
        contentLength: 24,
        displayedLength: 24,
        shouldTypewrite: true,
        started: false,
        windowActive: true,
      }),
    ).toBe(true)
  })

  test('does not re-arm after animation has already started', () => {
    expect(
      shouldRearmDeferredTypewriter({
        completeFired: false,
        contentLength: 24,
        displayedLength: 24,
        shouldTypewrite: true,
        started: true,
        windowActive: true,
      }),
    ).toBe(false)
  })

  test('does not re-arm completed or intentionally non-typewritten blocks', () => {
    expect(
      shouldRearmDeferredTypewriter({
        completeFired: true,
        contentLength: 24,
        displayedLength: 24,
        shouldTypewrite: true,
        started: false,
        windowActive: true,
      }),
    ).toBe(false)

    expect(
      shouldRearmDeferredTypewriter({
        completeFired: false,
        contentLength: 24,
        displayedLength: 24,
        shouldTypewrite: false,
        started: false,
        windowActive: true,
      }),
    ).toBe(false)

    expect(
      shouldRearmDeferredTypewriter({
        completeFired: false,
        contentLength: 24,
        displayedLength: 24,
        shouldTypewrite: true,
        started: false,
        windowActive: false,
      }),
    ).toBe(false)
  })
})
