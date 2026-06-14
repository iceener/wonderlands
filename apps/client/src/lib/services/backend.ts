import type { ApiEnvelope, ApiSuccessEnvelope } from '@wonderlands/contracts/chat'
import { readErrorResponseMessage } from './response-errors'

const DEFAULT_API_BASE_URL = '/api'
const ACTIVE_TENANT_STORAGE_KEY = '05_04_ui.active-tenant'
const COMPATIBILITY_API_BASE_PATHS = ['/api', '/v1'] as const

const trim = (value: string | null | undefined): string | null => {
  const nextValue = value?.trim()
  return nextValue ? nextValue : null
}

const apiBaseUrl = trim(import.meta.env.VITE_API_BASE_URL) ?? DEFAULT_API_BASE_URL
const defaultTenantId = trim(import.meta.env.VITE_API_TENANT_ID)

const isAbsoluteHttpUrl = (value: string): boolean => /^https?:\/\//iu.test(value)

const normalizeBasePath = (value: string): string => {
  const normalized = value.replace(/\/+$/u, '')
  return normalized || '/'
}

const apiBasePath = (() => {
  if (isAbsoluteHttpUrl(apiBaseUrl)) {
    try {
      return normalizeBasePath(new URL(apiBaseUrl).pathname)
    } catch {
      return null
    }
  }

  if (apiBaseUrl.startsWith('/')) {
    return normalizeBasePath(apiBaseUrl)
  }

  return null
})()

const apiBaseOrigin = (() => {
  if (!isAbsoluteHttpUrl(apiBaseUrl)) {
    return null
  }

  try {
    return new URL(apiBaseUrl).origin
  } catch {
    return null
  }
})()

const getStorage = (): Pick<Storage, 'getItem' | 'removeItem' | 'setItem'> | null => {
  if (typeof localStorage === 'undefined') {
    return null
  }

  return localStorage
}

const readStoredTenantId = (): string | null => {
  const storage = getStorage()
  return storage ? trim(storage.getItem(ACTIVE_TENANT_STORAGE_KEY)) : null
}

let activeTenantId = readStoredTenantId() ?? defaultTenantId

const withApiBaseUrl = (path: string): string => {
  if (isAbsoluteHttpUrl(path)) {
    return path
  }

  if (path.startsWith('/')) {
    const isKnownApiPath =
      COMPATIBILITY_API_BASE_PATHS.some(
        (basePath) => path === basePath || path.startsWith(`${basePath}/`),
      ) ||
      (apiBasePath && (path === apiBasePath || path.startsWith(`${apiBasePath}/`)))

    if (isKnownApiPath) {
      return apiBaseOrigin ? `${apiBaseOrigin}${path}` : path
    }

    return `${apiBaseUrl}${path}`
  }

  return `${apiBaseUrl}/${path}`
}

export const getApiTenantId = (): string | null => activeTenantId

export const setApiTenantId = (tenantId: string | null | undefined): void => {
  const nextTenantId = trim(tenantId)
  activeTenantId = nextTenantId

  const storage = getStorage()
  if (!storage) {
    return
  }

  if (nextTenantId) {
    storage.setItem(ACTIVE_TENANT_STORAGE_KEY, nextTenantId)
    return
  }

  storage.removeItem(ACTIVE_TENANT_STORAGE_KEY)
}

interface CreateApiHeadersOptions {
  includeTenantId?: boolean
}

export const createApiHeaders = (
  headers?: HeadersInit,
  options: CreateApiHeadersOptions = {},
): Headers => {
  const resolvedHeaders = new Headers(headers)
  const includeTenantId = options.includeTenantId ?? true

  if (includeTenantId && activeTenantId) {
    resolvedHeaders.set('x-tenant-id', activeTenantId)
  }

  return resolvedHeaders
}

interface ApiFetchOptions {
  includeTenantId?: boolean
}

const fetchWithResolvedAuth = async (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: ApiFetchOptions = {},
): Promise<Response> => {
  const nextInit: RequestInit = {
    ...init,
    credentials: init?.credentials ?? 'include',
    headers: createApiHeaders(init?.headers, {
      includeTenantId: options.includeTenantId,
    }),
  }

  return fetch(input, nextInit)
}

export const apiFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
  options: ApiFetchOptions = {},
): Promise<Response> => fetchWithResolvedAuth(input, init, options)

export const apiRequest = async <TData>(
  path: string,
  init?: RequestInit,
  options: ApiFetchOptions = {},
): Promise<ApiSuccessEnvelope<TData>['data']> => {
  const response = await apiFetch(withApiBaseUrl(path), init, options)

  if (!response.ok) {
    throw new Error(
      await readErrorResponseMessage(response, `Request failed with ${response.status}`),
    )
  }

  const payload = (await response.json()) as ApiEnvelope<TData>
  if (!payload.ok) {
    throw new Error(payload.error.message)
  }

  return payload.data
}

export const toApiUrl = (path: string): string => withApiBaseUrl(path)
