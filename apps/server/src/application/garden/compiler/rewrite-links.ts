import { posix } from 'node:path'
import type { GardenBuildWarning } from './types'

const PROTOCOL_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/
export const GARDEN_INTERNAL_HREF_PREFIX = 'garden:'

const normalizeFilePath = (value: string): string => value.replace(/\\/g, '/').replace(/^\/+/, '')

const headingToAnchor = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

const defaultWikiLabel = (rawTarget: string): string => {
  const base = rawTarget.split('#')[0]?.trim() ?? ''

  if (!base) {
    return 'section'
  }

  const lastSegment = base
    .replace(/\.md$/i, '')
    .replace(/\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .pop()

  const normalized = (lastSegment ?? base).replace(/[-_]/g, ' ').trim()

  return normalized || 'link'
}

const resolveInternalTarget = (
  rawTarget: string,
  currentFilePath: string,
  currentSlug: string,
): { anchor?: string; slug: string } | undefined => {
  const target = rawTarget.trim()

  if (!target || PROTOCOL_RE.test(target)) {
    return undefined
  }

  const currentFileWithoutExtension = normalizeFilePath(currentFilePath).replace(/\.md$/i, '')
  const currentDir = posix.dirname(currentFileWithoutExtension)
  const hashIndex = target.indexOf('#')
  const pathPart = (hashIndex === -1 ? target : target.slice(0, hashIndex)).trim()
  const rawAnchor = hashIndex === -1 ? '' : target.slice(hashIndex + 1).trim()
  const anchor = rawAnchor ? headingToAnchor(rawAnchor) : undefined

  if (!pathPart) {
    return {
      ...(anchor ? { anchor } : {}),
      slug: currentSlug,
    }
  }

  let resolved = pathPart.replace(/\\/g, '/').trim()

  if (resolved.startsWith('vault/')) {
    resolved = resolved.slice('vault/'.length)
  }

  if (resolved.startsWith('/')) {
    resolved = resolved.slice(1)
  }

  if (resolved.startsWith('./') || resolved.startsWith('../')) {
    resolved = posix.normalize(posix.join(currentDir, resolved))
  }

  resolved = resolved
    .replace(/\.md$/i, '')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')

  if (!resolved || resolved === '.') {
    return {
      ...(anchor ? { anchor } : {}),
      slug: currentSlug,
    }
  }

  if (resolved === '..' || resolved.startsWith('../')) {
    return undefined
  }

  return {
    ...(anchor ? { anchor } : {}),
    slug: resolved.replace(/\/index$/i, '') || 'index',
  }
}

export const buildRelativeRouteHref = (
  currentRoutePath: string,
  targetRoutePath: string,
  anchor?: string,
): string => {
  if (currentRoutePath === targetRoutePath && anchor) {
    return `#${anchor}`
  }

  if (currentRoutePath === targetRoutePath) {
    return '#'
  }

  const href = targetRoutePath === '/' ? '/' : targetRoutePath

  return `${GARDEN_INTERNAL_HREF_PREFIX}${anchor ? `${href}#${anchor}` : href}`
}

const maybeRewritePublicAssetHref = (target: string, currentRoutePath: string): string | null => {
  const trimmed = target.trim()
  const assetPath = trimmed.startsWith('/public/')
    ? trimmed.slice(1)
    : trimmed.startsWith('public/')
      ? trimmed
      : null

  if (!assetPath) {
    return null
  }

  const normalizedAssetPath = assetPath.replace(/\/+/g, '/').replace(/^\/+/, '')

  if (normalizedAssetPath === 'public' || normalizedAssetPath.startsWith('../')) {
    return null
  }

  return buildRelativeRouteHref(currentRoutePath, `/${normalizedAssetPath}`)
}

const splitMarkdownTarget = (targetWithSuffix: string): { suffix: string; target: string } => {
  const trimmed = targetWithSuffix.trim()
  const firstSpace = trimmed.indexOf(' ')

  return firstSpace === -1
    ? { suffix: '', target: trimmed }
    : {
        suffix: trimmed.slice(firstSpace),
        target: trimmed.slice(0, firstSpace),
      }
}

const maybeRewriteKnownPublicAssetHref = (input: {
  availablePublicAssetPaths?: ReadonlySet<string>
  currentRoutePath: string
  sourcePath: string
  target: string
}): {
  href: string
  warning?: GardenBuildWarning
} | null => {
  const directRewrite = maybeRewritePublicAssetHref(input.target, input.currentRoutePath)

  if (directRewrite) {
    return {
      href: directRewrite,
    }
  }

  if (!input.availablePublicAssetPaths) {
    return null
  }

  const trimmed = input.target.trim()

  if (
    trimmed.length === 0 ||
    PROTOCOL_RE.test(trimmed) ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('/public/') ||
    trimmed.startsWith('public/')
  ) {
    return null
  }

  const normalized = trimmed.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')

  if (!normalized || normalized.startsWith('../')) {
    return null
  }

  const candidatePublicAssetPath = `public/${normalized}`

  if (!input.availablePublicAssetPaths.has(candidatePublicAssetPath)) {
    return null
  }

  return {
    href: buildRelativeRouteHref(input.currentRoutePath, `/${candidatePublicAssetPath}`),
    warning: {
      code: 'asset_link_rewritten',
      message: `Asset link "${trimmed}" should reference "/${candidatePublicAssetPath}" in source markdown; rewriting automatically`,
      sourcePath: input.sourcePath,
      target: trimmed,
    },
  }
}

const rewritePublicAssetLinks = (input: {
  availablePublicAssetPaths?: ReadonlySet<string>
  content: string
  currentRoutePath: string
  sourcePath: string
}): { content: string; warnings: GardenBuildWarning[] } => {
  const warnings: GardenBuildWarning[] = []
  const content = input.content.replace(
    /(!?\[[^\]]*\]\()([^)]+)(\))/g,
    (match, prefix: string, targetWithSuffix: string, suffix: string) => {
      const parts = splitMarkdownTarget(targetWithSuffix)
      const rewrittenTarget = maybeRewriteKnownPublicAssetHref({
        availablePublicAssetPaths: input.availablePublicAssetPaths,
        currentRoutePath: input.currentRoutePath,
        sourcePath: input.sourcePath,
        target: parts.target,
      })

      if (!rewrittenTarget) {
        return match
      }

      if (rewrittenTarget.warning) {
        warnings.push(rewrittenTarget.warning)
      }

      return `${prefix}${rewrittenTarget.href}${parts.suffix}${suffix}`
    },
  )

  return {
    content,
    warnings,
  }
}

