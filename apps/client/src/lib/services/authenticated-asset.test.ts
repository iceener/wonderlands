import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { fetchAuthenticatedAssetObjectUrl } from './authenticated-asset'
import { setApiTenantId } from './backend'

const originalFetch = globalThis.fetch
const originalCreateObjectUrl = URL.createObjectURL
const originalRevokeObjectUrl = URL.revokeObjectURL

describe('authenticated asset service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setApiTenantId('ten_overment')
    URL.createObjectURL = vi.fn(() => 'blob:asset') as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    vi.useRealTimers()
    setApiTenantId(null)
    globalThis.fetch = originalFetch
    URL.createObjectURL = originalCreateObjectUrl
    URL.revokeObjectURL = originalRevokeObjectUrl
  })

  test('retries transient authenticated asset failures before succeeding', async () => {
    const requests: Array<{ credentials: RequestCredentials | undefined; url: string }> = []

    globalThis.fetch = vi.fn(async (url, init) => {
      requests.push({
        credentials: init?.credentials,
        url: String(url),
      })

      if (requests.length === 1) {
        return new Response('not ready', { status: 409 })
      }

      return new Response(new Blob(['image-bytes'], { type: 'image/png' }), {
        headers: { 'content-type': 'image/png' },
        status: 200,
      })
    }) as typeof fetch

    const resultPromise = fetchAuthenticatedAssetObjectUrl('/api/files/fil_preview/content')

    await vi.advanceTimersByTimeAsync(151)

    await expect(resultPromise).resolves.toBe('blob:asset')
    expect(requests).toEqual([
      {
        credentials: 'include',
        url: '/api/files/fil_preview/content',
      },
      {
        credentials: 'include',
        url: '/api/files/fil_preview/content',
      },
    ])
  })
})
