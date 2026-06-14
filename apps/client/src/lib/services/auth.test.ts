import { afterEach, describe, expect, test } from 'vitest'
import { getAuthSession, loginWithPassword, logout } from './auth'
import { toApiUrl } from './backend'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('auth service', () => {
  test('logs in without sending a tenant header', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })

      return new Response(
        JSON.stringify({
          data: {
            account: {
              email: 'ada@example.com',
              id: 'acc_test',
              name: 'Ada',
            },
            auth: {
              expiresAt: '2026-04-01T00:00:00.000Z',
              kind: 'auth_session',
              sessionId: 'aus_test',
            },
            memberships: [],
            tenantScope: null,
          },
          meta: { requestId: 'req_login', traceId: 'trace_login' },
          ok: true,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 201,
        },
      )
    }) as typeof fetch

    await expect(
      loginWithPassword({
        email: 'ada@example.com',
        password: 'correct horse battery staple',
      }),
    ).resolves.toMatchObject({
      account: {
        email: 'ada@example.com',
      },
      auth: {
        kind: 'auth_session',
      },
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(toApiUrl('/auth/login'))
    expect(new Headers(requests[0]?.init?.headers).get('x-tenant-id')).toBeNull()
  })

  test('treats logout as successful when the session is already missing', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []

    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init })

      return new Response(
        JSON.stringify({
          error: {
            message: 'x-tenant-id requires authorization',
            type: 'auth',
          },
          meta: { requestId: 'req_logout', traceId: 'trace_logout' },
          ok: false,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 401,
        },
      )
    }) as typeof fetch

    await expect(logout()).resolves.toEqual({ loggedOut: true })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(toApiUrl('/auth/logout'))
    expect(new Headers(requests[0]?.init?.headers).get('x-tenant-id')).toBeNull()
  })

  test('returns null when there is no active auth session', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: {
            message: 'Authentication required',
            type: 'auth',
          },
          meta: { requestId: 'req_auth', traceId: 'trace_auth' },
          ok: false,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 401,
        },
      )) as typeof fetch

    await expect(getAuthSession()).resolves.toBeNull()
  })

  test('times out when the auth session request never resolves', async () => {
    globalThis.fetch = (() => new Promise<Response>(() => undefined)) as typeof fetch

    await expect(getAuthSession({ timeoutMs: 10 })).rejects.toThrow(
      'Timed out while connecting to the API.',
    )
  })
})
