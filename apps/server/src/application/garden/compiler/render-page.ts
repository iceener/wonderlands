import { buildRelativeRouteHref, GARDEN_INTERNAL_HREF_PREFIX } from './rewrite-links'
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

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const serializeJsonForHtml = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')

const UNSAFE_URL_RE = /^(javascript|data|vbscript):/i

const sanitizeUrl = (url: string): string => {
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

const renderHrefAttributes = (rawUrl: string): string => {
  const resolved = resolveGardenInternalUrl(rawUrl)
  const href = escapeHtml(sanitizeUrl(resolved.url))

  return resolved.internal ? ` data-garden-link="internal" href="${href}"` : ` href="${href}"`
}

const renderSrcAttributes = (rawUrl: string): string => {
  const resolved = resolveGardenInternalUrl(rawUrl)
  const src = escapeHtml(sanitizeUrl(resolved.url))

  return resolved.internal ? ` data-garden-link="internal" src="${src}"` : ` src="${src}"`
}

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

// --- Fonts ---

const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400&family=Lexend:wght@300;400;500;600;700&display=swap'

const FAVICON_DATA_URI =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16.2521 28V22.417H9.40065C6.29705 22.417 3.78125 19.9012 3.78125 16.7976V15.4575C3.78125 12.5431 5.71983 10.072 8.37434 9.26672L6.61329 5.0169L9.06913 4L12.2374 11.6473H9.39947C7.7642 11.6473 6.43812 12.9734 6.43812 14.6087V16.7965C6.43812 18.4317 7.7642 19.7578 9.39947 19.7578H18.909V22.7509C20.8369 21.3355 23.4621 19.4087 23.9876 19.0231C24.9645 18.3071 25.5476 17.1574 25.5476 15.9489V14.6087C25.5476 12.9734 24.2215 11.6473 22.5862 11.6473H14.1113L12.9451 8.98927H22.5851C25.6887 8.98927 28.2045 11.5051 28.2045 14.6087V15.9477C28.2045 18.0003 27.2158 19.9506 25.5594 21.165C24.7082 21.7893 18.3658 26.4447 18.3658 26.4447L16.2509 27.9977L16.2521 28Z" fill="#d4d4d8"/><path d="M23.0492 4.00023L20.3594 10.4941L22.8151 11.5113L25.505 5.01742L23.0492 4.00023Z" fill="#d4d4d8"/><path d="M5.59961 14.2764H2.39844V17.2295H5.59961V14.2764Z" fill="#d4d4d8"/><path d="M29.7012 14.2764H26.5V17.2295H29.7012V14.2764Z" fill="#d4d4d8"/></svg>',
  )

// --- CSS ---

const GARDEN_CSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
[hidden]{display:none!important}

:root{
color-scheme:light;
--bg:#fff;
--surface-0:#fcfcfc;
--surface-1:#f4f4f5;
--surface-2:#e4e4e7;
--border:#e4e4e7;
--border-strong:#d4d4d8;
--text:#09090b;
--text-secondary:#52525b;
--text-tertiary:#a1a1aa;
--accent:#2563eb;
--accent-soft:#eff6ff;
--accent-text:#1d4ed8;
--font-sans:"Lexend Deca",system-ui,-apple-system,sans-serif;
--font-heading:"Lexend","Lexend Deca",system-ui,sans-serif;
--font-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}

@media(prefers-color-scheme:dark){
:root{
color-scheme:dark;
--bg:#131316;
--surface-0:#19191e;
--surface-1:#212127;
--surface-2:#2b2b33;
--border:#ffffff14;
--border-strong:#ffffff22;
--text:#d4d4d8;
--text-secondary:#9494a0;
--text-tertiary:#85859a;
--accent:#5b9cf6;
--accent-soft:#5b9cf612;
--accent-text:#7bb4fc;
}
body{border-top-color:color-mix(in srgb,var(--accent) 40%,transparent)}
}

html{
background:var(--bg);
color:var(--text);
-webkit-font-smoothing:antialiased;
-moz-osx-font-smoothing:grayscale;
text-rendering:optimizeSpeed;
}

body{
margin:0;
min-height:100dvh;
border-top:3px solid var(--accent);
font-family:var(--font-sans);
font-size:clamp(0.9375rem,0.88rem + 0.25vw,1.0625rem);
line-height:1.7;
letter-spacing:0.005em;
font-optical-sizing:auto;
}

.garden-shell{
display:block;
min-height:100dvh;
}

.skip-link{
position:absolute;
left:-9999px;
top:auto;
width:1px;
height:1px;
overflow:hidden;
font-size:0.8125rem;
background:var(--bg);
color:var(--accent-text);
padding:0.5rem 1rem;
border:1px solid var(--border);
border-radius:4px;
z-index:100;
text-decoration:none;
}
.skip-link:focus{
position:fixed;
left:1rem;
top:1rem;
width:auto;
height:auto;
overflow:visible;
}

.garden-search{
display:flex;
flex-direction:column;
gap:0.35rem;
}

.garden-search-field{
position:relative;
display:flex;
align-items:center;
}

.garden-search-input{
width:100%;
height:2.25rem;
padding:0 2.2rem 0 0.6rem;
border:1px solid var(--border);
border-radius:6px;
background:var(--surface-1);
color:var(--text);
font:inherit;
font-size:0.8125rem;
line-height:1.4;
-webkit-appearance:none;
appearance:none;
}

.garden-search-input::-webkit-search-cancel-button,
.garden-search-input::-webkit-search-decoration{
-webkit-appearance:none;
appearance:none;
display:none;
}

.garden-search-input::placeholder{
color:var(--text-tertiary);
font-size:0.8125rem;
}

.garden-search-input:focus-visible{
outline:none;
border-color:var(--border-strong);
background:var(--bg);
}

.garden-search-kbd{
position:absolute;
right:0.45rem;
display:flex;
align-items:center;
justify-content:center;
min-width:1.25rem;
height:1.25rem;
padding:0 0.3rem;
border:1px solid var(--border);
border-radius:4px;
background:var(--surface-0);
font-family:var(--font-sans);
font-size:0.625rem;
font-weight:500;
line-height:1;
color:var(--text-tertiary);
pointer-events:none;
}

.garden-search-input:focus ~ .garden-search-kbd{
display:none;
}

.garden-search-filters{
display:flex;
flex-wrap:wrap;
gap:0.3rem;
}

.garden-search-filters[hidden]{
display:none !important;
}

.garden-search-filter{
display:inline-flex;
align-items:center;
gap:0.35rem;
height:1.5rem;
padding:0 0.5rem;
border:1px solid var(--border);
border-radius:9999px;
background:transparent;
font-family:var(--font-sans);
font-size:0.6875rem;
font-weight:500;
line-height:1;
color:var(--text-secondary);
cursor:pointer;
transition:background-color 150ms ease,border-color 150ms ease,color 150ms ease;
}

.garden-search-filter:hover{
background:var(--surface-1);
color:var(--text);
}

.garden-search-filter.is-active{
background:var(--accent-soft);
border-color:color-mix(in srgb,var(--accent) 30%,transparent);
color:var(--text);
}

.garden-search-filter-count{
display:inline-flex;
align-items:center;
justify-content:center;
min-width:1rem;
padding:0 0.28rem;
border-radius:9999px;
background:var(--surface-1);
font-size:0.625rem;
font-weight:600;
line-height:1.1;
color:var(--text-tertiary);
}

.garden-search-filter.is-active .garden-search-filter-count{
background:color-mix(in srgb,var(--accent) 16%,var(--surface-0));
color:var(--text-secondary);
}

.garden-search-status{
font-size:0.6875rem;
font-weight:500;
letter-spacing:0.04em;
text-transform:uppercase;
line-height:1.5;
color:var(--text-tertiary);
}

.garden-search-results{
display:flex;
flex-direction:column;
}

.garden-search-results[hidden],
.garden-search-status[hidden]{
display:none !important;
}

.garden-search-empty{
padding:0.4rem 0.6rem;
font-size:0.8125rem;
line-height:1.5;
color:var(--text-tertiary);
}

.garden-search-error{
padding:0.4rem 0.6rem;
font-size:0.8125rem;
line-height:1.5;
color:var(--text-tertiary);
}

