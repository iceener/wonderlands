import { buildRelativeRouteHref } from './rewrite-links'
import { FAVICON_DATA_URI, FONTS_URL } from './render/assets'
import { GARDEN_CSS, GARDEN_LAYOUT_CSS } from './render/css'
import {
  escapeHtml,
  renderHrefAttributes,
  renderSrcAttributes,
  serializeJsonForHtml,
} from './render/html-utils'
import {
  GARDEN_ENHANCEMENTS_SCRIPT,
  GARDEN_NAV_SCRIPT,
  GARDEN_SEARCH_SCRIPT,
} from './render/scripts'
import type { GardenNavigationItem, GardenPageSeo, GardenSidebarItem } from './types'

// --- Types ---

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

interface HeadingInfo {
  id: string
  level: number
  text: string
}

interface MarkdownResult {
  headings: HeadingInfo[]
  html: string
}

export const GARDEN_PROTECTED_SEARCH_STATE_TOKEN = '__GARDEN_PROTECTED_SEARCH_STATE__'

// --- Utilities ---

const slugify = (text: string): string => {
  const slug = text
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'section'
}

const stripInlineMarkdown = (text: string): string =>
  text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')

const smartypants = (html: string): string => {
  const parts = html.split(
    /(<pre[\s>][\s\S]*?<\/pre>|<code[\s>][\s\S]*?<\/code>|<script[\s>][\s\S]*?<\/script>|<style[\s>][\s\S]*?<\/style>)/gi,
  )
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part
      return part.replace(/>([^<]+)</g, (_, text: string) => {
        let t = text
        t = t.replace(/---/g, '\u2014')
        t = t.replace(/--/g, '\u2013')
        t = t.replace(/\.\.\./g, '\u2026')
        t = t.replace(/(^|[\s(])&quot;/g, '$1\u201c')
        t = t.replace(/&quot;/g, '\u201d')
        t = t.replace(/(^|[\s(])&#39;/g, '$1\u2018')
        t = t.replace(/&#39;/g, '\u2019')
        return `>${t}<`
      })
    })
    .join('')
}

// --- Inline Markdown ---

const normalizeMarkdownUrl = (value: string): string => {
  const trimmed = value.trim()
  return trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1).trim() : trimmed
}

const renderInlineMarkdown = (value: string): string => {
  let output = escapeHtml(value)

  output = output.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_match, alt: string, src: string) =>
      `<img alt="${escapeHtml(alt)}"${renderSrcAttributes(normalizeMarkdownUrl(src))} loading="lazy" decoding="async">`,
  )
  output = output.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label: string, href: string) =>
      `<a${renderHrefAttributes(normalizeMarkdownUrl(href))}>${label}</a>`,
  )
  output = output.replace(
    /&lt;(https?:\/\/[^&]+)&gt;/g,
    (_match, href: string) => `<a${renderHrefAttributes(href)}>${escapeHtml(href)}</a>`,
  )
  output = output.replace(/`([^`]+)`/g, '<code>$1</code>')
  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  output = output.replace(/\*([^*]+)\*/g, '<em>$1</em>')

  return output
}

// --- Shortcodes / raw HTML compatibility ---

const NEWSLETTER_FORM_SHORTCODE_RE = /^\s*<NewsletterForm\s*\/?>\s*$/
const FENCE_RE = /^\s*(```|~~~)/

const renderNewsletterForm = (): string =>
  '<div class="newsletter-form" data-newsletter-form data-status="idle" data-pagefind-ignore="all"><form class="newsletter-form__form" novalidate><div class="newsletter-form__row"><input class="newsletter-form__input" data-newsletter-email type="email" inputmode="email" autocomplete="email" placeholder="your@email.com" aria-label="Email address" aria-invalid="false" required><button class="newsletter-form__button" data-newsletter-submit type="submit" disabled>I\'m in</button></div><p class="newsletter-form__hint newsletter-form__hint--error" data-newsletter-validation hidden>That email doesn\u2019t look right.</p><div class="newsletter-form__notice" data-newsletter-notice role="status" aria-live="polite" hidden></div></form></div>'

