import { apiFetch, toApiUrl } from './backend'

const AUTHENTICATED_FILE_PATH_PREFIXES = ['/api/files/', '/v1/files/']
const OPENED_OBJECT_URL_TTL_MS = 60_000
const AUTHENTICATED_ASSET_RETRY_DELAYS_MS = [150, 350, 750] as const
const RETRYABLE_AUTHENTICATED_ASSET_STATUS_CODES = new Set([404, 409, 425, 429, 502, 503, 504])

const isAbsoluteHttpUrl = (value: string): boolean => /^https?:\/\//iu.test(value)

const readPathname = (value: string): string | null => {
  if (!value.trim()) {
    return null
  }

  if (value.startsWith('/')) {
    return value
  }

  if (!isAbsoluteHttpUrl(value) || typeof window === 'undefined') {
    return null
  }

  try {
    const parsed = new URL(value)
    return parsed.origin === window.location.origin ? parsed.pathname : null
  } catch {
    return null
  }
}

export const isAuthenticatedAssetUrl = (value: string | null | undefined): boolean => {
  const pathname = value ? readPathname(value) : null
  return pathname
    ? AUTHENTICATED_FILE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    : false
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const timeoutId = globalThis.setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    const handleAbort = () => {
      globalThis.clearTimeout(timeoutId)
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }

    const cleanup = () => {
      signal?.removeEventListener('abort', handleAbort)
    }

    signal?.addEventListener('abort', handleAbort, { once: true })
  })

const shouldRetryAuthenticatedAssetLoad = (status: number): boolean =>
  RETRYABLE_AUTHENTICATED_ASSET_STATUS_CODES.has(status)

export const fetchAuthenticatedAssetObjectUrl = async (
  assetUrl: string,
  signal?: AbortSignal,
): Promise<string> => {
  const resolvedAssetUrl = isAuthenticatedAssetUrl(assetUrl) ? toApiUrl(assetUrl) : assetUrl
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= AUTHENTICATED_ASSET_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await apiFetch(resolvedAssetUrl, { signal })

      if (response.ok) {
        const blob = await response.blob()
        return URL.createObjectURL(blob)
      }

      lastError = new Error(`Failed to load asset: ${response.status}`)

      if (
        attempt === AUTHENTICATED_ASSET_RETRY_DELAYS_MS.length ||
        !shouldRetryAuthenticatedAssetLoad(response.status)
      ) {
        throw lastError
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }

      lastError = error instanceof Error ? error : new Error('Failed to load asset.')

      if (attempt === AUTHENTICATED_ASSET_RETRY_DELAYS_MS.length) {
        throw lastError
      }
    }

    await sleep(AUTHENTICATED_ASSET_RETRY_DELAYS_MS[attempt]!, signal)
  }

  throw lastError ?? new Error('Failed to load asset.')
}

export const openAssetInNewTab = async (assetUrl: string, signal?: AbortSignal): Promise<void> => {
  if (typeof window === 'undefined') {
    return
  }

  if (!isAuthenticatedAssetUrl(assetUrl)) {
    window.open(assetUrl, '_blank', 'noopener,noreferrer')
    return
  }

  const popup = window.open('', '_blank')

  if (popup && !popup.closed) {
    try {
      popup.opener = null
      popup.document.title = 'Loading file...'
      popup.document.body.innerHTML =
        '<div style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#11131a;color:#e5e7eb;font:14px system-ui,sans-serif;">Loading file...</div>'
    } catch {
      // Ignore same-window setup failures and keep the popup handle if available.
    }
  }

  try {
    const objectUrl = await fetchAuthenticatedAssetObjectUrl(assetUrl, signal)

    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl)
    }, OPENED_OBJECT_URL_TTL_MS)

    if (popup && !popup.closed) {
      popup.location.href = objectUrl
      popup.focus()
      return
    }

    window.open(objectUrl, '_blank', 'noopener,noreferrer')
  } catch (error) {
    if (popup && !popup.closed) {
      popup.close()
    }

    throw error
  }
}

export interface ResolvedImageDisplayUrl {
  displayUrl: string
  dispose: () => void
}

interface BlobCacheEntry {
  objectUrl: string
  refCount: number
  pending?: Promise<string>
}

const GRACE_MS = 2_000
const blobCache = new Map<string, BlobCacheEntry>()

const releaseCacheEntry = (src: string, entry: BlobCacheEntry) => {
  entry.refCount -= 1
  if (entry.refCount > 0) return
  setTimeout(() => {
    if (entry.refCount <= 0 && blobCache.get(src) === entry) {
      blobCache.delete(src)
      URL.revokeObjectURL(entry.objectUrl)
    }
  }, GRACE_MS)
}

/** Synchronously returns a cached blob URL for `src`, or `null` if not cached. */
export const peekCachedDisplayUrl = (src: string): string | null => {
  const entry = blobCache.get(src)
  return entry?.objectUrl || null
}

/** Resolves a URL for display in `<img src>`; authenticated API file URLs are fetched and turned into object URLs. */
export const resolveImageDisplayUrl = async (
  src: string,
  signal?: AbortSignal,
): Promise<ResolvedImageDisplayUrl> => {
  if (!isAuthenticatedAssetUrl(src)) {
    return { displayUrl: src, dispose: () => undefined }
  }

  const cached = blobCache.get(src)

  if (cached?.objectUrl) {
    cached.refCount += 1
    return { displayUrl: cached.objectUrl, dispose: () => releaseCacheEntry(src, cached) }
  }

  if (cached?.pending) {
    const objectUrl = await cached.pending
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    cached.refCount += 1
    return { displayUrl: objectUrl, dispose: () => releaseCacheEntry(src, cached) }
  }

  const entry: BlobCacheEntry = { objectUrl: '', refCount: 0 }
  entry.pending = fetchAuthenticatedAssetObjectUrl(src, signal)
  blobCache.set(src, entry)

  try {
    const objectUrl = await entry.pending
    entry.objectUrl = objectUrl
    entry.pending = undefined
    entry.refCount += 1
    return { displayUrl: objectUrl, dispose: () => releaseCacheEntry(src, entry) }
  } catch (error) {
    entry.pending = undefined
    if (entry.refCount <= 0) blobCache.delete(src)
    throw error
  }
}