.garden-search-result{
display:block;
padding:0.45rem 0.6rem;
border-radius:6px;
text-decoration:none;
transition:background-color 150ms ease;
}

.garden-search-result:hover,
.garden-search-result.is-active{
background:var(--surface-1);
text-decoration:none;
}

.garden-search-result.is-active{
outline:none;
}

.garden-search-result-title{
display:block;
font-family:var(--font-heading);
font-size:0.8125rem;
font-weight:600;
line-height:1.35;
color:var(--text);
}

.garden-search-result-excerpt{
display:block;
margin-top:0.15rem;
font-size:0.75rem;
line-height:1.5;
color:var(--text-secondary);
}

.garden-search-result mark,
.garden-search-subresult mark{
padding:0.05em 0.15em;
border-radius:0.2em;
background:color-mix(in srgb,var(--accent) 18%,transparent);
color:var(--accent-text);
}

.garden-search-subresults{
margin-top:0.25rem;
display:flex;
flex-direction:column;
}

.garden-search-subresult{
display:block;
padding:0.2rem 0 0.2rem 0.7rem;
border-left:1px solid var(--border);
margin-left:0.35rem;
text-decoration:none;
transition:border-color 150ms ease;
}

.garden-search-subresult:hover{
text-decoration:none;
border-left-color:var(--accent);
}

.garden-search-subresult .garden-search-result-title{
font-size:0.75rem;
font-weight:500;
color:var(--text-secondary);
}

.garden-search-subresult:hover .garden-search-result-title{
color:var(--text);
}

.garden-search-subresult .garden-search-result-excerpt{
font-size:0.6875rem;
color:var(--text-tertiary);
}

.garden-content{
min-width:0;
view-transition-name:content;
}

main{
max-width:760px;
width:100%;
margin:0;
padding:2.5rem clamp(1.25rem,2vw,2rem) 4rem;
}

main>article{
line-height:1.8;
letter-spacing:0.008em;
word-break:break-word;
}

main>article>:first-child{margin-top:0}
main>article>:last-child{margin-bottom:0}

.page-title{
font-family:var(--font-heading);
font-size:1.75rem;
font-weight:700;
letter-spacing:-0.03em;
line-height:1.2;
color:var(--text);
margin:0 0 0.5rem;
}

.page-description{
margin:0 0 0.9rem;
font-size:0.98rem;
line-height:1.7;
color:var(--text-secondary);
text-wrap:pretty;
}

.page-tags{
display:flex;
flex-wrap:wrap;
align-items:center;
gap:0.35rem;
list-style:none;
padding:0;
margin:0 0 1.35rem;
}

.page-tag{
display:inline-block;
padding:0.2rem 0.45rem;
border:1px solid var(--border);
border-radius:4px;
font-size:0.6875rem;
font-weight:500;
line-height:1;
letter-spacing:0.03em;
text-transform:uppercase;
color:var(--text-tertiary);
}

.page-cover{
margin:0 0 1rem;
position:relative;
overflow:hidden;
border-radius:8px 8px 0 0;
}

.page-cover::after{
content:'';
position:absolute;
inset:0;
background:linear-gradient(to top,var(--bg) 0%,transparent 45%);
pointer-events:none;
}

.page-cover img{
display:block;
width:100%;
max-height:28rem;
object-fit:cover;
}

.growth{
margin-bottom:1.5rem;
font-size:0.75rem;
color:var(--text-tertiary);
letter-spacing:0.01em;
font-variant-numeric:tabular-nums;
}

.toc{
margin-bottom:2rem;
padding:1rem 1.25rem;
border:1px solid var(--border);
border-radius:4px;
background:var(--surface-0);
}

.toc ol{list-style:none;padding:0;margin:0}
.toc li{margin:0;line-height:1.5}
// .toc li+li{margin-top:0.25em}
.toc a{
font-size:0.8125rem;
color:var(--text-secondary);
text-decoration:none;
transition:color 150ms ease;
}
.toc a:hover{color:var(--accent-text)}
.toc .toc-3{padding-left:1em}
.toc .toc-4{padding-left:2em}

h1,h2,h3,h4{
font-family:var(--font-heading);
font-weight:600;
color:var(--text);
line-height:1.25;
margin:1.5em 0 0.4em;
scroll-margin-top:1.5rem;
}

h1{font-size:1.5em;letter-spacing:-0.025em;font-weight:700}
h2{font-size:1.25em;letter-spacing:-0.02em}
h3{font-size:1.0625em;letter-spacing:-0.015em}
h4{font-size:0.8125em;letter-spacing:0.06em;text-transform:uppercase;font-weight:500;color:var(--text-secondary)}

main>article>p:first-child{font-size:1.0625em;color:var(--text-secondary)}

p{margin:1em 0;text-wrap:pretty;hanging-punctuation:first last}

ul{list-style-type:disc}
ol{list-style-type:decimal}
ul,ol{padding-left:1.5em;margin:0.5em 0}
li{display:list-item;color:var(--text);text-wrap:pretty}
// li+li{margin-top:0.45em}
li::marker{color:var(--text-tertiary)}

a{
color:var(--accent-text);
text-decoration:underline;
text-decoration-color:var(--border-strong);
text-decoration-thickness:1px;
text-underline-offset:2px;
transition:color 150ms ease,text-decoration-color 200ms ease;
}
a:hover{text-decoration-color:var(--accent-text)}

main>article a[href^="http"]::after,
main>article a[href^="//"]::after{
content:'\\2197';
display:inline-block;
font-size:0.7em;
margin-left:0.15em;
color:var(--text-tertiary);
text-decoration:none;
}

strong{font-weight:600;color:var(--text)}
em{font-style:normal;color:var(--text-secondary);border-bottom:1px solid var(--border-strong)}

blockquote{
margin:1em 0;
padding:0.5em 1em;
border-left:2px solid var(--accent);
background:var(--accent-soft);
border-radius:0 4px 4px 0;
color:var(--text-secondary);
}
blockquote p{margin:0;color:inherit}

hr{border:none;text-align:center;margin:2em 0;overflow:visible}
hr::after{content:'\u00b7  \u00b7  \u00b7';color:var(--text-tertiary);letter-spacing:0.3em}

:not(pre)>code{
padding:0.18em 0.44em;
border-radius:4px;
background:var(--surface-2);
font-size:0.84em;
font-family:var(--font-mono);
color:var(--text);
font-variant-ligatures:none;
}

.code-block{
margin:1em 0;
overflow:hidden;
border-radius:4px;
border:1px solid var(--border);
background:var(--surface-0);
box-shadow:inset 0 1px 0 #ffffff05;
transition:border-color 150ms ease;
}
.code-block:hover{border-color:var(--border-strong)}

.code-header{
display:flex;
align-items:center;
gap:12px;
min-height:40px;
padding:0 14px;
background:var(--surface-1);
border-bottom:1px solid var(--border);
}

.code-lang{
font-family:var(--font-mono);
font-size:0.6875rem;
font-weight:600;
letter-spacing:0.05em;
text-transform:uppercase;
color:var(--text-tertiary);
transition:color 150ms ease;
}
.code-block:hover .code-lang{color:var(--text-secondary)}

.code-file{
font-family:var(--font-mono);
font-size:0.6875rem;
color:var(--text-secondary);
letter-spacing:0.01em;
margin-left:auto;
}

.code-block pre{margin:0;overflow-x:auto;padding:14px 16px}

.code-block code{
font-family:var(--font-mono);
font-size:0.8125rem;
line-height:1.65;
color:var(--text);
font-variant-ligatures:none;
}

img{display:block;max-width:100%;height:auto;border-radius:4px;margin:1em 0}

.table-wrap{
margin:1em 0;
overflow-x:auto;
border:1px solid var(--border);
border-radius:4px;
background:var(--surface-0);
}

table{
width:100%;
border-collapse:collapse;
margin:0;
}

th,td{
padding:10px 14px;
border-bottom:1px solid var(--border);
text-align:left;
font-size:0.8125em;
font-variant-numeric:tabular-nums;
letter-spacing:0.01em;
}

th{
font-family:var(--font-heading);
color:var(--text-secondary);
font-weight:500;
border-bottom-color:var(--border-strong);
}