const renderShortcodes = (markdown: string): string => {
  let inFence = false

  return markdown
    .split('\n')
    .map((line) => {
      if (FENCE_RE.test(line)) {
        inFence = !inFence
        return line
      }

      return !inFence && NEWSLETTER_FORM_SHORTCODE_RE.test(line) ? renderNewsletterForm() : line
    })
    .join('\n')
}

const isAllowedRawHtmlBlock = (line: string): boolean => {
  const trimmed = line.trim()
  return /^<img\s[^>]*>$/.test(trimmed) || /^<div class="newsletter-form"\s/.test(trimmed)
}

interface ListMarker {
  content: string
  indent: number
  ordered: boolean
}

const parseListMarker = (line: string): ListMarker | null => {
  const match = line.match(/^(\s*)(?:([-*+])|(\d+)\.)\s+(.+)$/)

  if (!match) {
    return null
  }

  return {
    content: match[4],
    indent: match[1].length,
    ordered: match[3] !== undefined,
  }
}

const leadingSpaces = (line: string): number => line.match(/^\s*/)?.[0].length ?? 0

const renderListBlock = (
  lines: readonly string[],
  startIndex: number,
  baseIndent = parseListMarker(lines[startIndex] ?? '')?.indent ?? 0,
): { html: string; index: number } => {
  const firstMarker = parseListMarker(lines[startIndex] ?? '')

  if (!firstMarker) {
    return {
      html: '',
      index: startIndex,
    }
  }

  const ordered = firstMarker.ordered
  const tag = ordered ? 'ol' : 'ul'
  const items: string[] = []
  let index = startIndex

  while (index < lines.length) {
    const marker = parseListMarker(lines[index] ?? '')

    if (!marker || marker.indent !== baseIndent || marker.ordered !== ordered) {
      break
    }

    let itemHtml = renderInlineMarkdown(marker.content.trim())
    index += 1

    while (index < lines.length) {
      const line = lines[index] ?? ''

      if (line.trim().length === 0) {
        index += 1
        break
      }

      const nestedMarker = parseListMarker(line)

      if (nestedMarker) {
        if (nestedMarker.indent > baseIndent) {
          const nested = renderListBlock(lines, index, nestedMarker.indent)
          itemHtml += nested.html
          index = nested.index
          continue
        }

        break
      }

      if (leadingSpaces(line) > baseIndent) {
        itemHtml += `<br>${renderInlineMarkdown(line.trim())}`
        index += 1
        continue
      }

      break
    }

    items.push(`<li>${itemHtml}</li>`)
  }

  return {
    html: `<${tag}>${items.join('')}</${tag}>`,
    index,
  }
}

// --- Markdown to HTML ---

