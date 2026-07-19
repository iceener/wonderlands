import { FAVICON_DATA_URI, FONTS_URL } from './render/assets'
import { GARDEN_CSS, GARDEN_LAYOUT_CSS } from './render/css'
import { escapeHtml } from './render/html-utils'
import { renderMarkdownToHtml, renderShortcodes, smartypants } from './render/markdown'
import {
  GARDEN_PROTECTED_SEARCH_STATE_TOKEN,
  renderHiddenSitemap,
  renderSearchConfig,
  renderTopNavigation,
} from './render/navigation'
import {
  type GardenListingContext,
  type GardenListingItem,
  renderCoverImage,
  renderFooter,
  renderGrowthMarkers,
  renderListing,
  renderPageTags,
  renderSearchMetadata,
  renderSeoMeta,
  renderToc,
  renderUpdatedStamp,
} from './render/page-components'
import {
  GARDEN_ENHANCEMENTS_SCRIPT,
  GARDEN_NAV_SCRIPT,
  GARDEN_SEARCH_SCRIPT,
} from './render/scripts'
import type { GardenNavigationItem, GardenPageSeo, GardenSidebarItem } from './types'

export { GARDEN_PROTECTED_SEARCH_STATE_TOKEN }
export type { GardenListingContext, GardenListingItem }

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