td{color:var(--text)}

tr:nth-child(even) td{background:var(--surface-1)}

.listing{margin-top:2rem}

.listing-item{
padding:0.75rem 0;
border-bottom:1px solid var(--border);
}
.listing-item:first-child{border-top:1px solid var(--border)}

.listing-item a{
font-family:var(--font-heading);
font-weight:600;
font-size:1em;
color:var(--text);
text-decoration:none;
transition:color 150ms ease;
}
.listing-item a:hover{color:var(--accent-text)}

.listing-desc{
margin:0.25em 0 0;
font-size:0.875em;
color:var(--text-secondary);
line-height:1.5;
}

.listing-item time{
display:block;
margin-top:0.25em;
font-size:0.75rem;
color:var(--text-tertiary);
font-variant-numeric:tabular-nums;
letter-spacing:0.01em;
}

.listing-nav{
display:flex;
align-items:center;
justify-content:center;
gap:1rem;
margin-top:1.5rem;
font-size:0.8125rem;
color:var(--text-tertiary);
}
.listing-nav a{
color:var(--accent-text);
text-decoration:none;
}
.listing-nav a:hover{text-decoration:underline}

footer{
max-width:760px;
width:100%;
margin:0;
padding:0 clamp(1.25rem,2vw,2rem) 2rem;
font-size:0.6875rem;
color:var(--text-tertiary);
letter-spacing:0.015em;
}

is-land{
display:block;
contain:content;
font:inherit;
color:inherit;
letter-spacing:inherit;
}
is-land:not(:defined){opacity:0}
is-land:defined{animation:island-enter 150ms ease}
is-land[aria-busy="true"]{opacity:0.5;pointer-events:none}

@keyframes island-enter{
from{clip-path:inset(4%);opacity:0}
to{clip-path:inset(0);opacity:1}
}

::selection{background:color-mix(in srgb,var(--accent) 20%,transparent);color:var(--accent-text)}
pre ::selection{background:var(--surface-2)}

*{scrollbar-width:thin;scrollbar-color:var(--border-strong) var(--surface-2)}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:var(--surface-2);border-radius:999px}
::-webkit-scrollbar-thumb{background:var(--border-strong);border-radius:999px}
::-webkit-scrollbar-thumb:hover{background:var(--text-tertiary)}

a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}

