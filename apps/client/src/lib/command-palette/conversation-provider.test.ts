import { asSessionId, asThreadId, type BackendThread } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { createConversationProvider } from './conversation-provider.svelte.ts'

const createThread = (id: string, title: string, updatedAt: string): BackendThread => ({
  createdAt: '2026-03-29T12:00:00.000Z',
  createdByAccountId: 'acc_adam_overment',
  id: asThreadId(id),
  parentThreadId: null,
  sessionId: asSessionId(`ses_${id}`),
  status: 'active',
  tenantId: 'ten_overment',
  title,
  updatedAt,
})

describe('createConversationProvider', () => {
  test('keeps the previous results visible while the next query is still loading', async () => {
    let resolveSearch: ((threads: BackendThread[]) => void) | null = null

    const provider = createConversationProvider({
      currentThreadId: () => null,
      listThreads: async (options) => {
        if (!options?.query) {
          return [createThread('thr_recent', 'Recent thread', '2026-03-29T12:00:00.000Z')]
        }

        return await new Promise<BackendThread[]>((resolve) => {
          resolveSearch = resolve
        })
      },
      onSwitchThread: () => undefined,
    })

    provider.onQueryChange?.('')
    await Promise.resolve()
    await Promise.resolve()

    expect(provider.getItems('').map((result) => result.item.label)).toEqual(['Recent thread'])

    provider.onQueryChange?.('zebra')

    expect(provider.getItems('zebra').map((result) => result.item.label)).toEqual(['Recent thread'])

    resolveSearch?.([createThread('thr_match', 'Zebra deployment', '2026-03-30T12:00:00.000Z')])
    await Promise.resolve()
    await Promise.resolve()

    expect(provider.getItems('zebra').map((result) => result.item.label)).toEqual([
      'Zebra deployment',
    ])
  })

  test('keeps getItems as a pure read until the query hook requests data', async () => {
    let listCalls = 0

    const provider = createConversationProvider({
      currentThreadId: () => asThreadId('thr_1'),
      listThreads: async () => {
        listCalls += 1
        return [createThread('thr_1', 'First thread', '2026-03-29T12:00:00.000Z')]
      },
      onSwitchThread: () => undefined,
    })

    expect(provider.getItems('')).toEqual([])
    expect(listCalls).toBe(0)

    provider.onQueryChange?.('')
    await Promise.resolve()
    await Promise.resolve()

    expect(provider.getItems('')).toHaveLength(1)
    expect(listCalls).toBe(1)
  })

  test('loads recent threads once and reuses the cached empty-query results', async () => {
    let listCalls = 0

    const provider = createConversationProvider({
      currentThreadId: () => asThreadId('thr_1'),
      listThreads: async (options) => {
        listCalls += 1
        expect(options?.query).toBeUndefined()
        return [
          createThread('thr_1', 'First thread', '2026-03-29T12:00:00.000Z'),
          createThread('thr_2', 'Second thread', '2026-03-30T12:00:00.000Z'),
        ]
      },
      onSwitchThread: () => undefined,
    })

    provider.onQueryChange?.('')
    await Promise.resolve()
    await Promise.resolve()

    const results = provider.getItems('')

    expect(listCalls).toBe(1)
    expect(results).toHaveLength(2)
    expect(results.map((result) => result.item.id)).toEqual(['thr_1', 'thr_2'])
  })

  test('marks the current thread in the provider label', async () => {
    const provider = createConversationProvider({
      currentThreadId: () => asThreadId('thr_1'),
      listThreads: async () => [createThread('thr_1', 'First thread', '2026-03-29T12:00:00.000Z')],
      onSwitchThread: () => undefined,
    })

    provider.onQueryChange?.('')
    await Promise.resolve()
    await Promise.resolve()

    const results = provider.getItems('')

    expect(results[0]?.item.label).toBe('Current: First thread')
  })

  test('clears the cache on dismiss so the next open refetches threads', async () => {
    let listCalls = 0

    const provider = createConversationProvider({
      currentThreadId: () => null,
      listThreads: async () => {
        listCalls += 1
        return [createThread('thr_1', 'First thread', '2026-03-29T12:00:00.000Z')]
      },
      onSwitchThread: () => undefined,
    })

    provider.onQueryChange?.('')
    await Promise.resolve()
    await Promise.resolve()
    provider.onDismiss?.()

    provider.onQueryChange?.('')
    await Promise.resolve()
    await Promise.resolve()

    expect(listCalls).toBe(2)
  })

  test('keeps backend search results even when the title does not match the query text', async () => {
    const queries: Array<string | undefined> = []

    const provider = createConversationProvider({
      currentThreadId: () => null,
      listThreads: async (options) => {
        queries.push(options?.query)
        return [createThread('thr_fts', 'Weekly notes', '2026-03-30T12:00:00.000Z')]
      },
      onSwitchThread: () => undefined,
    })

    provider.onQueryChange?.('postgres')
    await Promise.resolve()
    await Promise.resolve()

    const results = provider.getItems('postgres')

    expect(queries).toEqual(['postgres'])
    expect(results).toHaveLength(1)
    expect(results[0]?.item.id).toBe('thr_fts')
    expect(results[0]?.item.label).toBe('Weekly notes')
  })
})
