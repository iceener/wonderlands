import { afterEach, describe, expect, test } from 'vitest'
import { createBackgroundActivityStore } from './background-activity.svelte.ts'

const originalDocument = (globalThis as Record<string, unknown>).document
const originalFetch = globalThis.fetch
const originalLocalStorage = (globalThis as Record<string, unknown>).localStorage

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const createDocumentMock = () => ({
  addEventListener: () => undefined,
  hidden: false,
  removeEventListener: () => undefined,
})

const createStorage = (initialEntries: Array<[string, string]> = []) => {
  const values = new Map(initialEntries)

  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
  ;(globalThis as Record<string, unknown>).document = originalDocument
  ;(globalThis as Record<string, unknown>).localStorage = originalLocalStorage
})

describe('createBackgroundActivityStore', () => {
  test('ignores legacy local dismissal state and trusts the server response', async () => {
    ;(globalThis as Record<string, unknown>).document = createDocumentMock()
    ;(globalThis as Record<string, unknown>).localStorage = createStorage([
      ['bg-activity-dismissed', JSON.stringify(['thr_completed'])],
    ])

    const requests: Array<{ init?: RequestInit; url: string }> = []
    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })

      return new Response(
        JSON.stringify({
          data: {
            threads: [
              {
                activity: {
                  completedAt: '2026-04-06T10:00:00.000Z',
                  label: 'Done',
                  state: 'completed',
                  updatedAt: '2026-04-06T10:00:00.000Z',
                },
                id: 'thr_completed',
                title: 'Completed thread',
              },
            ],
          },
          meta: { requestId: 'req_activity', traceId: 'trace_activity' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    const store = createBackgroundActivityStore({
      currentThreadId: () => null,
      sessionId: () => 'session_1',
    })

    store.start()
    await flush()

    try {
      expect(store.threads).toEqual([
        {
          id: 'thr_completed',
          label: 'Done',
          state: 'completed',
          title: 'Completed thread',
        },
      ])
      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe('/api/threads/activity')
    } finally {
      store.stop()
    }
  })

  test('marks an open completed thread as seen and keeps it out of the bar', async () => {
    ;(globalThis as Record<string, unknown>).document = createDocumentMock()
    ;(globalThis as Record<string, unknown>).localStorage = createStorage()

    const requests: Array<{ init?: RequestInit; url: string }> = []
    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })

      if (String(url) === '/api/threads/activity') {
        return new Response(
          JSON.stringify({
            data: {
              threads: [
                {
                  activity: {
                    completedAt: '2026-04-06T10:00:00.000Z',
                    label: 'Done',
                    state: 'completed',
                    updatedAt: '2026-04-06T10:00:00.000Z',
                  },
                  id: 'thr_current',
                  title: 'Current thread',
                },
                {
                  activity: {
                    completedAt: null,
                    label: 'Running',
                    state: 'running',
                    updatedAt: '2026-04-06T10:01:00.000Z',
                  },
                  id: 'thr_running',
                  title: 'Running thread',
                },
              ],
            },
            meta: { requestId: 'req_activity', traceId: 'trace_activity' },
            ok: true,
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200,
          },
        )
      }

      if (String(url) === '/api/threads/thr_current/activity/seen') {
        return new Response(null, {
          status: 204,
        })
      }

      throw new Error(`Unexpected request: ${String(url)}`)
    }) as typeof fetch

    const store = createBackgroundActivityStore({
      currentThreadId: () => 'thr_current',
      sessionId: () => 'session_1',
    })

    store.start()
    await flush()

    try {
      expect(store.threads).toEqual([
        {
          id: 'thr_running',
          label: 'Running',
          state: 'running',
          title: 'Running thread',
        },
      ])
      expect(requests.map((request) => request.url)).toEqual([
        '/api/threads/activity',
        '/api/threads/thr_current/activity/seen',
      ])
      expect(requests[1]?.init).toMatchObject({
        credentials: 'include',
        method: 'POST',
      })
    } finally {
      store.stop()
    }
  })

  test('marks an open failed thread as seen and keeps it out of the bar', async () => {
    ;(globalThis as Record<string, unknown>).document = createDocumentMock()
    ;(globalThis as Record<string, unknown>).localStorage = createStorage()

    const requests: Array<{ init?: RequestInit; url: string }> = []
    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })

      if (String(url) === '/api/threads/activity') {
        return new Response(
          JSON.stringify({
            data: {
              threads: [
                {
                  activity: {
                    completedAt: null,
                    label: 'Failed',
                    state: 'failed',
                    updatedAt: '2026-04-06T10:00:00.000Z',
                  },
                  id: 'thr_current',
                  title: 'Current failed thread',
                },
                {
                  activity: {
                    completedAt: null,
                    label: 'Running',
                    state: 'running',
                    updatedAt: '2026-04-06T10:01:00.000Z',
                  },
                  id: 'thr_running',
                  title: 'Running thread',
                },
              ],
            },
            meta: { requestId: 'req_activity', traceId: 'trace_activity' },
            ok: true,
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200,
          },
        )
      }

      if (String(url) === '/api/threads/thr_current/activity/seen') {
        return new Response(null, {
          status: 204,
        })
      }

      throw new Error(`Unexpected request: ${String(url)}`)
    }) as typeof fetch

    const store = createBackgroundActivityStore({
      currentThreadId: () => 'thr_current',
      sessionId: () => 'session_1',
    })

    store.start()
    await flush()

    try {
      expect(store.threads).toEqual([
        {
          id: 'thr_running',
          label: 'Running',
          state: 'running',
          title: 'Running thread',
        },
      ])
      expect(requests.map((request) => request.url)).toEqual([
        '/api/threads/activity',
        '/api/threads/thr_current/activity/seen',
      ])
      expect(requests[1]?.init).toMatchObject({
        credentials: 'include',
        method: 'POST',
      })
    } finally {
      store.stop()
    }
  })

  test('reprojects immediately when the current thread changes between polls', async () => {
    ;(globalThis as Record<string, unknown>).document = createDocumentMock()
    ;(globalThis as Record<string, unknown>).localStorage = createStorage()

    let currentThreadId: string | null = 'thr_alpha'
    const requests: Array<{ init?: RequestInit; url: string }> = []

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })

      if (String(url) !== '/api/threads/activity') {
        throw new Error(`Unexpected request: ${String(url)}`)
      }

      return new Response(
        JSON.stringify({
          data: {
            threads: [
              {
                activity: {
                  completedAt: null,
                  label: 'Running',
                  state: 'running',
                  updatedAt: '2026-04-06T10:00:00.000Z',
                },
                id: 'thr_alpha',
                title: 'Alpha',
              },
              {
                activity: {
                  completedAt: null,
                  label: 'Running',
                  state: 'running',
                  updatedAt: '2026-04-06T10:01:00.000Z',
                },
                id: 'thr_beta',
                title: 'Beta',
              },
            ],
          },
          meta: { requestId: 'req_activity', traceId: 'trace_activity' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      )
    }) as typeof fetch

    const store = createBackgroundActivityStore({
      currentThreadId: () => currentThreadId,
      sessionId: () => 'session_1',
    })

    store.start()
    await flush()

    try {
      expect(store.threads).toEqual([
        {
          id: 'thr_beta',
          label: 'Running',
          state: 'running',
          title: 'Beta',
        },
      ])

      currentThreadId = 'thr_beta'
      store.syncCurrentThread()

      expect(store.threads).toEqual([
        {
          id: 'thr_alpha',
          label: 'Running',
          state: 'running',
          title: 'Alpha',
        },
      ])
      expect(requests).toHaveLength(1)
    } finally {
      store.stop()
    }
  })
})