@media print{
body{border-top:none}
.garden-topnav,.garden-sitemap,.skip-link,.toc,footer{display:none}
main{max-width:100%;padding:0}
main>article a[href^="http"]::after{content:" (" attr(href) ")";font-size:0.8em;color:#666}
.code-block,blockquote{break-inside:avoid}
h1,h2,h3,h4{break-after:avoid}
*{color:#000 !important;background:transparent !important;border-color:#ccc !important}
}

@media(max-width:900px){
main{
max-width:none;
padding:1.5rem 1rem 3rem;
}

footer{
max-width:none;
padding:0 1rem 1.5rem;
}
}

@media(prefers-reduced-motion:reduce){
*,*::before,*::after{transition-duration:0s !important;animation-duration:0s !important}
}

@media(prefers-reduced-motion:no-preference){
html{scroll-behavior:smooth}
}

@view-transition{navigation:auto}
`

const GARDEN_LAYOUT_CSS = `
@view-transition{navigation:auto}
::view-transition-old(root),::view-transition-new(root){animation-duration:180ms;animation-timing-function:cubic-bezier(.4,0,.2,1)}

:root{
--content-width:38rem;
--bg:#fafaf7;
--surface:#ffffff;
--surface-0:#ffffff;
--surface-1:#f4f3ee;
--surface-2:#ecebe5;
--border:rgba(15,15,15,.08);
--border-strong:rgba(15,15,15,.16);
--fg:#3f3f46;
--fg-strong:#09090b;
--fg-muted:#52525b;
--fg-faint:#a1a1aa;
--text:var(--fg-strong);
--text-secondary:var(--fg-muted);
--text-tertiary:var(--fg-faint);
--accent:#9333ea;
--accent-hover:#7e22ce;
--accent-soft:#d8b4fe;
--accent-text:var(--accent);
--link:var(--accent);
--link-hover:var(--accent-hover);
--link-underline:color-mix(in srgb,var(--accent) 45%,transparent);
--selection-bg:#e9d5ff;
--selection-fg:#3b0764;
--font-sans:"Lexend",-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;
--font-heading:var(--font-sans);
--font-mono:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,monospace;
}

@media(prefers-color-scheme:dark){
:root{
--bg:#0b0b0d;
--surface:#131316;
--surface-0:#131316;
--surface-1:#18181b;
--surface-2:#222228;
--border:rgba(255,255,255,.07);
--border-strong:rgba(255,255,255,.14);
--fg:#a1a1aa;
--fg-strong:#fafafa;
--fg-muted:#71717a;
--fg-faint:#52525b;
--text:var(--fg-strong);
--text-secondary:var(--fg-muted);
--text-tertiary:var(--fg-faint);
--accent:#c084fc;
--accent-hover:#d8b4fe;
--accent-soft:#a855f7;
--accent-text:var(--accent);
--link:var(--accent);
--link-hover:var(--accent-hover);
--link-underline:color-mix(in srgb,var(--accent) 60%,transparent);
--selection-bg:rgba(192,132,252,.35);
--selection-fg:#faf5ff;
}
html{color-scheme:dark}
}

*{scrollbar-width:thin;scrollbar-color:var(--border-strong) transparent}
::selection{background:var(--selection-bg);color:var(--selection-fg)}
html{background:var(--bg);scroll-behavior:smooth;scrollbar-gutter:stable;overflow-y:scroll}
body{border-top:0;background:var(--bg);color:var(--fg);font-family:var(--font-sans);font-weight:350;font-size:16px;line-height:1.7;letter-spacing:0;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
body.no-scroll{overflow:hidden}
.skip-link{background:var(--surface);color:var(--accent);border-color:var(--border)}

.garden-topnav{max-width:var(--content-width);margin:0 auto;padding:2.25rem 1.5rem 1.25rem;display:flex;flex-wrap:wrap;align-items:baseline;gap:1rem 1.5rem;border-bottom:1px solid var(--border);position:relative;z-index:20}
.site-title{font-family:var(--font-sans);font-weight:600;font-size:.95rem;letter-spacing:-.02em;color:var(--fg-strong);text-decoration:none;white-space:nowrap;margin-right:auto}
.site-title:hover{color:var(--fg-strong);text-decoration:none}
.nav-links{display:flex;flex-wrap:wrap;gap:1.35rem;align-items:center}
.nav-links a{position:relative;font-size:.85rem;font-weight:400;letter-spacing:-.005em;color:var(--fg-muted);text-decoration:none;padding-bottom:.15rem;white-space:nowrap}
.nav-links a:hover,.nav-links a.active{color:var(--fg-strong);text-decoration:none}
.nav-links a.active::after{content:"";position:absolute;left:0;right:0;bottom:-.4rem;height:1.5px;background:var(--fg-strong)}

.garden-search{flex:1 1 22rem;min-width:min(18rem,100%);display:flex;flex-direction:column;gap:.35rem;position:relative;margin-left:auto}
.garden-search-field{position:relative;display:flex;align-items:center;width:100%}
.garden-search-popover{position:absolute;top:calc(100% + .5rem);left:0;right:0;z-index:60;display:flex;flex-direction:column;gap:.55rem;padding:.7rem;border:1px solid var(--border);border-radius:12px;background:color-mix(in srgb,var(--surface) 97%,transparent);box-shadow:0 24px 64px rgba(0,0,0,.28);backdrop-filter:blur(16px)}
.garden-search-popover:not(:has(> :not([hidden]))){display:none}
.garden-search-input{width:100%;height:2.25rem;padding:0 2.2rem 0 .7rem;border:1px solid var(--border);border-radius:6px;background:var(--surface-1);color:var(--fg-strong);font:inherit;font-size:.8125rem;line-height:1.4;appearance:none}
.garden-search-input::placeholder{color:var(--fg-faint)}
.garden-search-input:focus-visible{outline:none;border-color:var(--border-strong);background:var(--surface)}
.garden-search-kbd{position:absolute;right:.45rem;display:flex;align-items:center;justify-content:center;min-width:1.25rem;height:1.25rem;padding:0 .3rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);font-family:var(--font-mono);font-size:.625rem;line-height:1;color:var(--fg-faint);pointer-events:none}
.garden-search-input:focus~.garden-search-kbd{display:none}
.garden-search-filters{display:flex;flex-wrap:wrap;gap:.3rem;margin:0;padding-bottom:.55rem;border-bottom:1px solid var(--border)}
.garden-search-filter{display:inline-flex;align-items:center;gap:.35rem;height:1.5rem;padding:0 .5rem;border:1px solid var(--border);border-radius:999px;background:var(--surface);font-size:.6875rem;color:var(--fg-muted);cursor:pointer}
.garden-search-filter:hover,.garden-search-filter.is-active{border-color:color-mix(in srgb,var(--accent) 32%,var(--border));color:var(--fg-strong);background:color-mix(in srgb,var(--accent) 8%,transparent)}
.garden-search-filter-count{font-size:.625rem;color:var(--fg-faint)}
.garden-search-status{margin:0;font-size:.6875rem;color:var(--fg-faint);font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.04em}
.garden-search-results{display:flex;flex-direction:column;gap:.1rem;max-height:min(60vh,28rem);overflow:auto;margin:0;padding:0;border:0;background:none;box-shadow:none}
.garden-search-results[hidden],.garden-search-status[hidden],.garden-search-filters[hidden]{display:none!important}
.garden-search-empty,.garden-search-error{margin:0;padding:.85rem .75rem;text-align:center;font-size:.8125rem;line-height:1.5;color:var(--fg-muted)}
.garden-search-result{display:block;padding:.55rem .65rem;border-radius:7px;text-decoration:none;color:inherit}
.garden-search-result:hover,.garden-search-result.is-active{background:var(--surface-1);text-decoration:none}
.garden-search-result-title{display:block;font-size:.85rem;font-weight:500;line-height:1.35;color:var(--fg-strong)}
.garden-search-result-excerpt{display:block;margin-top:.16rem;font-size:.76rem;line-height:1.45;color:var(--fg-muted)}
.garden-search-result mark,.garden-search-subresult mark{padding:.05em .15em;border-radius:.2em;background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent)}
.garden-search-subresults{margin-top:.25rem;display:flex;flex-direction:column}
.garden-search-subresult{display:block;margin-left:.35rem;padding:.2rem 0 .2rem .7rem;border-left:1px solid var(--border);text-decoration:none}
.garden-search-subresult:hover{border-left-color:var(--accent);text-decoration:none}

.garden-content{min-width:0;view-transition-name:content}
main{max-width:var(--content-width);width:100%;margin:0 auto;padding:3.25rem 1.5rem 6rem}
main>section,main>article,.page-searchable{line-height:1.7;letter-spacing:0;word-break:break-word}
.page-title{font-family:var(--font-sans);font-size:clamp(1.85rem,1.5rem + 1.4vw,2.35rem);font-weight:600;line-height:1.12;letter-spacing:-.035em;color:var(--fg-strong);margin:0 0 2.5rem;text-wrap:balance}
.page-updated{margin:-1.95rem 0 1.7rem;font-family:var(--font-mono);font-size:.72rem;color:var(--fg-faint);letter-spacing:.04em;text-transform:uppercase}
.page-updated time{color:var(--fg-muted)}
.page-updated+.page-description,.page-updated+.page-tags,.page-updated+.growth{margin-top:0}
.page-description{margin:-1.5rem 0 1.8rem;font-size:1rem;line-height:1.65;color:var(--fg-muted);text-wrap:pretty}
.growth{margin:-1rem 0 1.6rem;font-family:var(--font-mono);font-size:.72rem;color:var(--fg-faint);letter-spacing:.03em;text-transform:uppercase}
.page-tags{display:flex;flex-wrap:wrap;gap:.4rem;list-style:none;padding:0;margin:-.75rem 0 1.65rem}
.page-tag{display:inline-flex;align-items:center;padding:.12rem .5rem;border:1px solid var(--border);border-radius:999px;background:color-mix(in srgb,var(--surface-1) 70%,transparent);font-family:var(--font-mono);font-size:.65rem;letter-spacing:.05em;text-transform:uppercase;color:var(--fg-muted)}

h1,h2,h3,h4,h5,h6{font-family:var(--font-sans);color:var(--fg-strong);font-weight:600;text-wrap:balance}
h1{font-size:1.5rem}h2{font-size:1.3rem;line-height:1.3;letter-spacing:-.02em;margin-top:2.5rem;margin-bottom:1.1rem}h3{font-size:1.075rem;font-weight:500;line-height:1.35;letter-spacing:-.015em;margin-top:1.85rem;margin-bottom:.6rem}h4{font-size:.95rem;font-weight:600;letter-spacing:-.01em;margin-top:1.5rem;margin-bottom:.4rem;text-transform:none;color:var(--fg-strong)}
main>section>article>:first-child{margin-top:0}
p{color:var(--fg);text-wrap:pretty;margin:0 0 1.4rem}
strong{font-weight:600;color:var(--fg-strong)}
em{font-style:italic;color:var(--fg);border-bottom:0}
a{color:var(--link);text-decoration:underline;text-decoration-color:var(--link-underline);text-decoration-thickness:1.5px;text-decoration-skip-ink:auto;text-underline-offset:3px;transition:color .15s ease,text-decoration-color .15s ease}
a:hover{color:var(--link-hover);text-decoration-color:var(--link-hover)}
ul,ol{margin-bottom:1.4rem;padding-left:1.4rem;color:var(--fg)}
li{margin-bottom:.55rem;padding-left:.25rem;color:var(--fg)}li::marker{color:var(--fg-faint)}li>ul,li>ol{margin-top:.4rem;margin-bottom:0}
:not(pre)>code{font-family:var(--font-mono);font-size:.825em;font-weight:400;background:var(--surface-1);border:1px solid var(--border);padding:.12em .42em;border-radius:4px;color:var(--fg-strong)}
.code-block{margin:.5rem 0 1.5rem;border-radius:8px;border:1px solid var(--border);background:var(--surface);overflow:hidden}.code-header{background:var(--surface-1);border-bottom:1px solid var(--border)}.code-block pre{margin:0;padding:1.1rem 1.35rem;overflow-x:auto}.code-block code{font-family:var(--font-mono);font-size:.8125rem;line-height:1.65;color:var(--fg-strong)}
blockquote{margin:1.6rem 0 2rem;padding:.4rem 0 .4rem 1.5rem;border-left:2px solid var(--border-strong);background:transparent;border-radius:0;color:var(--fg-muted)}blockquote p{font-size:1.05rem;font-style:italic;color:inherit}blockquote p:last-child{margin-bottom:0}
hr{border:0;height:1px;background:var(--border);margin:3rem auto;max-width:4rem}hr::after{content:""}
img{display:block;max-width:100%;height:auto;border-radius:6px;margin:1rem 0 1.75rem;border:1px solid var(--border)}p:has(>img:only-child){margin:0}img[style*="max-width: 100px"],img[style*="max-width:100px"]{border:0;border-radius:0}
.table-wrap,table{width:100%}.table-wrap{margin:.5rem 0 2rem;overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--surface)}table{border-collapse:collapse;margin:0}th,td{padding:.7rem .95rem;text-align:left;vertical-align:top;border-bottom:1px solid var(--border);font-size:.9rem}th{background:var(--surface);font-weight:500;font-size:.78rem;letter-spacing:.04em;text-transform:uppercase;color:var(--fg-strong)}td{color:var(--fg)}
.page-cover{margin:0 0 1.6rem;border-radius:8px;overflow:hidden}.page-cover::after{display:none}.page-cover img{width:100%;max-height:28rem;object-fit:cover;margin:0;border:1px solid var(--border)}
.toc{display:none}

