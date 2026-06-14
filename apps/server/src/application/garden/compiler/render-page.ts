import { buildRelativeRouteHref, GARDEN_INTERNAL_HREF_PREFIX } from './rewrite-links'
import type { GardenPageSeo, GardenSidebarItem } from './types'

// --- Types ---

export interface GardenListingItem {
  date?: string
  description?: string
  routePath: string
  title: string
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
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
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

const renderInlineMarkdown = (value: string): string => {
  let output = escapeHtml(value)

  output = output.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_match, alt: string, src: string) =>
      `<img alt="${escapeHtml(alt)}"${renderSrcAttributes(src)} loading="lazy" decoding="async">`,
  )
  output = output.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label: string, href: string) => `<a${renderHrefAttributes(href)}>${label}</a>`,
  )
  output = output.replace(/`([^`]+)`/g, '<code>$1</code>')
  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  output = output.replace(/\*([^*]+)\*/g, '<em>$1</em>')

  return output
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

    // Unordered lists
    if (line.startsWith('- ')) {
      const items: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('- ')) {
        items.push(`<li>${renderInlineMarkdown((lines[index] ?? '').slice(2).trim())}</li>`)
        index += 1
      }
      html.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    // Ordered lists
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s/.test(lines[index] ?? '')) {
        items.push(
          `<li>${renderInlineMarkdown((lines[index] ?? '').replace(/^\d+\.\s/, '').trim())}</li>`,
        )
        index += 1
      }
      html.push(`<ol>${items.join('')}</ol>`)
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
      !(lines[index] ?? '').startsWith('- ') &&
      !(lines[index] ?? '').startsWith('> ') &&
      !(lines[index] ?? '').trimStart().startsWith('|') &&
      !/^\d+\.\s/.test(lines[index] ?? '') &&
      !/^(#{1,6})\s+/.test(lines[index] ?? '') &&
      !/^(---|___|\*\*\*)$/.test((lines[index] ?? '').trim())
    ) {
      paragraphLines.push((lines[index] ?? '').trim())
      index += 1
    }
    html.push(`<p>${renderInlineMarkdown(paragraphLines.join(' '))}</p>`)
  }

  return { headings, html: html.join('\n') }
}

// --- Page Components ---

const isSidebarItemActive = (item: GardenSidebarItem, currentRoutePath: string): boolean =>
  (item.path
    ? currentRoutePath === item.path ||
      (item.path !== '/' && currentRoutePath.startsWith(item.path + '/'))
    : false) || item.children.some((child) => isSidebarItemActive(child, currentRoutePath))

const renderSidebarItems = (
  items: readonly GardenSidebarItem[],
  currentRoutePath: string,
): string => {
  if (items.length === 0) {
    return ''
  }

  const renderedItems = items.map((item) => {
    const active = isSidebarItemActive(item, currentRoutePath)
    const activeClass = active ? ' is-active' : ''
    const currentAttr = item.path === currentRoutePath ? ' aria-current="page"' : ''
    const itemHref = item.path ? buildRelativeRouteHref(currentRoutePath, item.path) : null
    const content = item.path
      ? `<a${renderHrefAttributes(itemHref ?? item.path)} class="sidebar-link${activeClass}"${currentAttr}>${escapeHtml(item.label)}</a>`
      : `<span class="sidebar-label${activeClass}">${escapeHtml(item.label)}</span>`
    const description = item.description
      ? `<p class="sidebar-description">${escapeHtml(item.description)}</p>`
      : ''

    if (item.children.length > 0) {
      const openAttr = active ? ' open' : ''
      const childrenHtml = `<ul class="sidebar-list sidebar-children">${renderSidebarItems(item.children, currentRoutePath)}</ul>`
      return `<li class="sidebar-item sidebar-item-section${activeClass}"><details class="sidebar-details"${openAttr}><summary class="sidebar-summary">${content}${description}</summary>${childrenHtml}</details></li>`
    }

    return `<li class="sidebar-item sidebar-item-page${activeClass}">${content}${description}</li>`
  })

  return renderedItems.join('\n')
}

const renderSidebar = (
  sidebarItems: readonly GardenSidebarItem[],
  currentRoutePath: string,
  hasProtectedSearch: boolean,
  siteTitle?: string,
): string => {
  const homeHref = buildRelativeRouteHref(currentRoutePath, '/')
  const brand = siteTitle
    ? `<a${renderHrefAttributes(homeHref)} class="sidebar-brand">${escapeHtml(siteTitle)}</a>`
    : ''
  const search = renderSearchPanel(hasProtectedSearch)
  const list =
    sidebarItems.length > 0
      ? `<nav aria-label="Site navigation" class="sidebar-nav"><ul class="sidebar-list">${renderSidebarItems(sidebarItems, currentRoutePath)}</ul></nav>`
      : ''

  return `<aside class="garden-sidebar" data-pagefind-ignore="all">${brand}${search}${list}</aside>`
}

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

const renderSeoMeta = (
  title: string,
  description: string | undefined,
  seo: GardenPageSeo | undefined,
): string => {
  const meta: string[] = []
  const seoTitle = seo?.title ?? title
  const seoDescription = seo?.description ?? description

  meta.push(`<title>${escapeHtml(seoTitle)}</title>`)

  if (seoDescription) {
    meta.push(`<meta name="description" content="${escapeHtml(seoDescription)}">`)
  }

  if (seo?.canonical) {
    meta.push(`<link rel="canonical" href="${escapeHtml(seo.canonical)}">`)
  }

  if (seo?.noindex) {
    meta.push('<meta name="robots" content="noindex, nofollow">')
  }

  if (seo?.keywords && seo.keywords.length > 0) {
    meta.push(`<meta name="keywords" content="${escapeHtml(seo.keywords.join(', '))}">`)
  }

  return meta.join('\n')
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

const renderPageDescription = (description?: string): string =>
  description
    ? `<p class="page-description" data-pagefind-meta="description" data-pagefind-weight="2">${escapeHtml(description)}</p>`
    : ''

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
      const description = item.description
        ? `<p class="listing-desc">${escapeHtml(item.description)}</p>`
        : ''
      const date = item.date
        ? `<time datetime="${escapeHtml(item.date)}">${escapeHtml(item.date)}</time>`
        : ''
      return `<article class="listing-item"><a${renderHrefAttributes(href)}>${escapeHtml(item.title)}</a>${description}${date}</article>`
    })
    .join('\n')

  let pagination = ''
  if (listing.totalPages > 1) {
    const navParts: string[] = []

    if (listing.currentPage > 1) {
      const prevPage = listing.currentPage - 1
      const prevPath =
        prevPage === 1
          ? listing.parentRoutePath
          : listing.parentRoutePath === '/'
            ? `/page/${prevPage}`
            : `${listing.parentRoutePath}/page/${prevPage}`
      const prevHref = buildRelativeRouteHref(currentRoutePath, prevPath)
      navParts.push(`<a${renderHrefAttributes(prevHref)} rel="prev">Previous</a>`)
    }

    navParts.push(`<span>Page ${listing.currentPage} of ${listing.totalPages}</span>`)

    if (listing.currentPage < listing.totalPages) {
      const nextPage = listing.currentPage + 1
      const nextPath =
        listing.parentRoutePath === '/'
          ? `/page/${nextPage}`
          : `${listing.parentRoutePath}/page/${nextPage}`
      const nextHref = buildRelativeRouteHref(currentRoutePath, nextPath)
      navParts.push(`<a${renderHrefAttributes(nextHref)} rel="next">Next</a>`)
    }

    pagination = `<nav class="listing-nav" aria-label="Pagination">${navParts.join('\n')}</nav>`
  }

  return `<section class="listing" data-pagefind-ignore="all">${items}${pagination}</section>`
}

const renderFooter = (siteTitle?: string): string => {
  if (!siteTitle) return ''
  return `<footer data-pagefind-ignore="all" role="contentinfo">${escapeHtml(siteTitle)}</footer>`
}

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
  <div class="garden-search-filters" data-garden-search-filters hidden></div>
  <p aria-live="polite" class="garden-search-status" data-garden-search-status hidden></p>
  <div class="garden-search-results" data-garden-search-results role="listbox" aria-label="Search results" hidden></div>
</section>
`

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
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Lexend+Deca:wght@400;500;600;700&family=Lexend:wght@500;600;700&display=swap'