const renderMarkdownToHtml = (markdown: string): MarkdownResult => {
  const normalized = markdown.replace(/\r/g, '')
  const lines = normalized.split('\n')
  const html: string[] = []
  const headings: HeadingInfo[] = []
  const usedIds = new Map<string, number>()
  let index = 0

  const uniqueId = (base: string): string => {
    const count = usedIds.get(base) ?? 0
    usedIds.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
  }

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (line.trim().length === 0) {
      index += 1
      continue
    }

    if (isAllowedRawHtmlBlock(line)) {
      html.push(line.trim())
      index += 1
      continue
    }

    // Fenced code blocks with optional language and filename
    if (line.startsWith('```')) {
      const fenceMatch = line.match(/^```(\w+)?(?::(.+))?/)
      const lang = fenceMatch?.[1] ?? ''
      const filename = fenceMatch?.[2]?.trim() ?? ''
      const codeLines: string[] = []
      index += 1

      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        codeLines.push(lines[index] ?? '')
        index += 1
      }

      if (index < lines.length) {
        index += 1
      }

      const headerParts: string[] = []
      if (lang) headerParts.push(`<span class="code-lang">${escapeHtml(lang)}</span>`)
      if (filename) headerParts.push(`<span class="code-file">${escapeHtml(filename)}</span>`)
      const headerHtml =
        headerParts.length > 0 ? `<div class="code-header">${headerParts.join('')}</div>` : ''
      const ariaLabel = lang ? ` role="region" aria-label="${escapeHtml(lang)} code"` : ''
      html.push(
        `<div class="code-block"${ariaLabel}>${headerHtml}<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre></div>`,
      )
      continue
    }

    // Blockquotes
    if (line.startsWith('> ')) {
      const quoteLines: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('> ')) {
        quoteLines.push((lines[index] ?? '').slice(2).trim())
        index += 1
      }
      html.push(`<blockquote><p>${renderInlineMarkdown(quoteLines.join(' '))}</p></blockquote>`)
      continue
    }

    // Horizontal rules
    if (line.trim() === '---' || line.trim() === '***' || line.trim() === '___') {
      html.push('<hr>')
      index += 1
      continue
    }

    // Headings with auto-generated IDs
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const rawText = headingMatch[2]
      const plainText = stripInlineMarkdown(rawText)
      const id = uniqueId(slugify(plainText))

      if (level >= 2 && level <= 4) {
        headings.push({ id, level, text: plainText })
      }

      html.push(`<h${level} id="${escapeHtml(id)}">${renderInlineMarkdown(rawText)}</h${level}>`)
      index += 1
      continue
    }

    // Lists, including simple nested Obsidian/Markdown lists
    if (parseListMarker(line)) {
      const list = renderListBlock(lines, index)
      html.push(list.html)
      index = list.index
      continue
    }

    // Tables
    if (line.trimStart().startsWith('|') && index + 1 < lines.length) {
      const nextLine = (lines[index + 1] ?? '').trim()
      if (nextLine.startsWith('|') && /^[\s|:-]+$/.test(nextLine)) {
        const parseRow = (row: string): string[] =>
          row
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((cell) => cell.trim())

        const headerCells = parseRow(line)
        index += 2 // skip header + separator

        const headerHtml = headerCells
          .map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`)
          .join('')

        const bodyRows: string[] = []
        while (index < lines.length && (lines[index] ?? '').trimStart().startsWith('|')) {
          const cells = parseRow(lines[index] ?? '')
          const rowHtml = cells.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join('')
          bodyRows.push(`<tr>${rowHtml}</tr>`)
          index += 1
        }

        html.push(
          `<div class="table-wrap"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyRows.join('')}</tbody></table></div>`,
        )
        continue
      }
    }

    // Paragraphs
    const paragraphLines: string[] = []
    while (
      index < lines.length &&
      (lines[index] ?? '').trim().length > 0 &&
      !(lines[index] ?? '').startsWith('```') &&
      !parseListMarker(lines[index] ?? '') &&
      !(lines[index] ?? '').startsWith('> ') &&
      !(lines[index] ?? '').trimStart().startsWith('|') &&
      !/^(#{1,6})\s+/.test(lines[index] ?? '') &&
      !/^(---|___|\*\*\*)$/.test((lines[index] ?? '').trim())
    ) {
      paragraphLines.push((lines[index] ?? '').trim())
      index += 1
    }
    if (paragraphLines.length === 0) {
      // Always consume unsupported block-like input. In particular, a pipe-prefixed
      // line without a Markdown table delimiter is plain text, not a table. Leaving
      // the cursor unchanged here would loop forever and exhaust process memory.
      html.push(`<p>${renderInlineMarkdown(line.trim())}</p>`)
      index += 1
      continue
    }

    html.push(`<p>${renderInlineMarkdown(paragraphLines.join(' '))}</p>`)
  }

  return { headings, html: html.join('\n') }
}

// --- Page Components ---

