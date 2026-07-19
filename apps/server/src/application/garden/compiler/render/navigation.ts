// Garden top navigation, hidden sitemap, and in-page search UI/config rendering.

import { buildRelativeRouteHref } from '../rewrite-links'
import type { GardenNavigationItem, GardenSidebarItem } from '../types'
import { escapeHtml, renderHrefAttributes, serializeJsonForHtml } from './html-utils'

export const GARDEN_PROTECTED_SEARCH_STATE_TOKEN = '__GARDEN_PROTECTED_SEARCH_STATE__'

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

export const renderHiddenSitemap = (
  sidebarItems: readonly GardenSidebarItem[],
  currentRoutePath: string,
): string =>
  sidebarItems.length > 0
    ? `<nav class="garden-sitemap" hidden data-pagefind-ignore="all" aria-label="Sitemap"><ul>${renderSitemapItems(sidebarItems, currentRoutePath)}</ul></nav>`
    : ''

export const renderTopNavigation = (input: {
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

export const renderSearchConfig = (input: {
  hasProtectedSearch: boolean
  searchSectionLabels: Record<string, string>
}): string =>
  `<script type="application/json" data-garden-search-config>${serializeJsonForHtml({
    hasProtectedSearch: input.hasProtectedSearch,
    protectedSearchState: GARDEN_PROTECTED_SEARCH_STATE_TOKEN,
    sectionLabels: input.searchSectionLabels,
  })}</script>`

