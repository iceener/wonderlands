// Garden page component rendering: SEO/search metadata, cover image, tags,
// table of contents, listing/pagination, and misc page chrome.

import { buildRelativeRouteHref } from '../rewrite-links'
import type { GardenPageSeo } from '../types'
import { escapeHtml, renderHrefAttributes, renderSrcAttributes } from './html-utils'
import type { HeadingInfo } from './markdown'

export interface GardenListingItem {
  date?: string
  description?: string
  routePath: string
  tags?: readonly string[]
  title: string
  updated?: string
}

export interface GardenListingContext {
  currentPage: number
  items: GardenListingItem[]
  parentRoutePath: string
  totalPages: number
}

const resolvePageSection = (sourceSlug: string): string | undefined => {
  if (!sourceSlug || sourceSlug === 'index') {
    return undefined
  }

  const parent = sourceSlug.split('/').slice(0, -1).join('/')
  return parent || sourceSlug
}

export const renderSearchMetadata = (input: {
  coverImageArtifactPath?: string
  date?: string
  description?: string
  excerpt?: string
  order?: number
  sourceSlug: string
  tags: readonly string[]
  title: string
  updated?: string
  visibility: 'protected' | 'public'
}): string => {
  const parts: string[] = []
  const excerpt = input.excerpt ?? input.description
  const section = resolvePageSection(input.sourceSlug)

  parts.push(`<meta data-pagefind-filter="visibility:${input.visibility}">`)

  if (excerpt) {
    parts.push(`<meta data-pagefind-meta="excerpt:${escapeHtml(excerpt)}">`)
  }

  if (input.tags.length > 0) {
    parts.push(`<meta data-pagefind-meta="tags:${escapeHtml(input.tags.join(', '))}">`)
  }

  if (section) {
    parts.push(`<meta data-pagefind-meta="section:${escapeHtml(section)}">`)
    parts.push(`<meta data-pagefind-filter="section:${escapeHtml(section)}">`)
  }

  if (input.date) {
    parts.push(`<meta data-pagefind-meta="date:${escapeHtml(input.date)}">`)
    parts.push(`<meta data-pagefind-sort="date:${escapeHtml(input.date)}">`)
  }

  if (input.updated) {
    parts.push(`<meta data-pagefind-meta="updated:${escapeHtml(input.updated)}">`)
    parts.push(`<meta data-pagefind-sort="updated:${escapeHtml(input.updated)}">`)
  }

  if (input.order !== undefined) {
    parts.push(`<meta data-pagefind-sort="order:${escapeHtml(String(input.order))}">`)
  }

  return parts.join('\n')
}

export const renderSeoMeta = (input: {
  description?: string
  noindex?: boolean
  routePath: string
  seo?: GardenPageSeo
  siteDescription?: string
  siteImage?: string
  siteTitle?: string
  siteTwitter?: string
  title: string
}): string => {
  const meta: string[] = []
  const seoTitle = input.seo?.title ?? input.title
  const seoDescription = input.seo?.description ?? input.description ?? input.siteDescription
  const image = input.seo?.image ?? input.siteImage
  const documentTitle =
    input.siteTitle && input.routePath !== '/' ? `${seoTitle} | ${input.siteTitle}` : seoTitle

  meta.push(`<title>${escapeHtml(input.routePath === '/' && input.siteTitle ? input.siteTitle : documentTitle)}</title>`)

  if (seoDescription) {
    meta.push(`<meta name="description" content="${escapeHtml(seoDescription)}">`)
  }

  if (input.seo?.canonical) {
    meta.push(`<link rel="canonical" href="${escapeHtml(input.seo.canonical)}">`)
  }

  if (input.seo?.noindex ?? input.noindex) {
    meta.push('<meta name="robots" content="noindex, nofollow">')
  }

  if (input.seo?.keywords && input.seo.keywords.length > 0) {
    meta.push(`<meta name="keywords" content="${escapeHtml(input.seo.keywords.join(', '))}">`)
  }

  if (input.siteTitle) {
    meta.push(`<meta property="og:site_name" content="${escapeHtml(input.siteTitle)}">`)
  }
  meta.push(`<meta property="og:title" content="${escapeHtml(seoTitle)}">`)
  if (seoDescription) {
    meta.push(`<meta property="og:description" content="${escapeHtml(seoDescription)}">`)
  }
  meta.push('<meta property="og:type" content="article">')
  if (input.seo?.canonical) {
    meta.push(`<meta property="og:url" content="${escapeHtml(input.seo.canonical)}">`)
  }
  if (image) {
    meta.push(`<meta property="og:image" content="${escapeHtml(image)}">`)
  }
  meta.push(`<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`)
  if (input.siteTwitter) {
    meta.push(`<meta name="twitter:site" content="${escapeHtml(input.siteTwitter)}">`)
  }
  meta.push(`<meta name="twitter:title" content="${escapeHtml(seoTitle)}">`)
  if (seoDescription) {
    meta.push(`<meta name="twitter:description" content="${escapeHtml(seoDescription)}">`)
  }
  if (image) {
    meta.push(`<meta name="twitter:image" content="${escapeHtml(image)}">`)
  }

  return meta.join('\n')
}

