import type { DomainError } from '../../../shared/errors'
import { ok, type Result } from '../../../shared/result'
import { slugifyGardenPath, slugifyGardenSegment } from './parse-page'
import { isGardenReservedRoot } from './resolve-source-path'
import type {
  GardenClassifiedPage,
  GardenPageExposure,
  GardenSidebarItem,
  GardenSourceConfig,
} from './types'
import {
  type GardenCollectedPageSource,
  type GardenResolvedSourceData,
  loadGardenSourceData,
} from './build-site-source'

interface GardenPreparedBuildContext extends GardenResolvedSourceData {
  availablePublicAssetPaths: ReadonlySet<string>
  classifiedBySlug: Map<string, GardenClassifiedPage>
  classifiedPages: GardenClassifiedPage[]
  hasProtectedSearch: boolean
  homeAliasRoutePath?: string
  homeSlug?: string
  listingChildrenByParent: Map<string, GardenClassifiedPage[]>
  pageSourcesBySlug: Map<string, GardenCollectedPageSource>
  protectedSidebarItems: GardenSidebarItem[]
  publicSidebarItems: GardenSidebarItem[]
  searchSectionLabels: Record<string, string>
  wikiTargetSlugByBasename: Map<string, string>
}

const slugToRoutePath = (slug: string): string => (slug === 'index' ? '/' : `/${slug}`)

const resolveConfiguredHomeSlug = (home: string | undefined): string | undefined => {
  if (!home) {
    return undefined
  }

  const normalized = home
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.md$/i, '')
    .replace(/\/index$/i, '')

  return slugifyGardenPath(normalized) || 'index'
}

const pageRuleMatchesSourcePath = (rule: string, sourcePath: string): boolean => {
  if (rule === '.') {
    return true
  }

  if (rule.endsWith('.md')) {
    return sourcePath === rule
  }

  return (
    sourcePath === `${rule}.md` ||
    sourcePath === `${rule}/index.md` ||
    sourcePath.startsWith(`${rule}/`)
  )
}

const classifyPageExposure = (
  page: import('./types').GardenParsedPage,
  config: GardenSourceConfig,
): GardenClassifiedPage => {
  if (isGardenReservedRoot(page.sourcePath)) {
    return {
      ...page,
      exposure: 'hidden',
      hiddenReason: 'reserved_root',
    }
  }

  if (!config.public.roots.some((rule) => pageRuleMatchesSourcePath(rule, page.sourcePath))) {
    return {
      ...page,
      exposure: 'hidden',
      hiddenReason: 'outside_public_roots',
    }
  }

  if (config.public.exclude.some((rule) => pageRuleMatchesSourcePath(rule, page.sourcePath))) {
    return {
      ...page,
      exposure: 'hidden',
      hiddenReason: 'excluded_path',
    }
  }

  if (!page.publish) {
    return {
      ...page,
      exposure: 'hidden',
      hiddenReason: 'publish_false',
    }
  }

  if (page.draft) {
    return {
      ...page,
      exposure: 'hidden',
      hiddenReason: 'draft',
    }
  }

  if (page.visibility === 'private') {
    return {
      ...page,
      exposure: 'hidden',
      hiddenReason: 'visibility_private',
    }
  }

  return {
    ...page,
    exposure: page.visibility,
  }
}

const canListChildExposure = (
  parentExposure: GardenPageExposure,
  childExposure: GardenPageExposure,
): boolean => {
  if (parentExposure === 'hidden' || childExposure === 'hidden') {
    return false
  }

  if (parentExposure === 'public') {
    return childExposure === 'public'
  }

  return childExposure === 'public' || childExposure === 'protected'
}

const canShowInSidebar = (
  currentExposure: GardenPageExposure,
  candidateExposure: GardenPageExposure,
): boolean => {
  if (candidateExposure === 'hidden') {
    return false
  }

  if (currentExposure === 'protected') {
    return candidateExposure === 'public' || candidateExposure === 'protected'
  }

  return candidateExposure === 'public'
}

const compareOptionalOrder = (left: number | undefined, right: number | undefined): number => {
  if (left !== undefined && right !== undefined) {
    return left - right
  }

  if (left !== undefined) {
    return -1
  }

  if (right !== undefined) {
    return 1
  }

  return 0
}

