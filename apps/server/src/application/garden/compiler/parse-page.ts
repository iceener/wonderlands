import matter from 'gray-matter'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { normalizeGardenRelativePath } from './resolve-source-path'
import type { GardenPageSeo, GardenPageVisibility, GardenParsedPage } from './types'

const asBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase()

  if (normalized === 'true') {
    return true
  }

  if (normalized === 'false') {
    return false
  }

  return undefined
}

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value)
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined
}

const asString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed : undefined
}

const asStringList = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    const parsed = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)

    return parsed.length > 0 ? parsed : undefined
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const parsed = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return parsed.length > 0 ? parsed : undefined
}

const normalizeMarkdownPath = (value: string): string =>
  value.replace(/\\/g, '/').replace(/^\/+/, '')

export const slugifyGardenSegment = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

export const slugifyGardenPath = (value: string): string =>
  value.split('/').map(slugifyGardenSegment).filter(Boolean).join('/')

const titleizeSegment = (value: string): string =>
  value
    .replace(/[-_\s]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())

const fallbackTitleFromPath = (sourcePath: string): string => {
  const parts = normalizeMarkdownPath(sourcePath).split('/').filter(Boolean)

  if (parts.length === 0) {
    return 'Untitled'
  }

  const last = (parts[parts.length - 1] ?? '').replace(/\.md$/i, '')

  if (last.toLowerCase() === 'index' && parts.length >= 2) {
    return titleizeSegment(parts[parts.length - 2] ?? 'Untitled')
  }

  return last || 'Untitled'
}

const markdownStripRegexes: Array<[RegExp, string | ((...args: string[]) => string)]> = [
  [/^>\s?/gm, ''],
  [/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, ''],
  [/!\[([^\]]*)\]\([^)]+\)/g, ''],
  [
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match: string, target: string, alias?: string) => alias ?? target,
  ],
  [/\[([^\]]+)\]\([^)]+\)/g, '$1'],
  [/`([^`]+)`/g, '$1'],
  [/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1'],
  [/^#+\s+/gm, ''],
]

const extractExcerpt = (raw: string, maxLength = 160): string | undefined => {
  if (!raw) {
    return undefined
  }

  const paragraphs: string[] = []
  const buffer: string[] = []
  let inFence = false

  const flush = () => {
    const paragraph = buffer.join(' ').trim()
    buffer.length = 0

    if (paragraph) {
      paragraphs.push(paragraph)
    }
  }

  for (const line of raw.replace(/\r/g, '').split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      flush()
      continue
    }

    if (inFence) {
      continue
    }

    if (line.trim() === '') {
      flush()
      continue
    }

    buffer.push(line.trim())
  }

  flush()

  for (const paragraph of paragraphs) {
    if (!paragraph || /^#{1,6}\s/.test(paragraph)) continue
    if (/^[-*+]\s/.test(paragraph) || /^\d+\.\s/.test(paragraph)) continue
    if (/^!?\[/.test(paragraph) && /(\)$|\]\]$)/.test(paragraph) && paragraph.length < 80) continue

    let stripped = paragraph

    for (const [regex, replacement] of markdownStripRegexes) {
      stripped = stripped.replace(regex, replacement as string)
    }

    stripped = stripped
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (stripped.length < 12) {
      continue
    }

    if (stripped.length <= maxLength) {
      return stripped
    }

    const cut = stripped.slice(0, maxLength)
    const lastSpace = cut.lastIndexOf(' ')
    return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim()}…`
  }

  return undefined
}

export const filePathToGardenSlug = (sourcePath: string): string => {
  const normalized = normalizeMarkdownPath(sourcePath)
    .replace(/\.md$/i, '')
    .replace(/\/index$/i, '')
    .replace(/^\/+/, '')

  return slugifyGardenPath(normalized) || 'index'
}

const slugToRoutePath = (slug: string): string => (slug === 'index' ? '/' : `/${slug}`)