const DISPLAY_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  year: 'numeric',
})

const formatDisplayDate = (value?: string): string | undefined => {
  if (!value) return undefined
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return undefined
  return DISPLAY_DATE_FORMATTER.format(time)
}

export const renderUpdatedStamp = (lastUpdated?: string): string => {
  const formatted = formatDisplayDate(lastUpdated)
  if (!formatted || !lastUpdated) return ''
  return `<p class="page-updated" data-pagefind-ignore="all">Last updated <time datetime="${escapeHtml(lastUpdated)}">${escapeHtml(formatted)}</time></p>`
}

export const renderGrowthMarkers = (date?: string, updated?: string): string => {
  if (!date && !updated) return ''
  const parts: string[] = []
  if (date) parts.push(`planted <time datetime="${escapeHtml(date)}">${escapeHtml(date)}</time>`)
  if (updated && updated !== date)
    parts.push(`tended <time datetime="${escapeHtml(updated)}">${escapeHtml(updated)}</time>`)
  if (parts.length === 0) return ''
  return `<p class="growth" data-pagefind-ignore="all">${parts.join(' \u00b7 ')}</p>`
}

export const renderPageTags = (tags: readonly string[]): string => {
  if (tags.length === 0) {
    return ''
  }

  const items = tags
    .map((tag) => `<li class="page-tag" data-pagefind-filter="tag">${escapeHtml(tag)}</li>`)
    .join('')

  return `<ul class="page-tags" aria-label="Tags" data-pagefind-ignore>${items}</ul>`
}

export const renderCoverImage = (
  currentRoutePath: string,
  coverImageArtifactPath: string | undefined,
  title: string,
): string => {
  if (!coverImageArtifactPath) {
    return ''
  }

  const src = buildRelativeRouteHref(currentRoutePath, `/${coverImageArtifactPath}`)

  return `<figure class="page-cover"><img${renderSrcAttributes(src)} alt="${escapeHtml(title)} cover image" data-pagefind-meta="image[src], image_alt[alt]" loading="eager" decoding="async"></figure>`
}

export const renderToc = (headings: HeadingInfo[]): string => {
  if (headings.length < 3) return ''
  const items = headings
    .map(
      (h) =>
        `<li class="toc-${h.level}"><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`,
    )
    .join('\n')
  return `<nav class="toc" aria-label="Table of contents" data-pagefind-ignore="all"><ol>${items}</ol></nav>`
}

export const renderListing = (
  currentRoutePath: string,
  listing: GardenListingContext | undefined,
): string => {
  if (!listing || listing.items.length === 0) return ''

  const items = listing.items
    .map((item) => {
      const href = buildRelativeRouteHref(currentRoutePath, item.routePath)
      const descHtml = item.description
        ? `<span class="listing-desc">${escapeHtml(item.description)}</span>`
        : ''
      const metaParts: string[] = []

      const listingDate = item.updated ?? item.date
      const listingDateFormatted = formatDisplayDate(listingDate) ?? listingDate

      if (listingDate && listingDateFormatted) {
        metaParts.push(
          `<time class="listing-date" datetime="${escapeHtml(listingDate)}">${escapeHtml(listingDateFormatted)}</time>`,
        )
      }

      if (item.tags && item.tags.length > 0) {
        metaParts.push(
          `<span class="listing-tags">${item.tags
            .slice(0, 4)
            .map((tag) => `<span class="listing-tag">${escapeHtml(tag)}</span>`)
            .join('')}</span>`,
        )
      }

      const metaHtml =
        metaParts.length > 0 ? `<span class="listing-meta">${metaParts.join('')}</span>` : ''

      return `<a class="listing-item"${renderHrefAttributes(href)}><span class="listing-body"><span class="listing-title">${escapeHtml(item.title)}</span>${descHtml}${metaHtml}</span><span class="listing-arrow" aria-hidden="true">→</span></a>`
    })
    .join('\n')

  let pagination = ''
  if (listing.totalPages > 1) {
    const pagePath = (page: number): string =>
      page === 1
        ? listing.parentRoutePath
        : listing.parentRoutePath === '/'
          ? `/page/${page}`
          : `${listing.parentRoutePath}/page/${page}`
    const prev =
      listing.currentPage > 1
        ? `<a class="pagination-prev"${renderHrefAttributes(buildRelativeRouteHref(currentRoutePath, pagePath(listing.currentPage - 1)))} rel="prev">← Newer</a>`
        : '<span class="pagination-placeholder"></span>'
    const next =
      listing.currentPage < listing.totalPages
        ? `<a class="pagination-next"${renderHrefAttributes(buildRelativeRouteHref(currentRoutePath, pagePath(listing.currentPage + 1)))} rel="next">Older →</a>`
        : '<span class="pagination-placeholder"></span>'

    pagination = `<nav class="pagination" aria-label="Pagination">${prev}<span class="pagination-info">${listing.currentPage} / ${listing.totalPages}</span>${next}</nav>`
  }

  return `<section class="listing" data-pagefind-ignore="all">${items}</section>${pagination}`
}

export const renderFooter = (_siteTitle?: string): string => ''