const renderSitemapItems = (
  items: readonly GardenSidebarItem[],
  currentRoutePath: string,
): string =>
  items
    .map((item) => {
      const itemHref = item.path ? buildRelativeRouteHref(currentRoutePath, item.path) : null
      const content = itemHref
        ? `<a${renderHrefAttributes(itemHref)}>${escapeHtml(item.label)}</a>`
        : `<span>${escapeHtml(item.label)}</span>`
      const children =
        item.children.length > 0
          ? `<ul>${renderSitemapItems(item.children, currentRoutePath)}</ul>`
          : ''

      return `<li>${content}${children}</li>`
    })
    .join('\n')

const resolvePageSection = (sourceSlug: string): string | undefined => {
  if (!sourceSlug || sourceSlug === 'index') {
    return undefined
  }

  const parent = sourceSlug.split('/').slice(0, -1).join('/')
  return parent || sourceSlug
}

const renderSearchMetadata = (input: {
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

const renderSeoMeta = (input: {
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

  meta.push(
    `<title>${escapeHtml(input.routePath === '/' && input.siteTitle ? input.siteTitle : documentTitle)}</title>`,
  )

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

const renderUpdatedStamp = (lastUpdated?: string): string => {
  const formatted = formatDisplayDate(lastUpdated)
  if (!formatted || !lastUpdated) return ''
  return `<p class="page-updated" data-pagefind-ignore="all">Last updated <time datetime="${escapeHtml(lastUpdated)}">${escapeHtml(formatted)}</time></p>`
}

const renderGrowthMarkers = (date?: string, updated?: string): string => {
  if (!date && !updated) return ''
  const parts: string[] = []
  if (date) parts.push(`planted <time datetime="${escapeHtml(date)}">${escapeHtml(date)}</time>`)
  if (updated && updated !== date)
    parts.push(`tended <time datetime="${escapeHtml(updated)}">${escapeHtml(updated)}</time>`)
  if (parts.length === 0) return ''
  return `<p class="growth" data-pagefind-ignore="all">${parts.join(' \u00b7 ')}</p>`
}

const renderPageTags = (tags: readonly string[]): string => {
  if (tags.length === 0) {
    return ''
  }

  const items = tags
    .map((tag) => `<li class="page-tag" data-pagefind-filter="tag">${escapeHtml(tag)}</li>`)
    .join('')

  return `<ul class="page-tags" aria-label="Tags" data-pagefind-ignore>${items}</ul>`
}

const renderCoverImage = (
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

const renderToc = (headings: HeadingInfo[]): string => {
  if (headings.length < 3) return ''
  const items = headings
    .map(
      (h) =>
        `<li class="toc-${h.level}"><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`,
    )
    .join('\n')
  return `<nav class="toc" aria-label="Table of contents" data-pagefind-ignore="all"><ol>${items}</ol></nav>`
}

const renderListing = (
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

const renderFooter = (_siteTitle?: string): string => ''

const renderSearchPanel = (hasProtectedSearch: boolean): string => `
<section class="garden-search" data-garden-search-root data-pagefind-ignore="all">
  <div class="garden-search-field">
    <input
      class="garden-search-input"
      data-garden-search-input
      id="garden-search-input"
      name="q"
      autocomplete="off"
      placeholder="Search pages, notes, headings…"
      spellcheck="false"
      type="text"
      role="searchbox"
      aria-label="Search this garden">
    <kbd class="garden-search-kbd" data-garden-search-kbd>/</kbd>
  </div>
  <div class="garden-search-popover" data-garden-search-popover>
    <div class="garden-search-filters" data-garden-search-filters hidden></div>
    <p aria-live="polite" class="garden-search-status" data-garden-search-status hidden></p>
    <div class="garden-search-results" data-garden-search-results role="listbox" aria-label="Search results" hidden></div>
  </div>
</section>
`

const renderHiddenSitemap = (
  sidebarItems: readonly GardenSidebarItem[],
  currentRoutePath: string,
): string =>
  sidebarItems.length > 0
    ? `<nav class="garden-sitemap" hidden data-pagefind-ignore="all" aria-label="Sitemap"><ul>${renderSitemapItems(sidebarItems, currentRoutePath)}</ul></nav>`
    : ''

const renderTopNavigation = (input: {
  currentRoutePath: string
  hasProtectedSearch: boolean
  navigationItems: readonly GardenNavigationItem[]
  sidebarItems: readonly GardenSidebarItem[]
  siteTitle?: string
}): string => {
  const homeHref = buildRelativeRouteHref(input.currentRoutePath, '/')
  const brand = input.siteTitle
    ? `<a${renderHrefAttributes(homeHref)} class="site-title">${escapeHtml(input.siteTitle)}</a>`
    : ''
  const fallbackItems = input.sidebarItems
    .filter((item) => item.path && item.path !== '/')
    .map((item) => ({ label: item.label, path: item.path as string }))
  const navigationItems = input.navigationItems.length > 0 ? input.navigationItems : fallbackItems
  const links = navigationItems
    .map((item) => {
      const href = buildRelativeRouteHref(input.currentRoutePath, item.path)
      const normalizedPath = item.path === '/' ? '/' : item.path.replace(/\/+$/g, '')
      const active =
        input.currentRoutePath === normalizedPath ||
        (normalizedPath !== '/' && input.currentRoutePath.startsWith(`${normalizedPath}/`))
      const activeClass = active ? ' class="active"' : ''
      const currentAttr = active ? ' aria-current="page"' : ''
      return `<a${renderHrefAttributes(href)}${activeClass}${currentAttr}>${escapeHtml(item.label)}</a>`
    })
    .join('\n      ')

  return `<nav class="garden-topnav" data-pagefind-ignore="all">${brand}<div class="nav-links">${links}</div>${renderSearchPanel(input.hasProtectedSearch)}</nav>`
}

const renderSearchConfig = (input: {
  hasProtectedSearch: boolean
  searchSectionLabels: Record<string, string>
}): string =>
  `<script type="application/json" data-garden-search-config>${serializeJsonForHtml({
    hasProtectedSearch: input.hasProtectedSearch,
    protectedSearchState: GARDEN_PROTECTED_SEARCH_STATE_TOKEN,
    sectionLabels: input.searchSectionLabels,
  })}</script>`

// --- Main Render ---

export const renderGardenPage = (input: {
  bodyMarkdown: string
  coverImageArtifactPath?: string
  currentRoutePath: string
  date?: string
  description?: string
  excerpt?: string
  hasProtectedSearch: boolean
  lastUpdated?: string
  listing?: GardenListingContext
  order?: number
  seo?: GardenPageSeo
  searchSectionLabels: Record<string, string>
  navigationItems?: readonly GardenNavigationItem[]
  noindex?: boolean
  sidebarItems: readonly GardenSidebarItem[]
  siteDescription?: string
  siteImage?: string
  siteTitle?: string
  siteTwitter?: string
  sourceSlug: string
  tags?: readonly string[]
  title: string
  updated?: string
  visibility: 'protected' | 'public'
}): string => {
  const { headings, html: bodyHtml } = renderMarkdownToHtml(renderShortcodes(input.bodyMarkdown))
  const topNavigationHtml = renderTopNavigation({
    currentRoutePath: input.currentRoutePath,
    hasProtectedSearch: input.hasProtectedSearch,
    navigationItems: input.navigationItems ?? [],
    sidebarItems: input.sidebarItems,
    siteTitle: input.siteTitle,
  })
  const hiddenSitemapHtml = renderHiddenSitemap(input.sidebarItems, input.currentRoutePath)
  const coverImageHtml = renderCoverImage(
    input.currentRoutePath,
    input.coverImageArtifactPath,
    input.title,
  )
  const updatedStampHtml = renderUpdatedStamp(input.lastUpdated)
  const growthHtml = renderGrowthMarkers(input.date, input.updated)
  const tagsHtml = renderPageTags(input.tags ?? [])
  const tocHtml = renderToc(headings)
  const listingHtml = renderListing(input.currentRoutePath, input.listing)
  const footerHtml = renderFooter(input.siteTitle)
  const searchConfigHtml = renderSearchConfig({
    hasProtectedSearch: input.hasProtectedSearch,
    searchSectionLabels: input.searchSectionLabels,
  })
  const searchMetaHtml = renderSearchMetadata({
    coverImageArtifactPath: input.coverImageArtifactPath,
    date: input.date,
    description: input.description,
    excerpt: input.excerpt,
    order: input.order,
    sourceSlug: input.sourceSlug,
    tags: input.tags ?? [],
    title: input.title,
    updated: input.updated,
    visibility: input.visibility,
  })

  const raw = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<style>:root{color-scheme:light dark;background:#fafaf7}@media(prefers-color-scheme:dark){:root{background:#0b0b0d}}</style>',
    '<script>(()=>{try{const stored=parseFloat(localStorage.getItem("overment.contentWidth")||"");if(!Number.isFinite(stored))return;const clamped=Math.max(36,Math.min(68,stored));document.documentElement.style.setProperty("--content-width",`${clamped.toFixed(2)}rem`)}catch{}})();</script>',
    `<link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">`,
    '<link rel="apple-touch-icon" sizes="180x180" data-garden-link="internal" href="/public/favicons/apple-touch-icon.png">',
    '<link rel="icon" type="image/png" sizes="32x32" data-garden-link="internal" href="/public/favicons/favicon-32x32.png">',
    '<link rel="icon" type="image/png" sizes="16x16" data-garden-link="internal" href="/public/favicons/favicon-16x16.png">',
    '<link rel="manifest" data-garden-link="internal" href="/public/favicons/site.webmanifest">',
    '<meta name="theme-color" content="#fafaf7" media="(prefers-color-scheme: light)">',
    '<meta name="theme-color" content="#0b0b0d" media="(prefers-color-scheme: dark)">',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${FONTS_URL}">`,
    renderSeoMeta({
      description: input.description,
      noindex: input.noindex,
      routePath: input.currentRoutePath,
      seo: input.seo,
      siteDescription: input.siteDescription,
      siteImage: input.siteImage,
      siteTitle: input.siteTitle,
      siteTwitter: input.siteTwitter,
      title: input.title,
    }),
    searchMetaHtml,
    searchConfigHtml,
    `<style>${GARDEN_CSS}\n${GARDEN_LAYOUT_CSS}</style>`,
    '</head>',
    `<body data-garden-layout="top-navigation" data-garden-has-protected-search="${input.hasProtectedSearch ? 'true' : 'false'}" data-garden-route-path="${escapeHtml(input.currentRoutePath)}" data-garden-visibility="${input.visibility}">`,
    '<a href="#content" class="skip-link">Skip to content</a>',
    '<div class="garden-shell">',
    topNavigationHtml,
    hiddenSitemapHtml,
    '<div class="garden-content">',
    '<main id="content">',
    '<section class="page-searchable" data-pagefind-body>',
    coverImageHtml,
    `<h1 class="page-title" data-pagefind-meta="title">${escapeHtml(input.title)}</h1>`,
    updatedStampHtml,
    growthHtml,
    tagsHtml,
    tocHtml,
    `<article>${bodyHtml}</article>`,
    '</section>',
    listingHtml,
    '</main>',
    footerHtml,
    '</div>',
    '</div>',
    `<script>${GARDEN_NAV_SCRIPT}</script>`,
    `<script>${GARDEN_ENHANCEMENTS_SCRIPT}</script>`,
    `<script type="module">${GARDEN_SEARCH_SCRIPT}</script>`,
    '</body>',
    '</html>',
  ]
    .filter((part) => part.length > 0)
    .join('\n')

  return smartypants(raw)
}