.listing{margin-top:1.5rem;border-top:1px solid var(--border)}.listing-item{position:relative;display:flex;align-items:center;gap:1rem;padding:1.15rem 0;border-bottom:1px solid var(--border);text-decoration:none;color:inherit;transition:padding .18s ease}.listing-item:hover .listing-title,.listing-item:focus-visible .listing-title{color:var(--fg-strong)}.listing-body{display:flex;flex-direction:column;gap:.3rem;min-width:0;flex:1}.listing-title{font-size:1.05rem;font-weight:500;letter-spacing:-.015em;color:var(--fg-strong);line-height:1.3}.listing-desc{font-size:.9rem;line-height:1.5;color:var(--fg-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.listing-meta{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .85rem;margin-top:.15rem;font-family:var(--font-mono);font-size:.7rem;letter-spacing:.04em;text-transform:uppercase;color:var(--fg-faint)}.listing-tags{display:inline-flex;flex-wrap:wrap;gap:.4rem}.listing-tag{display:inline-flex;align-items:center;padding:.05rem .5rem;border-radius:999px;border:1px solid var(--border);background:color-mix(in srgb,var(--surface-1) 60%,transparent);color:var(--fg-muted);font-size:.65rem}.listing-arrow{flex-shrink:0;font-family:var(--font-mono);font-size:.9rem;color:var(--fg-faint);opacity:.5;transform:translateX(-.25rem);transition:opacity .18s ease,transform .22s ease,color .18s ease}.listing-item:hover .listing-arrow{opacity:1;transform:translateX(0);color:var(--fg-strong)}.pagination{display:flex;align-items:center;justify-content:space-between;margin-top:3rem;padding-top:1.5rem;border-top:1px solid var(--border);font-family:var(--font-mono);font-size:.78rem}.pagination-prev,.pagination-next{color:var(--fg-muted);text-decoration:none}.pagination-prev:hover,.pagination-next:hover{color:var(--fg-strong)}.pagination-info{color:var(--fg-faint);letter-spacing:.05em;text-transform:uppercase;font-size:.7rem}.pagination-placeholder{min-width:5rem}

.newsletter-form{max-width:30rem;margin:1.85rem 0}.newsletter-form__form{display:grid;gap:.55rem}.newsletter-form__row{display:flex;gap:.55rem;align-items:center}.newsletter-form__input{flex:1;min-width:0;height:2.45rem;border-radius:.35rem;padding:0 .75rem;border:1px solid var(--border-strong);background:transparent;color:var(--fg-strong);font:inherit;font-size:.9rem;outline:none}.newsletter-form__input::placeholder{color:var(--fg-muted)}.newsletter-form__input:focus{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 18%,transparent)}.newsletter-form__input.is-invalid{border-color:var(--accent)}.newsletter-form__button{height:2.45rem;border:1px solid var(--accent);border-radius:.35rem;padding:0 .85rem;background:transparent;color:var(--accent);font:inherit;font-size:.88rem;font-weight:500;white-space:nowrap;cursor:pointer}.newsletter-form__button:hover:not(:disabled){border-color:var(--accent-hover);background:color-mix(in srgb,var(--accent) 8%,transparent);color:var(--accent-hover)}.newsletter-form__button:disabled{opacity:.55;cursor:not-allowed}.newsletter-form__hint,.newsletter-form__notice{margin:0;font-size:.82rem;line-height:1.45}.newsletter-form__hint--error{color:var(--accent)}.newsletter-form__notice{border-left:2px solid color-mix(in srgb,var(--accent) 55%,transparent);padding:.15rem 0 .15rem .65rem;color:var(--fg-muted)}.newsletter-form [hidden]{display:none!important}

.lightbox{position:fixed;inset:0;background:color-mix(in srgb,var(--bg) 92%,#000);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;z-index:1000;opacity:0;visibility:hidden;transition:opacity .18s ease,visibility .18s ease;padding:4vh 4vw;cursor:zoom-out}.lightbox.open{opacity:1;visibility:visible}.lightbox-close{position:absolute;top:1rem;right:1rem;width:2.25rem;height:2.25rem;display:inline-flex;align-items:center;justify-content:center;font-size:1.5rem;color:var(--fg);background:var(--surface);border:1px solid var(--border);border-radius:999px;cursor:pointer}.lightbox-figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:.85rem;max-width:100%;max-height:100%;cursor:default}.lightbox-image{max-width:min(92vw,1400px);max-height:88vh;width:auto;height:auto;object-fit:contain;border-radius:6px;border:1px solid var(--border);background:var(--surface);margin:0}.lightbox-caption{font-family:var(--font-mono);font-size:.75rem;color:var(--fg-muted);text-align:center;max-width:80ch}
.col-handle{position:fixed;top:0;height:100vh;width:24px;margin-left:-12px;display:flex;align-items:center;justify-content:center;border:0;background:transparent;padding:0;cursor:ew-resize;z-index:50;touch-action:none}.col-handle-grip{display:block;width:4px;height:4rem;border-radius:999px;background:var(--accent);opacity:0;transition:opacity .18s ease,width .18s ease,height .2s ease,box-shadow .18s ease}.col-handle:hover .col-handle-grip,.col-handle:focus-visible .col-handle-grip,body.col-resizing .col-handle-grip{opacity:1;width:5px;height:5rem;box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 14%,transparent)}body.col-resizing,body.col-resizing *{cursor:ew-resize!important;user-select:none}

@media(max-width:760px){.garden-topnav{padding-top:1.5rem;padding-bottom:1rem;gap:.85rem 1.1rem}.nav-links{gap:1.05rem}.nav-links a{font-size:.825rem}.garden-search{flex-basis:100%;order:3;margin-left:0}main{padding:2.75rem 1.25rem 5rem}.page-title{margin-bottom:1.75rem}.col-handle{display:none}.newsletter-form__row{align-items:stretch;flex-direction:column}.newsletter-form__button{width:100%}}
@media(prefers-reduced-motion:reduce){::view-transition-old(root),::view-transition-new(root){animation-duration:1ms}.col-handle-grip,.listing-arrow,*{transition-duration:0s!important;animation-duration:0s!important}}
`

const GARDEN_SEARCH_SCRIPT = String.raw`
(() => {
  const root = document.querySelector('[data-garden-search-root]');

  if (!root) {
    return;
  }

  const input = root.querySelector('[data-garden-search-input]');
  const status = root.querySelector('[data-garden-search-status]');
  const results = root.querySelector('[data-garden-search-results]');
  const filtersEl = root.querySelector('[data-garden-search-filters]');
  const kbdEl = root.querySelector('[data-garden-search-kbd]');
  const searchConfigEl = document.querySelector('[data-garden-search-config]');

  if (!(input instanceof HTMLInputElement) || !(status instanceof HTMLElement) || !(results instanceof HTMLElement)) {
    return;
  }

  const body = document.body;
  const routePath = body.dataset.gardenRoutePath || '/';
  const visibility = body.dataset.gardenVisibility || 'public';
  let searchConfig = {};

  if (searchConfigEl instanceof HTMLScriptElement) {
    try {
      searchConfig = JSON.parse(searchConfigEl.textContent || '{}');
    } catch (_) {}
  }

  const hasProtectedSearch = searchConfig.hasProtectedSearch === true;
  const protectedSearchState = searchConfig.protectedSearchState === 'available'
    ? 'available'
    : 'locked';
  const sectionLabels = typeof searchConfig.sectionLabels === 'object' && searchConfig.sectionLabels
    ? searchConfig.sectionLabels
    : {};

  const normalizePathname = (value) => {
    const trimmed = (value || '/').trim();
    if (!trimmed || trimmed === '/') {
      return '/';
    }

    return trimmed.replace(/\/+$/, '') || '/';
  };

  const toMountedPath = (mountBasePath, routePathValue) => {
    if (mountBasePath === '/' || !mountBasePath) {
      return routePathValue;
    }

    return routePathValue === '/'
      ? mountBasePath
      : mountBasePath + routePathValue;
  };

  const computeMountBasePath = (pathname, routePathValue) => {
    const normalizedPathname = normalizePathname(pathname);

    if (routePathValue === '/') {
      return normalizedPathname;
    }

    if (normalizedPathname === routePathValue) {
      return '/';
    }

    if (normalizedPathname.endsWith(routePathValue)) {
      const mountBase = normalizedPathname.slice(0, normalizedPathname.length - routePathValue.length);
      return mountBase || '/';
    }

    return '/';
  };

  const mountBasePath = computeMountBasePath(window.location.pathname, routePath);
  const baseUrl = mountBasePath === '/' ? '/' : mountBasePath + '/';
  const publicBundlePath = toMountedPath(mountBasePath, '/_pagefind/public/');
  const protectedBundlePath = toMountedPath(mountBasePath, '/_pagefind/protected/');

  const normalizeSearchResultHref = (value) => {
    if (typeof value !== 'string') {
      return '#';
    }

    const trimmed = value.trim();

    if (!trimmed) {
      return '#';
    }

    try {
      const resolved = new URL(trimmed, new URL(baseUrl, window.location.origin));

      if (resolved.origin !== window.location.origin) {
        return trimmed;
      }

      if (resolved.pathname === '/index.html') {
        resolved.pathname = '/';
      } else if (resolved.pathname.endsWith('/index.html')) {
        resolved.pathname = resolved.pathname.slice(0, -'/index.html'.length) || '/';
      } else if (resolved.pathname.endsWith('.html')) {
        resolved.pathname = resolved.pathname.slice(0, -'.html'.length) || '/';
      }

      return normalizePathname(resolved.pathname) + resolved.search + resolved.hash;
    } catch {
      return trimmed;
    }
  };

  const escapeHtml = (value) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

  const isTextInputTarget = (target) =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);

  /* --- Result rendering --- */

  const renderResult = (result, index) => {
    const subResults = (Array.isArray(result.sub_results) ? result.sub_results : [])
      .filter((subResult) => subResult && subResult.url && subResult.url !== result.url)
      .slice(0, 3)
      .map((subResult) => {
        const title = escapeHtml(subResult.title || 'Section');
        const excerpt = subResult.excerpt || '';
        const href = normalizeSearchResultHref(subResult.url);

        return '<a class="garden-search-subresult" href="' + escapeHtml(href) + '">' +
          '<span class="garden-search-result-title">' + title + '</span>' +
          (excerpt ? '<span class="garden-search-result-excerpt">' + excerpt + '</span>' : '') +
          '</a>';
      })
      .join('');

    const href = normalizeSearchResultHref(result.url);

    return '<a class="garden-search-result" href="' + escapeHtml(href) + '" role="option" data-search-index="' + index + '">' +
      '<span class="garden-search-result-title">' + escapeHtml(result.meta?.title || href || 'Untitled') + '</span>' +
      (result.excerpt ? '<span class="garden-search-result-excerpt">' + result.excerpt + '</span>' : '') +
      (subResults ? '<div class="garden-search-subresults">' + subResults + '</div>' : '') +
      '</a>';
  };

  /* --- Keyboard navigation --- */

  let activeIndex = -1;
  let searchRequestId = 0;

  const getResultLinks = () => results.querySelectorAll('.garden-search-result');

  const setActiveResult = (index) => {
    const links = getResultLinks();
    if (links.length === 0) {
      activeIndex = -1;
      return;
    }

    links.forEach((link) => link.classList.remove('is-active'));
    activeIndex = Math.max(-1, Math.min(index, links.length - 1));

    if (activeIndex >= 0 && links[activeIndex]) {
      links[activeIndex].classList.add('is-active');
      links[activeIndex].scrollIntoView({ block: 'nearest' });
    }
  };

  /* --- Filters --- */

  const MAX_VISIBLE_TAG_FILTERS = 6;
  const MAX_VISIBLE_SECTION_FILTERS = 4;
  let activeFilters = {};
  let searchMode = 'relevance';

  const toSectionLabel = (value) => sectionLabels[value] || value;

  const incrementFilterCount = (counts, value) => {
    if (!value) {
      return;
    }

    counts.set(value, (counts.get(value) || 0) + 1);
  };

  const splitTagMeta = (value) => {
    if (typeof value !== 'string') {
      return [];
    }

    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  };

  const getResultTags = (result) => {
    const filterTags = result?.filters?.tag;

    if (Array.isArray(filterTags) && filterTags.length > 0) {
      return filterTags.filter(Boolean);
    }

    if (typeof filterTags === 'string' && filterTags.trim()) {
      return [filterTags.trim()];
    }

    return splitTagMeta(result?.meta?.tags);
  };

  const getResultSection = (result) => {
    const filterSection = result?.filters?.section;

    if (Array.isArray(filterSection) && filterSection.length > 0) {
      return filterSection.find(Boolean) || null;
    }

    if (typeof filterSection === 'string' && filterSection.trim()) {
      return filterSection.trim();
    }

    if (typeof result?.meta?.section === 'string' && result.meta.section.trim()) {
      return result.meta.section.trim();
    }

    return null;
  };

  const sortFilterEntries = (entries) =>
    entries.sort((left, right) =>
      right.count - left.count ||
      left.label.localeCompare(right.label, undefined, {
        sensitivity: 'base',
      }),
    );

  const pinActiveEntry = (entries, activeValue, maxVisible) => {
    if (!activeValue) {
      return entries.slice(0, maxVisible);
    }

    const limited = entries.slice(0, maxVisible);

    if (limited.some((entry) => entry.value === activeValue)) {
      return limited;
    }

    const activeEntry = entries.find((entry) => entry.value === activeValue);

    if (!activeEntry) {
      return limited;
    }

    return [activeEntry, ...limited.slice(0, Math.max(0, maxVisible - 1))];
  };

  const buildFilterEntries = (resultsForFilters) => {
    if (!Array.isArray(resultsForFilters) || resultsForFilters.length === 0) {
      return [];
    }

    const tagCounts = new Map();
    const sectionCounts = new Map();

    for (const result of resultsForFilters) {
      for (const tag of getResultTags(result)) {
        incrementFilterCount(tagCounts, tag);
      }

      incrementFilterCount(sectionCounts, getResultSection(result));
    }

    const tagEntries = sortFilterEntries(
      [...tagCounts.entries()].map(([value, count]) => ({
        count,
        key: 'tag',
        label: value,
        value,
      })),
    );
    const sectionEntries = sortFilterEntries(
      [...sectionCounts.entries()].map(([value, count]) => ({
        count,
        key: 'section',
        label: toSectionLabel(value),
        value,
      })),
    );

    return [
      ...pinActiveEntry(tagEntries, activeFilters['tag'], MAX_VISIBLE_TAG_FILTERS),
      ...pinActiveEntry(sectionEntries, activeFilters['section'], MAX_VISIBLE_SECTION_FILTERS),
    ];
  };

  const renderFilters = (resultsForFilters) => {
    if (!filtersEl) {
      return;
    }

    const chips = buildFilterEntries(resultsForFilters).map((entry) => {
      const isActive = activeFilters[entry.key] === entry.value;
      const activeClass = isActive ? ' is-active' : '';

      return '<button class="garden-search-filter' + activeClass + '" data-filter-key="' + entry.key + '" data-filter-value="' + escapeHtml(entry.value) + '" type="button">' +
        '<span>' + escapeHtml(entry.label) + '</span>' +
        '<span class="garden-search-filter-count">' + escapeHtml(String(entry.count)) + '</span>' +
        '</button>';
    });

    if (chips.length === 0) {
      filtersEl.hidden = true;
      filtersEl.innerHTML = '';
      return;
    }

    filtersEl.hidden = false;
    filtersEl.innerHTML = chips.join('');
  };

  if (filtersEl) {
    filtersEl.addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter-key]');
      if (!button) return;

      const key = button.dataset.filterKey;
      const value = button.dataset.filterValue;

      if (activeFilters[key] === value) {
        delete activeFilters[key];
      } else {
        activeFilters[key] = value;
      }

      void runSearch(input.value);
    });
  }

  /* --- Pagefind lifecycle --- */

  let pagefindModule = null;
  let initPromise = null;
  let protectedMergePromise = null;
  let protectedMerged = false;
  const canLoadProtectedSearch = hasProtectedSearch && protectedSearchState === 'available';

  const ensurePagefind = async () => {
    if (!pagefindModule) {
      pagefindModule = await import(publicBundlePath + 'pagefind.js');
      await pagefindModule.options({
        baseUrl,
        bundlePath: publicBundlePath,
        excerptLength: 18,
        highlightParam: 'highlight',
        ranking: {
          metaWeights: {
            title: 5.0,
            description: 2.0,
            excerpt: 2.0,
          },
        },
      });
    }

    if (!initPromise) {
      initPromise = pagefindModule.init();
    }

    await initPromise;
    return pagefindModule;
  };

  const maybeMergeProtectedIndex = async (blocking) => {
    if (!canLoadProtectedSearch || protectedMerged) {
      return;
    }

    const pagefind = await ensurePagefind();

    if (!protectedMergePromise) {
      protectedMergePromise = pagefind
        .mergeIndex(protectedBundlePath, {
          mergeFilter: {
            visibility: 'protected',
          },
        })
        .then(() => {
          protectedMerged = true;
        })
        .catch(() => null)
        .finally(() => {
          protectedMergePromise = null;
        });
    }

    if (blocking) {
      await protectedMergePromise;
    }
  };

  /* --- Search execution --- */

  const clearResults = () => {
    results.hidden = true;
    results.innerHTML = '';
    status.hidden = true;
    status.textContent = '';
    activeIndex = -1;
    if (filtersEl) {
      filtersEl.hidden = true;
      filtersEl.innerHTML = '';
    }
  };

  const buildFilterParam = () => {
    const param = {};
    for (const [key, value] of Object.entries(activeFilters)) {
      param[key] = value;
    }
    return Object.keys(param).length > 0 ? { filters: param } : {};
  };

  const runSearch = async (query) => {
    const term = query.trim();

    if (!term) {
      searchRequestId += 1;
      clearResults();
      return;
    }

    const requestId = ++searchRequestId;

    status.hidden = false;
    status.textContent = 'Searching\u2026';
    results.hidden = false;

    try {
      const pagefind = await ensurePagefind();

      if (visibility === 'protected' || canLoadProtectedSearch) {
        await maybeMergeProtectedIndex(true);
      }

      const searchOptions = buildFilterParam();
      if (searchMode !== 'relevance') {
        searchOptions.sort = searchMode;
      }
      const search = await pagefind.debouncedSearch(term, searchOptions, 180);

      if (search === null) {
        return;
      }

      if (requestId !== searchRequestId) {
        return;
      }

      const loadedResults = await Promise.all(
        search.results.map((result) => result.data()),
      );

      if (requestId !== searchRequestId) {
        return;
      }

      if (loadedResults.length === 0) {
        status.hidden = true;
        if (filtersEl) {
          filtersEl.hidden = true;
          filtersEl.innerHTML = '';
        }
        results.innerHTML = '<p class="garden-search-empty">No results found.</p>';
        activeIndex = -1;
        return;
      }

      const total = search.results.length;
      const shownResults = loadedResults.slice(0, 8);
      const shown = shownResults.length;
      status.hidden = false;
      status.textContent = total <= shown
        ? (total === 1 ? '1 result' : total + ' results')
        : shown + ' of ' + total + ' results';

      results.innerHTML = shownResults.map(renderResult).join('');
      activeIndex = -1;
      renderFilters(loadedResults);
    } catch (error) {
      if (requestId !== searchRequestId) {
        return;
      }
      status.hidden = false;
      status.textContent = '';
      results.innerHTML = '<p class="garden-search-error">Search unavailable. Try again later.</p>';
      console.error('Garden search failed', error);
    }
  };

  /* --- Idle preload --- */

  const idlePreload = () => { void ensurePagefind(); };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(idlePreload);
  } else {
    setTimeout(idlePreload, 1200);
  }

  /* --- Event listeners --- */

  input.addEventListener('focus', () => {
    void ensurePagefind();

    if (canLoadProtectedSearch && visibility === 'protected') {
      void maybeMergeProtectedIndex(false);
    }
  });

  input.addEventListener('input', () => {
    void runSearch(input.value);
  });

  input.addEventListener('keydown', (event) => {
    const links = getResultLinks();
    if (links.length === 0 && event.key !== 'Escape') {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveResult(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveResult(activeIndex <= 0 ? -1 : activeIndex - 1);
    } else if (event.key === 'Enter' && activeIndex >= 0 && links[activeIndex]) {
      event.preventDefault();
      links[activeIndex].click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (input.value) {
        input.value = '';
        clearResults();
      } else {
        input.blur();
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) {
      return;
    }

    if (event.key !== '/' || isTextInputTarget(event.target)) {
      return;
    }

    event.preventDefault();
    input.focus();
    input.select();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Node) || !root.contains(event.target)) {
      clearResults();
    }
  });

  document.addEventListener('garden:content-swap', () => {
    input.value = '';
    clearResults();
    if (document.activeElement === input) {
      input.blur();
    }
  });
})();
`

const GARDEN_NAV_SCRIPT = String.raw`
(() => {
  const content = document.querySelector('.garden-content');
  const navLinks = document.querySelector('.nav-links');
  if (!content) return;

  /* --- Prefetch on hover --- */
  const prefetched = new Set();
  const prefetch = (href) => {
    if (prefetched.has(href)) return;
    prefetched.add(href);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = href;
    document.head.appendChild(link);
  };
  const onPointer = (e) => {
    const a = e.target.closest('a[data-garden-link="internal"]');
    if (a && a.href) prefetch(a.href);
  };
  document.addEventListener('mouseenter', onPointer, { capture: true, passive: true });
  document.addEventListener('touchstart', onPointer, { capture: true, passive: true });

  /* --- Client-side navigation --- */
  if (!history.pushState) return;

  const parser = new DOMParser();
  const pageCache = new Map();
  const scrollMap = new Map();
  let controller = null;

  const saveScroll = () => {
    scrollMap.set(location.href, { x: scrollX, y: scrollY });
  };

  const swap = (doc) => {
    const nc = doc.querySelector('.garden-content');
    if (!nc) return false;

    content.innerHTML = nc.innerHTML;
    document.title = doc.title || '';

    const ns = doc.querySelector('.nav-links');
    if (ns && navLinks) navLinks.innerHTML = ns.innerHTML;

    const nb = doc.body;
    if (nb) {
      document.body.dataset.gardenRoutePath = nb.dataset.gardenRoutePath || '/';
      document.body.dataset.gardenVisibility = nb.dataset.gardenVisibility || 'public';
    }
    return true;
  };

  const focusContent = () => {
    const heading = content.querySelector('h1');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  };

  const navigate = async (url, push) => {
    if (controller) controller.abort();
    controller = new AbortController();
    const signal = controller.signal;

    saveScroll();

    try {
      let doc = pageCache.get(url);

      if (!doc) {
        const res = await fetch(url, { credentials: 'same-origin', signal });
        if (!res.ok) { location.href = url; return; }
        doc = parser.parseFromString(await res.text(), 'text/html');
        pageCache.set(url, doc);
        if (pageCache.size > 30) {
          pageCache.delete(pageCache.keys().next().value);
        }
      }

      if (signal.aborted) return;

      const doSwap = () => {
        if (!swap(doc)) { location.href = url; return; }
        if (push) history.pushState({}, '', url);
        document.dispatchEvent(new CustomEvent('garden:content-swap'));

        const hash = new URL(url, location.origin).hash;
        if (hash) {
          const el = document.getElementById(hash.slice(1));
          if (el) { el.scrollIntoView(); return; }
        }

        if (!push) {
          const saved = scrollMap.get(url);
          if (saved) { scrollTo(saved.x, saved.y); }
          else { scrollTo(0, 0); }
        } else {
          scrollTo(0, 0);
        }

        focusContent();
      };

      if (document.startViewTransition) {
        document.startViewTransition(doSwap);
      } else {
        doSwap();
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      location.href = url;
    } finally {
      controller = null;
    }
  };

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[data-garden-link="internal"]');
    if (!a || !a.href) return;

    const url = new URL(a.href, location.origin);
    if (url.origin !== location.origin) return;

    if (url.pathname === location.pathname && url.hash) {
      e.preventDefault();
      const el = document.getElementById(url.hash.slice(1));
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      history.pushState({}, '', url.href);
      return;
    }

    e.preventDefault();
    navigate(url.href, true);
  });

  window.addEventListener('popstate', () => navigate(location.href, false));
})();
`

const GARDEN_ENHANCEMENTS_SCRIPT = String.raw`
(() => {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  const docReady = (fn) => {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  };

  const initLightbox = () => {
    if (document.querySelector('.lightbox')) return;
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-hidden', 'true');
    lb.innerHTML = '<button class="lightbox-close" type="button" aria-label="Close (Esc)">×</button><figure class="lightbox-figure"><img class="lightbox-image" alt=""><figcaption class="lightbox-caption" hidden></figcaption></figure>';
    document.body.appendChild(lb);
    const img = lb.querySelector('.lightbox-image');
    const caption = lb.querySelector('.lightbox-caption');
    const close = () => { lb.classList.remove('open'); lb.setAttribute('aria-hidden', 'true'); document.body.classList.remove('no-scroll'); };
    const open = (src, alt) => {
      img.src = src;
      img.alt = alt || '';
      if (alt) { caption.textContent = alt; caption.hidden = false; } else { caption.hidden = true; }
      lb.classList.add('open');
      lb.setAttribute('aria-hidden', 'false');
      document.body.classList.add('no-scroll');
    };
    lb.addEventListener('click', (e) => { if (e.target === lb || e.target.closest('.lightbox-close')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lb.classList.contains('open')) close(); });
    document.addEventListener('click', (e) => {
      const el = e.target.closest('main img');
      if (!el || el.closest('a[href]') || el.classList.contains('no-lightbox')) return;
      const inlineMax = (el.getAttribute('style') || '').match(/max-width:\s*(\d+)px/i);
      if (inlineMax && Number(inlineMax[1]) <= 140) return;
      e.preventDefault();
      open(el.currentSrc || el.src, el.alt);
    });
  };

  const initResizable = () => {
    if (document.querySelector('.col-handle')) return;
    const STORAGE_KEY = 'overment.contentWidth';
    const MIN_REM = 36;
    const MAX_REM = 68;
    const fontPx = () => parseFloat(getComputedStyle(root).fontSize) || 16;
    const apply = (rem) => {
      const clamped = Math.max(MIN_REM, Math.min(MAX_REM, rem));
      root.style.setProperty('--content-width', clamped.toFixed(2) + 'rem');
      return clamped;
    };
    const save = (rem) => { try { localStorage.setItem(STORAGE_KEY, rem.toFixed(2)); } catch {} };
    let stored;
    try { stored = parseFloat(localStorage.getItem(STORAGE_KEY) || ''); } catch {}
    if (Number.isFinite(stored)) apply(stored);
    const makeHandle = (side) => {
      const h = document.createElement('button');
      h.type = 'button';
      h.className = 'col-handle col-handle-' + side;
      h.setAttribute('aria-label', 'Resize content column (use ← and →)');
      h.setAttribute('aria-orientation', 'vertical');
      const grip = document.createElement('span');
      grip.className = 'col-handle-grip';
      grip.setAttribute('aria-hidden', 'true');
      h.appendChild(grip);
      return h;
    };
    const left = makeHandle('left');
    const right = makeHandle('right');
    document.body.append(left, right);
    const main = document.querySelector('main');
    if (!main) return;
    const positionHandles = () => {
      const rect = main.getBoundingClientRect();
      left.style.left = Math.round(rect.left) + 'px';
      right.style.left = Math.round(rect.right) + 'px';
    };
    positionHandles();
    window.addEventListener('resize', positionHandles);
    document.addEventListener('visibilitychange', positionHandles);
    let dragging = null;
    const onMove = (e) => {
      if (!dragging) return;
      const centerX = window.innerWidth / 2;
      const widthPx = dragging === 'right' ? (e.clientX - centerX) * 2 : (centerX - e.clientX) * 2;
      if (widthPx <= 0) return;
      apply(widthPx / fontPx());
      positionHandles();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = null;
      document.body.classList.remove('col-resizing');
      const cur = parseFloat(getComputedStyle(root).getPropertyValue('--content-width')) || 38;
      save(cur);
    };
    const startDrag = (side) => (e) => { e.preventDefault(); dragging = side; document.body.classList.add('col-resizing'); };
    left.addEventListener('pointerdown', startDrag('left'));
    right.addEventListener('pointerdown', startDrag('right'));
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    const nudge = (delta) => {
      const cur = parseFloat(getComputedStyle(root).getPropertyValue('--content-width')) || 38;
      const next = apply(cur + delta);
      positionHandles();
      save(next);
    };
    [left, right].forEach((h) => h.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(1); }
      else if (e.key === 'Home') { e.preventDefault(); apply(MIN_REM); positionHandles(); save(MIN_REM); }
      else if (e.key === 'End') { e.preventDefault(); apply(MAX_REM); positionHandles(); save(MAX_REM); }
    }));
  };

  const initNewsletterForms = () => {
    const DEFAULT_ENDPOINT = 'https://alice.overment.com/api/newsletter/subscribe';
    const ENDPOINT = window.OVERMENT_ENV?.NEWSLETTER_ENDPOINT || DEFAULT_ENDPOINT;
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValidEmail = (value) => EMAIL_RE.test(value.trim().toLowerCase());
    const setSubmitState = (formRoot) => {
      const input = formRoot.querySelector('[data-newsletter-email]');
      const button = formRoot.querySelector('[data-newsletter-submit]');
      const loading = formRoot.dataset.status === 'loading';
      if (button) { button.disabled = loading || !input || !isValidEmail(input.value); button.textContent = loading ? 'Sending…' : "I'm in"; }
    };
    const setValidation = (formRoot, show) => {
      const input = formRoot.querySelector('[data-newsletter-email]');
      const validation = formRoot.querySelector('[data-newsletter-validation]');
      if (input) { input.classList.toggle('is-invalid', show); input.setAttribute('aria-invalid', show ? 'true' : 'false'); }
      if (validation) validation.hidden = !show;
    };
    const setNotice = (formRoot, status, message) => {
      const notice = formRoot.querySelector('[data-newsletter-notice]');
      formRoot.dataset.status = status;
      if (!notice) return;
      notice.textContent = message || '';
      notice.hidden = !message;
    };
    document.querySelectorAll('[data-newsletter-form]').forEach((formRoot) => {
      if (formRoot.dataset.newsletterBound === '1') return;
      formRoot.dataset.newsletterBound = '1';
      const form = formRoot.querySelector('form');
      const input = formRoot.querySelector('[data-newsletter-email]');
      if (!form || !input) return;
      let touched = false;
      setSubmitState(formRoot);
      input.addEventListener('input', () => { const value = input.value.trim(); if (touched) setValidation(formRoot, value.length > 0 && !isValidEmail(value)); if (formRoot.dataset.status === 'error') setNotice(formRoot, 'idle', ''); setSubmitState(formRoot); });
      input.addEventListener('blur', () => { touched = true; const value = input.value.trim(); setValidation(formRoot, value.length > 0 && !isValidEmail(value)); setSubmitState(formRoot); });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        touched = true;
        const email = input.value.trim().toLowerCase();
        if (!isValidEmail(email)) { setValidation(formRoot, true); setNotice(formRoot, 'idle', ''); input.focus(); return; }
        setValidation(formRoot, false); setNotice(formRoot, 'idle', ''); formRoot.dataset.status = 'loading'; input.disabled = true; setSubmitState(formRoot);
        try {
          const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
          const data = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : {};
          const status = data.status || (response.ok ? 'success' : 'error');
          if (status === 'success') { input.value = ''; touched = false; setNotice(formRoot, 'success', data.message || 'Got it. Talk soon.'); }
          else if (status === 'exists') setNotice(formRoot, 'exists', data.message || "You're already on the list.");
          else setNotice(formRoot, 'error', data.message || "Hmm, that didn't work. Try again?");
        } catch { setNotice(formRoot, 'error', "Hmm, something's off. Mind trying again?"); }
        finally { input.disabled = false; if (formRoot.dataset.status === 'loading') formRoot.dataset.status = 'idle'; setSubmitState(formRoot); }
      });
    });
  };

  docReady(() => { initLightbox(); initResizable(); initNewsletterForms(); });
  document.addEventListener('garden:content-swap', () => setTimeout(initNewsletterForms, 0));
  document.addEventListener('click', () => setTimeout(initNewsletterForms, 0));
})();
`

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
