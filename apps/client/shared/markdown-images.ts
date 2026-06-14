import { marked, type Tokens } from 'marked'

const LEGACY_LOCAL_UPLOAD_PREFIX = '/api/uploads/'
const DURABLE_FILE_PREFIX = '/v1/files/'
const LOCAL_URL_BASE = 'https://local.invalid'
const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

export interface MarkdownImageReference {
  alt: string
  raw: string
  title: string | null
  url: string
}

export interface ImageUrlParseError {
  message: string
  reason: 'empty_url' | 'invalid_url' | 'unsupported_relative_url' | 'unsupported_scheme'
  url: string
}

interface RemoteImageSource {
  comparisonKey: string
  kind: 'remote'
  url: string
}

interface LocalUploadImageSource {
  assetId: string
  comparisonKey: string
  kind: 'local-upload'
  url: string
}

export type ModelVisibleImageSource = RemoteImageSource | LocalUploadImageSource

export type ImageUrlParseResult =
  | {
      ok: true
      value: ModelVisibleImageSource
    }
  | {
      error: ImageUrlParseError
      ok: false
    }

const toTrimmedUrl = (value: string): string => value.trim()

const escapeMarkdownText = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')

const escapeMarkdownTitle = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

const renderMarkdownImageReference = (
  reference: Pick<MarkdownImageReference, 'alt' | 'title'>,
  url: string,
): string => {
  const alt = escapeMarkdownText(reference.alt)
  const title =
    typeof reference.title === 'string' && reference.title.length > 0
      ? ` "${escapeMarkdownTitle(reference.title)}"`
      : ''

  return `![${alt}](${url}${title})`
}

const unwrapNestedMarkdownLinkUrl = (value: string): string | null => {
  const tokens = marked.lexer(value)
  if (tokens.length !== 1 || tokens[0]?.type !== 'paragraph') {
    return null
  }

  const paragraph = tokens[0] as Tokens.Paragraph
  if (paragraph.tokens.length !== 1 || paragraph.tokens[0]?.type !== 'link') {
    return null
  }

  const link = paragraph.tokens[0] as Tokens.Link
  const text = (link.text ?? '').trim()
  const href = (link.href ?? '').trim()

  if (!text || text !== href || link.title) {
    return null
  }

  return link.raw === value ? href : null
}

const normalizeRemoteUrl = (value: URL): string => {
  value.hash = ''
  return value.toString()
}

const readUploadAssetId = (pathname: string): string | null => {
  if (pathname.startsWith(LEGACY_LOCAL_UPLOAD_PREFIX)) {
    const remainder = pathname.slice(LEGACY_LOCAL_UPLOAD_PREFIX.length)
    const [rawAssetId = ''] = remainder.split('/', 1)
    const assetId = decodeURIComponent(rawAssetId).trim()
    return assetId || null
  }

  if (!pathname.startsWith(DURABLE_FILE_PREFIX)) {
    return null
  }

  const remainder = pathname.slice(DURABLE_FILE_PREFIX.length)
  const [rawFileId = '', suffix = ''] = remainder.split('/', 2)
  const fileId = decodeURIComponent(rawFileId).trim()
  if (!fileId || suffix !== 'content') {
    return null
  }

  return fileId
}

const createUnsupportedRelativeUrlError = (url: string): ImageUrlParseResult => ({
  ok: false,
  error: {
    reason: 'unsupported_relative_url',
    url,
    message:
      'Only uploaded image URLs under /v1/files/*/content or /api/uploads/ and absolute http(s) image URLs are supported.',
  },
})

const parseRelativeImageSource = (url: string): ImageUrlParseResult => {
  const parsed = new URL(url, LOCAL_URL_BASE)
  const assetId = readUploadAssetId(parsed.pathname)
  if (!assetId) {
    return createUnsupportedRelativeUrlError(url)
  }

  return {
    ok: true,
    value: {
      kind: 'local-upload',
      url,
      assetId,
      comparisonKey: `upload:${assetId}`,
    },
  }
}

const parseAbsoluteImageSource = (url: string): ImageUrlParseResult => {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return {
      ok: false,
      error: {
        reason: 'invalid_url',
        url,
        message: 'Image URL is not a valid URL.',
      },
    }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: {
        reason: 'unsupported_scheme',
        url,
        message: `Unsupported image URL scheme "${parsed.protocol}". Only http(s) URLs and uploaded image URLs are supported.`,
      },
    }
  }

  const localAssetId = LOCALHOST_HOSTNAMES.has(parsed.hostname)
    ? readUploadAssetId(parsed.pathname)
    : null

  if (localAssetId) {
    return {
      ok: true,
      value: {
        kind: 'local-upload',
        url,
        assetId: localAssetId,
        comparisonKey: `upload:${localAssetId}`,
      },
    }
  }

  return {
    ok: true,
    value: {
      kind: 'remote',
      url: normalizeRemoteUrl(parsed),
      comparisonKey: `remote:${normalizeRemoteUrl(parsed)}`,
    },
  }
}

export const parseModelVisibleImageSource = (value: string): ImageUrlParseResult => {
  const url = unwrapNestedMarkdownLinkUrl(toTrimmedUrl(value)) ?? toTrimmedUrl(value)

  if (!url) {
    return {
      ok: false,
      error: {
        reason: 'empty_url',
        url,
        message: 'Image URL is required.',
      },
    }
  }

  if (url.startsWith('/')) {
    return parseRelativeImageSource(url)
  }

  return parseAbsoluteImageSource(url)
}

export const getModelVisibleImageComparisonKey = (value: string): string | null => {
  const result = parseModelVisibleImageSource(value)
  return result.ok ? result.value.comparisonKey : null
}

export const getUploadedAssetIdFromUrl = (value: string): string | null => {
  const result = parseModelVisibleImageSource(value)
  if (!result.ok || result.value.kind !== 'local-upload') {
    return null
  }

  return result.value.assetId
}

export const listMarkdownImageReferences = (markdown: string): MarkdownImageReference[] => {
  const references: MarkdownImageReference[] = []

  marked.walkTokens(marked.lexer(markdown ?? ''), (token) => {
    if (token.type !== 'image') {
      return
    }

    const imageToken = token as Tokens.Image
    references.push({
      alt: imageToken.text,
      raw: imageToken.raw,
      title: imageToken.title ?? null,
      url: imageToken.href,
    })
  })

  return references
}

export const normalizeModelVisibleImageMarkdown = (markdown: string): string => {
  let normalized = markdown ?? ''
  let searchStart = 0

  for (const reference of listMarkdownImageReferences(normalized)) {
    const nextUrl = unwrapNestedMarkdownLinkUrl(reference.url)
    if (!nextUrl) {
      continue
    }

    const nextRaw = renderMarkdownImageReference(reference, nextUrl)
    const rawIndex = normalized.indexOf(reference.raw, searchStart)
    if (rawIndex < 0) {
      continue
    }

    normalized =
      normalized.slice(0, rawIndex) + nextRaw + normalized.slice(rawIndex + reference.raw.length)
    searchStart = rawIndex + nextRaw.length
  }

  return normalized
}
