import type { ApiEnvelope } from '@wonderlands/contracts/chat'
import { apiFetch, apiRequest, toApiUrl } from './backend'
import { readErrorResponseMessage } from './response-errors'

const AUTH_SESSION_TIMEOUT_MS = 5_000

export interface BrowserAuthAccount {
  email: string | null
  id: string
  name: string | null
}

export interface BrowserAuthMembership {
  role: 'owner' | 'admin' | 'member' | 'viewer' | 'service'
  tenantId: string
  tenantName: string
  tenantSlug: string
}

export type BrowserAuthContext =
  | { kind: 'api_key' }
  | {
      expiresAt: string
      kind: 'auth_session'
      sessionId: string
    }

export interface BrowserAuthTenantScope {
  accountId: string
  role: BrowserAuthMembership['role']
  tenantId: string
}

export interface BrowserAuthSession {
  account: BrowserAuthAccount
  auth: BrowserAuthContext
  memberships: BrowserAuthMembership[]
  tenantScope: BrowserAuthTenantScope | null
}

export interface EmailPasswordLoginInput {
  email: string
  password: string
}

const withTimeout = async <TValue>(
  promise: Promise<TValue>,
  timeoutMs: number,
  message: string,
): Promise<TValue> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  try {
    return await new Promise<TValue>((resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(message))
      }, timeoutMs)

      void promise.then(resolve, reject)
    })
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
  }
}

export const getAuthSession = async (
  options: { timeoutMs?: number } = {},
): Promise<BrowserAuthSession | null> => {
  const response = await withTimeout(
    apiFetch(toApiUrl('/auth/session')),
    options.timeoutMs ?? AUTH_SESSION_TIMEOUT_MS,
    'Timed out while connecting to the API.',
  )

  if (response.status === 401) {
    return null
  }

  if (!response.ok) {
    throw new Error(
      await readErrorResponseMessage(response, `Failed to read auth session (${response.status})`),
    )
  }

  const payload = (await response.json()) as ApiEnvelope<BrowserAuthSession>
  if (!payload.ok) {
    throw new Error(payload.error.message)
  }

  return payload.data
}

export const loginWithPassword = (input: EmailPasswordLoginInput): Promise<BrowserAuthSession> =>
  apiRequest<BrowserAuthSession>(
    '/auth/login',
    {
      body: JSON.stringify(input),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    },
    {
      includeTenantId: false,
    },
  )

export const logout = async (): Promise<{ loggedOut: true }> => {
  const response = await apiFetch(
    toApiUrl('/auth/logout'),
    {
      method: 'POST',
    },
    {
      includeTenantId: false,
    },
  )

  if (response.status === 401) {
    return { loggedOut: true }
  }

  if (!response.ok) {
    throw new Error(
      await readErrorResponseMessage(response, `Failed to log out (${response.status})`),
    )
  }

  const payload = (await response.json()) as ApiEnvelope<{ loggedOut: true }>
  if (!payload.ok) {
    throw new Error(payload.error.message)
  }

  return payload.data
}