const FAVICON_DATA_URI =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16.2521 28V22.417H9.40065C6.29705 22.417 3.78125 19.9012 3.78125 16.7976V15.4575C3.78125 12.5431 5.71983 10.072 8.37434 9.26672L6.61329 5.0169L9.06913 4L12.2374 11.6473H9.39947C7.7642 11.6473 6.43812 12.9734 6.43812 14.6087V16.7965C6.43812 18.4317 7.7642 19.7578 9.39947 19.7578H18.909V22.7509C20.8369 21.3355 23.4621 19.4087 23.9876 19.0231C24.9645 18.3071 25.5476 17.1574 25.5476 15.9489V14.6087C25.5476 12.9734 24.2215 11.6473 22.5862 11.6473H14.1113L12.9451 8.98927H22.5851C25.6887 8.98927 28.2045 11.5051 28.2045 14.6087V15.9477C28.2045 18.0003 27.2158 19.9506 25.5594 21.165C24.7082 21.7893 18.3658 26.4447 18.3658 26.4447L16.2509 27.9977L16.2521 28Z" fill="#d4d4d8"/><path d="M23.0492 4.00023L20.3594 10.4941L22.8151 11.5113L25.505 5.01742L23.0492 4.00023Z" fill="#d4d4d8"/><path d="M5.59961 14.2764H2.39844V17.2295H5.59961V14.2764Z" fill="#d4d4d8"/><path d="M29.7012 14.2764H26.5V17.2295H29.7012V14.2764Z" fill="#d4d4d8"/></svg>',
  )

