// Shared HTML escaping, URL sanitization, and attribute rendering helpers
// used across the Garden markdown, page-component, and navigation renderers.

import { GARDEN_INTERNAL_HREF_PREFIX } from '../rewrite-links'

export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

export const serializeJsonForHtml = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')

const UNSAFE_URL_RE = /^(javascript|data|vbscript):/i

export const sanitizeUrl = (url: string): string => {
  const trimmed = url.trim()
  return UNSAFE_URL_RE.test(trimmed) ? '#' : trimmed
}

const resolveGardenInternalUrl = (url: string): { internal: boolean; url: string } => {
  if (!url.startsWith(GARDEN_INTERNAL_HREF_PREFIX)) {
    return {
      internal: false,
      url,
    }
  }

  return {
    internal: true,
    url: url.slice(GARDEN_INTERNAL_HREF_PREFIX.length) || '/',
  }
}

export const renderHrefAttributes = (rawUrl: string): string => {
  const resolved = resolveGardenInternalUrl(rawUrl)
  const href = escapeHtml(sanitizeUrl(resolved.url))

  return resolved.internal ? ` data-garden-link="internal" href="${href}"` : ` href="${href}"`
}

export const renderSrcAttributes = (rawUrl: string): string => {
  const resolved = resolveGardenInternalUrl(rawUrl)
  const src = escapeHtml(sanitizeUrl(resolved.url))

  return resolved.internal ? ` data-garden-link="internal" src="${src}"` : ` src="${src}"`
}