const toSortableTime = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined
  }

  const time = Date.parse(value)
  return Number.isFinite(time) ? time : undefined
}

const inferSortableTime = (page: GardenClassifiedPage): number | undefined =>
  toSortableTime(page.date) ??
  toSortableTime(page.updated) ??
  page.sourceUpdatedAtMs ??
  toSortableTime(page.sourcePath.match(/\d{4}-\d{2}-\d{2}/)?.[0])

const comparePagesForDisplay = (
  left: GardenClassifiedPage,
  right: GardenClassifiedPage,
): number => {
  const orderComparison = compareOptionalOrder(left.order, right.order)

  if (orderComparison !== 0) {
    return orderComparison
  }

  const leftTime = inferSortableTime(left)
  const rightTime = inferSortableTime(right)

  if (leftTime !== undefined && rightTime !== undefined) {
    return rightTime - leftTime
  }

  if (leftTime !== undefined) {
    return -1
  }

  if (rightTime !== undefined) {
    return 1
  }

  return left.title.localeCompare(right.title, undefined, {
    sensitivity: 'base',
  })
}

const resolveSearchSectionSlug = (sourceSlug: string): string | undefined => {
  if (!sourceSlug || sourceSlug === 'index') {
    return undefined
  }

  const parentSlug = sourceSlug.split('/').slice(0, -1).join('/')
  return parentSlug || sourceSlug
}

const titleizeSegment = (value: string): string =>
  value
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())

const synthesizeMissingListingPages = (
  pages: readonly GardenClassifiedPage[],
): GardenClassifiedPage[] => {
  const pagesBySlug = new Map(pages.map((page) => [page.slug, page]))
  const syntheticBySlug = new Map<string, GardenClassifiedPage>()

  for (const page of pages) {
    if (page.exposure === 'hidden' || page.slug === 'index') {
      continue
    }

    const segments = page.slug.split('/').filter(Boolean)

    for (let index = 1; index < segments.length; index += 1) {
      const parentSlug = segments.slice(0, index).join('/')

      if (pagesBySlug.has(parentSlug)) {
        continue
      }

      const existingSynthetic = syntheticBySlug.get(parentSlug)

      if (existingSynthetic) {
        if (existingSynthetic.exposure === 'protected' && page.exposure === 'public') {
          syntheticBySlug.set(parentSlug, {
            ...existingSynthetic,
            exposure: 'public',
            visibility: 'public',
          })
        }

        continue
      }

      syntheticBySlug.set(parentSlug, {
        aliases: [],
        draft: false,
        exposure: page.exposure,
        listing: true,
        publish: true,
        rawMarkdown: '',
        routePath: slugToRoutePath(parentSlug),
        slug: parentSlug,
        sourcePath: `${parentSlug}/index.md`,
        synthetic: true,
        tags: [],
        title: titleizeSegment(parentSlug.split('/').pop() ?? parentSlug),
        unlisted: false,
        visibility: page.exposure === 'protected' ? 'protected' : 'public',
      })
    }
  }

  if (syntheticBySlug.size === 0) {
    return [...pages]
  }

  return [...pages, ...syntheticBySlug.values()]
}

const toListingChildrenMap = (
  pages: readonly GardenClassifiedPage[],
): Map<string, GardenClassifiedPage[]> => {
  const childrenByParent = new Map<string, GardenClassifiedPage[]>()

  for (const page of pages) {
    if (page.exposure === 'hidden' || page.unlisted) {
      continue
    }

    const parentSlug = page.slug.split('/').slice(0, -1).join('/')

    if (!parentSlug) {
      continue
    }

    const bucket = childrenByParent.get(parentSlug) ?? []
    bucket.push(page)
    childrenByParent.set(parentSlug, bucket)
  }

  for (const [parentSlug, children] of childrenByParent) {
    children.sort(comparePagesForDisplay)
    childrenByParent.set(parentSlug, children)
  }

  return childrenByParent
}

