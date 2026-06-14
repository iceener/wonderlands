import { describe, expect, test } from 'vitest'
import { getMessageListSurface } from './message-list-state'

describe('getMessageListSurface', () => {
  test('shows the skeleton only during the initial hydration while the thread is empty', () => {
    expect(
      getMessageListSurface({
        initialHydrationPending: true,
        isLoading: true,
        messageCount: 0,
      }),
    ).toBe('skeleton')
  })

  test('shows the empty state for later empty-thread loads instead of replaying the initial skeleton', () => {
    expect(
      getMessageListSurface({
        initialHydrationPending: false,
        isLoading: true,
        messageCount: 0,
      }),
    ).toBe('empty')
  })

  test('shows the thread whenever messages are present regardless of loading state', () => {
    expect(
      getMessageListSurface({
        initialHydrationPending: true,
        isLoading: true,
        messageCount: 3,
      }),
    ).toBe('thread')
  })
})