// --- CSS ---

const GARDEN_CSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

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
display:grid;
grid-template-columns:minmax(220px,280px) minmax(0,1fr);
min-height:calc(100dvh - 3px);
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

.garden-sidebar{
position:sticky;
top:0;
align-self:start;
display:flex;
flex-direction:column;
gap:1rem;
min-height:calc(100dvh - 3px);
max-height:calc(100dvh - 3px);
overflow:auto;
padding:1.25rem 1rem 2rem;
border-right:1px solid var(--border);
background:color-mix(in srgb,var(--surface-0) 86%,var(--bg));
view-transition-name:sidebar;
}

.sidebar-brand{
display:block;
font-family:var(--font-heading);
font-size:1.125rem;
font-weight:700;
color:var(--text);
letter-spacing:-0.04em;
text-decoration:none;
}

.sidebar-nav{
display:block;
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

.sidebar-list{
list-style:none;
padding:0;
margin:0;
}

.sidebar-item{
margin:0;
}

.sidebar-item+.sidebar-item{
margin-top:0.2rem;
}

.sidebar-item-section{
margin-top:1rem;
}

.sidebar-link,.sidebar-label{
display:flex;
align-items:center;
min-height:2rem;
padding:0.3rem 0.6rem;
border-radius:8px;
font-size:0.875rem;
line-height:1.35;
letter-spacing:0.01em;
color:var(--text-secondary);
text-decoration:none;
transition:background-color 150ms ease,color 150ms ease;
}

.sidebar-link:hover{
background:var(--surface-1);
color:var(--text);
text-decoration:none;
}

.sidebar-summary:hover>.sidebar-label{
background:var(--surface-1);
color:var(--text);
}

.sidebar-link.is-active,.sidebar-label.is-active{
background:var(--accent-soft);
color:var(--text);
}

.sidebar-description{
margin:0.2rem 0.6rem 0;
font-size:0.75rem;
color:var(--text-tertiary);
line-height:1.45;
}

.sidebar-details{margin:0}
.sidebar-details>summary{list-style:none;cursor:pointer}
.sidebar-details>summary::-webkit-details-marker{display:none}
.sidebar-details>summary::marker{display:none}

.sidebar-summary{position:relative}
.sidebar-summary::after{
content:'';
position:absolute;
right:0.6rem;
top:50%;
width:0;
height:0;
border-left:4px solid transparent;
border-right:4px solid transparent;
border-top:4px solid var(--text-tertiary);
transform:translateY(-50%);
transition:transform 150ms ease;
}
.sidebar-details[open]>.sidebar-summary::after{
transform:translateY(-50%) rotate(180deg);
}

.sidebar-children{
margin-top:0.35rem;
margin-left:0.95rem;
padding-left:0.8rem;
border-left:1px solid var(--border);
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
.garden-sidebar,.skip-link,.toc,footer{display:none}
main{max-width:100%;padding:0}
main>article a[href^="http"]::after{content:" (" attr(href) ")";font-size:0.8em;color:#666}
.code-block,blockquote{break-inside:avoid}
h1,h2,h3,h4{break-after:avoid}
*{color:#000 !important;background:transparent !important;border-color:#ccc !important}
}

@media(max-width:900px){
.garden-shell{
grid-template-columns:1fr;
}

.garden-sidebar{
position:static;
min-height:auto;
max-height:none;
padding:1rem 1rem 1.25rem;
border-right:none;
border-bottom:1px solid var(--border);
}

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
::view-transition-old(sidebar),::view-transition-new(sidebar){animation:none}
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
})();
`

const GARDEN_NAV_SCRIPT = String.raw`
(() => {
  const content = document.querySelector('.garden-content');
  const sidebarNav = document.querySelector('.sidebar-nav');
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

    const ns = doc.querySelector('.sidebar-nav');
    if (ns && sidebarNav) sidebarNav.innerHTML = ns.innerHTML;

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

// --- Main Render ---

export const renderGardenPage = (input: {
  bodyMarkdown: string
  coverImageArtifactPath?: string
  currentRoutePath: string
  date?: string
  description?: string
  excerpt?: string
  hasProtectedSearch: boolean
  listing?: GardenListingContext
  order?: number
  seo?: GardenPageSeo
  searchSectionLabels: Record<string, string>
  sidebarItems: readonly GardenSidebarItem[]
  siteTitle?: string
  sourceSlug: string
  tags?: readonly string[]
  title: string
  updated?: string
  visibility: 'protected' | 'public'
}): string => {
  const { headings, html: bodyHtml } = renderMarkdownToHtml(input.bodyMarkdown)
  const sidebarHtml = renderSidebar(
    input.sidebarItems,
    input.currentRoutePath,
    input.hasProtectedSearch,
    input.siteTitle,
  )
  const coverImageHtml = renderCoverImage(
    input.currentRoutePath,
    input.coverImageArtifactPath,
    input.title,
  )
  const descriptionHtml = renderPageDescription(input.description)
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
    `<link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">`,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${FONTS_URL}">`,
    renderSeoMeta(input.title, input.description, input.seo),
    searchMetaHtml,
    searchConfigHtml,
    `<style>${GARDEN_CSS}</style>`,
    '</head>',
    `<body data-garden-has-protected-search="${input.hasProtectedSearch ? 'true' : 'false'}" data-garden-route-path="${escapeHtml(input.currentRoutePath)}" data-garden-visibility="${input.visibility}">`,
    '<a href="#content" class="skip-link">Skip to content</a>',
    '<div class="garden-shell">',
    sidebarHtml,
    '<div class="garden-content">',
    '<main id="content">',
    '<section class="page-searchable" data-pagefind-body>',
    coverImageHtml,
    `<h1 class="page-title" data-pagefind-meta="title">${escapeHtml(input.title)}</h1>`,
    descriptionHtml,
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
    `<script type="module">${GARDEN_SEARCH_SCRIPT}</script>`,
    '</body>',
    '</html>',
  ]
    .filter((part) => part.length > 0)
    .join('\n')

  return smartypants(raw)
}