const parseSeo = (metadata: Record<string, unknown>): GardenPageSeo | undefined => {
  const seo: GardenPageSeo = {
    canonical: asString(metadata.seo_canonical),
    description: asString(metadata.seo_description),
    image: asString(metadata.seo_image),
    keywords: asStringList(metadata.seo_keywords) ?? asStringList(metadata.keywords),
    noindex: asBoolean(metadata.seo_noindex) ?? asBoolean(metadata.noindex),
    title: asString(metadata.seo_title),
  }

  if (
    seo.canonical === undefined &&
    seo.description === undefined &&
    seo.image === undefined &&
    seo.keywords === undefined &&
    seo.noindex === undefined &&
    seo.title === undefined
  ) {
    return undefined
  }

  return seo
}

const parseVisibility = (value: unknown): Result<GardenPageVisibility, DomainError> => {
  const normalized = asString(value)

  if (!normalized) {
    return ok('public')
  }

  if (normalized === 'public' || normalized === 'protected' || normalized === 'private') {
    return ok(normalized)
  }

  return err({
    message: `visibility must be one of public, protected, or private; received "${normalized}"`,
    type: 'validation',
  })
}

const parseCoverImage = (
  value: unknown,
  sourcePath: string,
): Result<string | undefined, DomainError> => {
  const normalized = asString(value)

  if (!normalized) {
    return ok(undefined)
  }

  const relativePath = normalizeGardenRelativePath(
    normalized.startsWith('/') ? normalized.slice(1) : normalized,
    `${sourcePath}: cover_image`,
  )

  if (!relativePath.ok) {
    return relativePath
  }

  if (relativePath.value === 'public' || !relativePath.value.startsWith('public/')) {
    return err({
      message: `${sourcePath}: cover_image must point to a file under public/`,
      type: 'validation',
    })
  }

  return ok(relativePath.value)
}

export const parseGardenPage = (input: {
  raw: string
  sourcePath: string
}): Result<GardenParsedPage, DomainError> => {
  let parsedMatter: matter.GrayMatterFile<string>
  try {
    parsedMatter = matter(input.raw)
  } catch (error) {
    return err({
      message: `failed to parse frontmatter for ${input.sourcePath}: ${error instanceof Error ? error.message : 'Unknown parse failure'}`,
      type: 'validation',
    })
  }

  const metadata = parsedMatter.data as Record<string, unknown>
  const visibility = parseVisibility(metadata.visibility)

  if (!visibility.ok) {
    return err({
      message: `${input.sourcePath}: ${visibility.error.message}`,
      type: 'validation',
    })
  }

  const coverImage = parseCoverImage(metadata.cover_image, input.sourcePath)

  if (!coverImage.ok) {
    return coverImage
  }

  const slug = filePathToGardenSlug(input.sourcePath)
  const title = asString(metadata.title) ?? fallbackTitleFromPath(input.sourcePath)

  const listingPageSize = asNumber(metadata.listing_page_size)

  if (listingPageSize !== undefined && listingPageSize <= 0) {
    return err({
      message: `${input.sourcePath}: listing_page_size must be positive`,
      type: 'validation',
    })
  }

  return ok({
    aliases: asStringList(metadata.aliases) ?? [],
    coverImage: coverImage.value,
    date:
      metadata.date instanceof Date
        ? metadata.date.toISOString().slice(0, 10)
        : asString(metadata.date),
    description: asString(metadata.description) ?? extractExcerpt(parsedMatter.content),
    draft: asBoolean(metadata.draft) ?? false,
    excerpt: asString(metadata.excerpt),
    listing: asBoolean(metadata.listing),
    listingPageSize,
    order: asNumber(metadata.order) ?? asNumber(metadata.sort_order),
    publish: asBoolean(metadata.publish) !== false,
    rawMarkdown: parsedMatter.content,
    routePath: slugToRoutePath(slug),
    seo: parseSeo(metadata),
    slug,
    sourcePath: normalizeMarkdownPath(input.sourcePath),
    tags: asStringList(metadata.tags) ?? [],
    template: asString(metadata.template),
    title,
    unlisted: asBoolean(metadata.unlisted) ?? false,
    updated:
      metadata.updated_at instanceof Date
        ? metadata.updated_at.toISOString().slice(0, 10)
        : (asString(metadata.updated_at) ??
          (metadata.updatedAt instanceof Date
            ? metadata.updatedAt.toISOString().slice(0, 10)
            : (asString(metadata.updatedAt) ??
              (metadata.updated instanceof Date
                ? metadata.updated.toISOString().slice(0, 10)
                : asString(metadata.updated))))),
    visibility: visibility.value,
  })
}