const buildWikiTargetSlugByBasename = (
  pages: readonly GardenClassifiedPage[],
): Map<string, string> => {
  const map = new Map<string, string>()

  for (const page of pages) {
    const basename = page.slug.split('/').pop()?.toLowerCase()

    if (basename && !map.has(basename)) {
      map.set(basename, page.slug)
    }
  }

  for (const page of pages) {
    for (const alias of page.aliases) {
      const key = slugifyGardenSegment(alias).toLowerCase()

      if (key && !map.has(key)) {
        map.set(key, page.slug)
      }
    }
  }

  return map
}

const buildSearchSectionLabels = (input: {
  config: GardenSourceConfig
  pages: readonly GardenClassifiedPage[]
}): Record<string, string> => {
  const pageBySlug = new Map(input.pages.map((page) => [page.slug, page]))
  const labels = new Map<string, string>()

  for (const page of input.pages) {
    if (page.exposure === 'hidden') {
      continue
    }

    const sectionSlug = resolveSearchSectionSlug(page.slug)

    if (!sectionSlug || labels.has(sectionSlug)) {
      continue
    }

    const explicitSection = input.config.sections[sectionSlug]
    const sectionPage = pageBySlug.get(sectionSlug)
    const fallbackSegment = sectionSlug.split('/').pop() ?? sectionSlug

    labels.set(
      sectionSlug,
      explicitSection?.title ?? sectionPage?.title ?? titleizeSegment(fallbackSegment),
    )
  }

  return Object.fromEntries(
    [...labels.entries()].sort((left, right) => left[0].localeCompare(right[0])),
  )
}

const compareSidebarItems = (left: GardenSidebarItem, right: GardenSidebarItem): number => {
  if (left.path === '/' && right.path !== '/') {
    return -1
  }

  if (right.path === '/' && left.path !== '/') {
    return 1
  }

  const leftIsSection = left.children.length > 0
  const rightIsSection = right.children.length > 0

  const orderComparison = compareOptionalOrder(left.order, right.order)

  if (orderComparison !== 0) {
    return orderComparison
  }

  if (leftIsSection !== rightIsSection) {
    return leftIsSection ? -1 : 1
  }

  return left.label.localeCompare(right.label, undefined, {
    sensitivity: 'base',
  })
}

const sortSidebarItems = (items: GardenSidebarItem[]): GardenSidebarItem[] =>
  items.sort(compareSidebarItems).map((item) => ({
    ...item,
    children: sortSidebarItems([...item.children]),
  }))

const buildSidebarNavigation = (input: {
  config: GardenSourceConfig
  pages: readonly GardenClassifiedPage[]
  viewerExposure: Exclude<GardenPageExposure, 'hidden'>
}): GardenSidebarItem[] => {
  const visiblePages = input.pages.filter((page) =>
    canShowInSidebar(input.viewerExposure, page.exposure),
  )
  const pageBySlug = new Map(visiblePages.map((page) => [page.slug, page]))
  const sectionSlugs = new Set<string>()

  for (const page of visiblePages) {
    if (page.slug === 'index') {
      continue
    }

    const segments = page.slug.split('/').filter(Boolean)

    for (let index = 1; index < segments.length; index += 1) {
      sectionSlugs.add(segments.slice(0, index).join('/'))
    }
  }

  const rootItems: GardenSidebarItem[] = []
  const sectionsBySlug = new Map<string, GardenSidebarItem>()
  const orderedSectionSlugs = [...sectionSlugs].sort(
    (left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right),
  )

  for (const sectionSlug of orderedSectionSlugs) {
    const parentSlug = sectionSlug.split('/').slice(0, -1).join('/')
    const lastSegment = sectionSlug.split('/').pop() ?? sectionSlug
    const sectionMeta = input.config.sections[sectionSlug]
    const sectionPage = pageBySlug.get(sectionSlug)
    const node: GardenSidebarItem = {
      children: [],
      ...(sectionMeta?.description ? { description: sectionMeta.description } : {}),
      label: sectionMeta?.title ?? sectionPage?.title ?? titleizeSegment(lastSegment),
      ...(sectionMeta?.order !== undefined || sectionPage?.order !== undefined
        ? { order: sectionMeta?.order ?? sectionPage?.order }
        : {}),
      ...(sectionPage ? { path: sectionPage.routePath } : {}),
    }

    const target = parentSlug ? sectionsBySlug.get(parentSlug)?.children : rootItems

    if (!target) {
      continue
    }

    target.push(node)
    sectionsBySlug.set(sectionSlug, node)
  }

  const homePage = pageBySlug.get('index')
  const configuredHome = input.config.navigation.find((item) => item.path === '/')

  if (homePage) {
    rootItems.unshift({
      children: [],
      label:
        configuredHome?.label ??
        (input.config.title && homePage.title === input.config.title ? 'Home' : homePage.title),
      path: homePage.routePath,
    })
  }

  for (const page of visiblePages) {
    if (page.slug === 'index') {
      continue
    }

    if (sectionSlugs.has(page.slug)) {
      const existing = sectionsBySlug.get(page.slug)

      if (existing) {
        existing.path = page.routePath

        if (!input.config.sections[page.slug]?.title) {
          existing.label = page.title
        }
      }

      continue
    }

    const parentSlug = page.slug.split('/').slice(0, -1).join('/')
    const target = parentSlug ? sectionsBySlug.get(parentSlug)?.children : rootItems

    if (!target) {
      continue
    }

    target.push({
      children: [],
      label: page.title,
      ...(page.order !== undefined ? { order: page.order } : {}),
      path: page.routePath,
    })
  }

  return sortSidebarItems(rootItems)
}

