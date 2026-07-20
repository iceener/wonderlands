import { asSessionId, asThreadId, type BackendThread } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { createConversationProvider } from './conversation-provider.svelte.ts'

const createThread = (id: string, title = id): BackendThread => ({
  createdAt: '2026-03-29T12:00:00.000Z',
  createdByAccountId: 'acc_test',
  id: asThreadId(id),
  parentThreadId: null,
  sessionId: asSessionId(`ses_${id}`),
  status: 'active',
  tenantId: 'ten_test',
  title,
  updatedAt: '2026-03-30T12:00:00.000Z',
})

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('createConversationProvider', () => {
  test('keeps reads pure, caches each query, and clears the cache on dismiss', async () => {
    const queries: Array<string | undefined> = []
    const provider = createConversationProvider({
      currentThreadId: () => null,
      listThreads: async ({ query } = {}) => {
        queries.push(query)
        return [createThread(query ? `thr_${query}` : 'thr_recent')]
      },
      onSwitchThread: () => undefined,
    })

    expect(provider.getItems('')).toEqual([])
    expect(queries).toEqual([])

    provider.onQueryChange?.('')
    await flush()
    provider.onQueryChange?.('')
    await flush()
    expect(provider.getItems('').map(({ item }) => item.id)).toEqual(['thr_recent'])
    expect(queries).toEqual([undefined])

    provider.onDismiss?.()
    provider.onQueryChange?.('')
    await flush()
    expect(queries).toEqual([undefined, undefined])
  })

  test('keeps previous results while loading and ignores a stale response', async () => {
    const pending = new Map<string, (threads: BackendThread[]) => void>()
    const provider = createConversationProvider({
      currentThreadId: () => null,
      listThreads: ({ query } = {}) =>
        new Promise<BackendThread[]>((resolve) => pending.set(query ?? '', resolve)),
      onSwitchThread: () => undefined,
    })

    provider.onQueryChange?.('')
    pending.get('')?.([createThread('thr_recent')])
    await flush()

    provider.onQueryChange?.('first')
    provider.onQueryChange?.('second')
    expect(provider.getItems('second').map(({ item }) => item.id)).toEqual(['thr_recent'])

    pending.get('first')?.([createThread('thr_stale')])
    await flush()
    expect(provider.getItems('second').map(({ item }) => item.id)).toEqual(['thr_recent'])

    pending.get('second')?.([createThread('thr_latest')])
    await flush()
    expect(provider.getItems('second').map(({ item }) => item.id)).toEqual(['thr_latest'])
  })

  test('retains backend-ranked results and only switches to a non-current thread', async () => {
    const selected: string[] = []
    const provider = createConversationProvider({
      currentThreadId: () => asThreadId('thr_current'),
      listThreads: async () => [
        createThread('thr_current', 'One'),
        createThread('thr_match', 'Title not containing the query'),
      ],
      onSwitchThread: (thread) => selected.push(thread.id),
    })

    provider.onQueryChange?.('backend-only-term')
    await flush()
    const results = provider.getItems('backend-only-term')
    expect(results.map(({ item }) => item.id)).toEqual(['thr_current', 'thr_match'])

    await results[0]?.item.run()
    await results[1]?.item.run()
    expect(selected).toEqual(['thr_match'])
  })
})