export const rewriteGardenLinks = (input: {
  availablePublicAssetPaths?: ReadonlySet<string>
  currentFilePath: string
  currentRoutePath: string
  currentSlug: string
  markdown: string
  onInternalLink: (link: { anchor?: string; label: string; slug: string }) =>
    | {
        kind: 'link'
        href: string
      }
    | {
        kind: 'text'
        text: string
        warning?: GardenBuildWarning
      }
}): { markdown: string; warnings: GardenBuildWarning[] } => {
  const warnings: GardenBuildWarning[] = []

  const withWikiLinks = input.markdown.replace(
    /(!)?\[\[([^[\]]+)\]\]/g,
    (match, embed: string | undefined, inner: string) => {
      if (embed) {
        return match
      }

      const [targetRaw, aliasRaw] = inner.split('|')
      const target = targetRaw?.trim() ?? ''

      if (!target) {
        return match
      }

      const resolved = resolveInternalTarget(target, input.currentFilePath, input.currentSlug)

      if (!resolved) {
        return match
      }

      const label = aliasRaw?.trim() || defaultWikiLabel(target)
      const decision = input.onInternalLink({
        anchor: resolved.anchor,
        label,
        slug: resolved.slug,
      })

      if (decision.kind === 'text') {
        if (decision.warning) {
          warnings.push(decision.warning)
        }

        return decision.text
      }

      return `[${label}](${decision.href})`
    },
  )

  const withMarkdownLinks = withWikiLinks.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (match, label: string, targetWithSuffix: string, offset: number, source: string) => {
      if (offset > 0 && source[offset - 1] === '!') {
        return match
      }

      const trimmedTarget = targetWithSuffix.trim()
      const firstSpace = trimmedTarget.indexOf(' ')
      const target = firstSpace === -1 ? trimmedTarget : trimmedTarget.slice(0, firstSpace)

      if (
        !target ||
        PROTOCOL_RE.test(target) ||
        target.startsWith('#') ||
        !/\.md(?:#.*)?$/i.test(target)
      ) {
        return match
      }

      const resolved = resolveInternalTarget(target, input.currentFilePath, input.currentSlug)

      if (!resolved) {
        return match
      }

      const decision = input.onInternalLink({
        anchor: resolved.anchor,
        label,
        slug: resolved.slug,
      })

      if (decision.kind === 'text') {
        if (decision.warning) {
          warnings.push(decision.warning)
        }

        return decision.text
      }

      return `[${label}](${decision.href})`
    },
  )

  const assetRewrites = rewritePublicAssetLinks({
    availablePublicAssetPaths: input.availablePublicAssetPaths,
    content: withMarkdownLinks,
    currentRoutePath: input.currentRoutePath,
    sourcePath: input.currentFilePath,
  })

  warnings.push(...assetRewrites.warnings)

  return {
    markdown: assetRewrites.content,
    warnings,
  }
}