const prepareGardenBuildContext = async (input: {
  sourceScopePath?: string | null
  vaultRootRef: string
}): Promise<Result<GardenPreparedBuildContext, DomainError>> => {
  const sourceData = await loadGardenSourceData(input)

  if (!sourceData.ok) {
    return sourceData
  }

  const collectedClassifiedPages = synthesizeMissingListingPages(
    sourceData.value.pageSources.map((pageSource) =>
      classifyPageExposure(pageSource.page, sourceData.value.config),
    ),
  )
  const configuredHomeSlug = resolveConfiguredHomeSlug(sourceData.value.config.home)
  const hasVisibleIndexPage = collectedClassifiedPages.some(
    (page) => page.slug === 'index' && page.exposure !== 'hidden',
  )
  const homeOwnsRoot =
    configuredHomeSlug !== undefined && configuredHomeSlug !== 'index' && !hasVisibleIndexPage
  const classifiedPages = collectedClassifiedPages.map((page) =>
    homeOwnsRoot && page.slug === configuredHomeSlug && page.exposure !== 'hidden'
      ? {
          ...page,
          routePath: '/',
        }
      : page,
  )
  const homeAliasRoutePath = homeOwnsRoot ? slugToRoutePath(configuredHomeSlug) : undefined

  return ok({
    ...sourceData.value,
    availablePublicAssetPaths: new Set(
      sourceData.value.publicAssets.map((asset) => asset.artifactPath),
    ),
    classifiedBySlug: new Map(classifiedPages.map((page) => [page.slug, page])),
    classifiedPages,
    hasProtectedSearch: classifiedPages.some((page) => page.exposure === 'protected'),
    ...(homeAliasRoutePath ? { homeAliasRoutePath } : {}),
    ...(homeOwnsRoot && configuredHomeSlug ? { homeSlug: configuredHomeSlug } : {}),
    listingChildrenByParent: toListingChildrenMap(classifiedPages),
    pageSourcesBySlug: new Map(
      sourceData.value.pageSources.map((pageSource) => [pageSource.page.slug, pageSource]),
    ),
    protectedSidebarItems: buildSidebarNavigation({
      config: sourceData.value.config,
      pages: classifiedPages,
      viewerExposure: 'protected',
    }),
    publicSidebarItems: buildSidebarNavigation({
      config: sourceData.value.config,
      pages: classifiedPages,
      viewerExposure: 'public',
    }),
    searchSectionLabels: buildSearchSectionLabels({
      config: sourceData.value.config,
      pages: classifiedPages,
    }),
    wikiTargetSlugByBasename: buildWikiTargetSlugByBasename(classifiedPages),
  })
}

export type { GardenPreparedBuildContext }
export {
  buildSearchSectionLabels,
  buildSidebarNavigation,
  buildWikiTargetSlugByBasename,
  canListChildExposure,
  classifyPageExposure,
  prepareGardenBuildContext,
  resolveConfiguredHomeSlug,
  resolveSearchSectionSlug,
  synthesizeMissingListingPages,
  toListingChildrenMap,
  titleizeSegment,
}
