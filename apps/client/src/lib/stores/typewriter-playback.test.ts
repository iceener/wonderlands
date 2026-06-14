import { describe, expect, test } from 'vitest'
import { createTypewriterPlaybackStore } from './typewriter-playback.svelte.js'

describe('typewriterPlayback', () => {
  test('tracks pending keys without duplicating them', () => {
    const store = createTypewriterPlaybackStore()

    store.setPending('live:run_1', true)
    store.setPending('live:run_1', true)
    store.setPending('live:run_2', true)

    expect(store.hasPending).toBe(true)
    expect(store.pendingKeys).toEqual(['live:run_1', 'live:run_2'])
  })

  test('clears pending keys individually and wholesale', () => {
    const store = createTypewriterPlaybackStore()

    store.setPending('live:run_1', true)
    store.setPending('live:run_2', true)
    store.clear('live:run_1')

    expect(store.pendingKeys).toEqual(['live:run_2'])
    expect(store.hasPending).toBe(true)

    store.clearAll()

    expect(store.pendingKeys).toEqual([])
    expect(store.hasPending).toBe(false)
  })

  test('can query pending state for a specific visual message key', () => {
    const store = createTypewriterPlaybackStore()

    store.setPending('live:run_1', true)

    expect(store.hasPendingKey('live:run_1')).toBe(true)
    expect(store.hasPendingKey('live:run_2')).toBe(false)

    store.setPending('live:run_1', false)

    expect(store.hasPendingKey('live:run_1')).toBe(false)
  })
})
