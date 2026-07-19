import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { finished } from 'node:stream/promises'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { writeGardenSearchArtifacts } from '../search/pagefind-index'
import { loadGardenSourceConfig } from './load-source-config'
import { parseGardenPage, slugifyGardenPath, slugifyGardenSegment } from './parse-page'
import { type GardenListingItem, renderGardenPage } from './render-page'
import { isGardenReservedRoot, resolveGardenSourceScope } from './resolve-source-path'
import { buildRelativeRouteHref, rewriteGardenLinks } from './rewrite-links'
import type {
  GardenBuildManifest,
  GardenBuildResult,
  GardenBuildWarning,
  GardenBuildWriteResult,
  GardenBuiltAsset,
  GardenBuiltPage,
  GardenClassifiedPage,
  GardenCompiledBuildResult,
  GardenManifestPage,
  GardenPageExposure,
  GardenParsedPage,
  GardenSidebarItem,
  GardenSourceConfig,
  GardenSourceScopeResolution,
} from './types'

const DEFAULT_LISTING_PAGE_SIZE = 20

interface GardenCollectedPageSource {
  page: GardenParsedPage
  sourceContentSha256: string
  sourceRef: string
}

interface GardenResolvedSourceData {
  config: GardenSourceConfig
  configSource: string
  pageSources: GardenCollectedPageSource[]
  protectedAssets: GardenBuiltAsset[]
  publicAssets: GardenBuiltAsset[]
  source: GardenSourceScopeResolution
}

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

const normalizeSeparators = (value: string): string => value.replace(/\\/g, '/')

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const routePathToArtifactPath = (routePath: string): string =>
  routePath === '/' ? 'index.html' : `${routePath.slice(1)}.html`

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

const renderRedirectPage = (input: {
  fromRoutePath: string
  siteTitle?: string
  targetRoutePath: string
  title: string
}): string => {
  const documentTitle = input.siteTitle ? `${input.title} | ${input.siteTitle}` : input.title
  const href = input.targetRoutePath || '/'

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    `<title>${escapeHtml(documentTitle)}</title>`,
    `<link rel="canonical" href="${escapeHtml(href)}">`,
    `<meta http-equiv="refresh" content="0; url=${escapeHtml(href)}">`,
    '</head>',
    `<body data-garden-route-path="${escapeHtml(input.fromRoutePath)}">`,
    `<p>Redirecting to <a href="${escapeHtml(href)}">${escapeHtml(input.title)}</a>.</p>`,
    `<script>location.replace(${JSON.stringify(href)})</script>`,
    '</body>',
    '</html>',
  ].join('\n')
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
  page: GardenParsedPage,
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

const createWarningCollector = () => {
  const warnings: GardenBuildWarning[] = []
  const keys = new Set<string>()

  return {
    add: (warning: GardenBuildWarning) => {
      const key = `${warning.code}:${warning.sourcePath}:${warning.target ?? ''}:${warning.message}`

      if (keys.has(key)) {
        return
      }

      keys.add(key)
      warnings.push(warning)
    },
    all: () => warnings,
  }
}

const hashContentSha256 = (content: string | Buffer): string =>
  createHash('sha256').update(content).digest('hex')

const hashFileSha256 = async (fileRef: string): Promise<string> => {
  const hash = createHash('sha256')
  const stream = createReadStream(fileRef)

  stream.on('data', (chunk) => {
    hash.update(chunk)
  })

  await finished(stream)

  return hash.digest('hex')
}

const hashFingerprintEntries = (
  entries: Array<{
    contentSha256: string
    path: string
  }>,
): string => {
  const hash = createHash('sha256')

  for (const entry of entries.sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(entry.path)
    hash.update('\n')
    hash.update(entry.contentSha256)
    hash.update('\n---\n')
  }

  return hash.digest('hex')
}

const collectFiles = async (
  rootRef: string,
  options: {
    includeFile?: (relativePath: string) => boolean
    skipDirectory?: (relativePath: string) => boolean
  } = {},
  currentRef = rootRef,
): Promise<string[]> => {
  const entries = await readdir(currentRef, {
    withFileTypes: true,
  })
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') {
      continue
    }

    const fullRef = resolve(currentRef, entry.name)
    const relativePath = normalizeSeparators(relative(rootRef, fullRef))

    if (entry.isDirectory()) {
      if (options.skipDirectory?.(relativePath)) {
        continue
      }

      files.push(...(await collectFiles(rootRef, options, fullRef)))
      continue
    }

    if (options.includeFile && !options.includeFile(relativePath)) {
      continue
    }

    files.push(fullRef)
  }

  return files
}

const collectGardenPageSources = async (
  source: GardenSourceScopeResolution,
): Promise<Result<GardenCollectedPageSource[], DomainError>> => {
  let markdownRefs: string[]
  try {
    markdownRefs = await collectFiles(source.sourceScopeRef, {
      includeFile: (relativePath) => relativePath.endsWith('.md'),
      skipDirectory: (relativePath) => isGardenReservedRoot(relativePath),
    })
  } catch (error) {
    return err({
      message: `failed to collect source files: ${error instanceof Error ? error.message : 'Unknown collection failure'}`,
      type: 'conflict',
    })
  }

  const pageSources: GardenCollectedPageSource[] = []
  const pagesBySlug = new Map<string, GardenCollectedPageSource>()

  for (const markdownRef of markdownRefs.sort()) {
    const sourcePath = normalizeSeparators(relative(source.sourceScopeRef, markdownRef))

    if (sourcePath === '_garden.yml') {
      continue
    }

    let raw: string
    try {
      raw = await readFile(markdownRef, 'utf8')
    } catch (error) {
      return err({
        message: `failed to read ${sourcePath}: ${error instanceof Error ? error.message : 'Unknown read failure'}`,
        type: 'conflict',
      })
    }

    const parsedPage = parseGardenPage({
      raw,
      sourcePath,
    })

    if (!parsedPage.ok) {
      return parsedPage
    }

    const existingPage = pagesBySlug.get(parsedPage.value.slug)

    if (existingPage) {
      return err({
        message: `duplicate garden slug "${parsedPage.value.slug}" resolved from ${existingPage.page.sourcePath} and ${parsedPage.value.sourcePath}`,
        type: 'conflict',
      })
    }

    const sourceStats = await stat(markdownRef)
    const pageSource = {
      page: {
        ...parsedPage.value,
        rawMarkdown: '',
        sourceUpdatedAt: sourceStats.mtime.toISOString(),
        sourceUpdatedAtMs: sourceStats.mtimeMs,
      },
      sourceContentSha256: hashContentSha256(raw),
      sourceRef: markdownRef,
    }

    pagesBySlug.set(parsedPage.value.slug, pageSource)
    pageSources.push(pageSource)
  }

  return ok(pageSources)
}

const collectGardenAssets = async (
  source: GardenSourceScopeResolution,
): Promise<
  Result<
    {
      protectedAssets: GardenBuiltAsset[]
      publicAssets: GardenBuiltAsset[]
    },
    DomainError
  >
> => {
  const publicAssets: GardenBuiltAsset[] = []
  const protectedAssets: GardenBuiltAsset[] = []

  try {
    const publicRootExists = await readdir(source.publicAssetsRef).then(
      () => true,
      () => false,
    )

    if (!publicRootExists) {
      return ok({
        protectedAssets,
        publicAssets,
      })
    }

    const assetRefs = await collectFiles(source.publicAssetsRef)

    for (const assetRef of assetRefs.sort()) {
      const assetRelativePath = normalizeSeparators(relative(source.sourceScopeRef, assetRef))
      const artifactPath = assetRelativePath

      publicAssets.push({
        artifactPath,
        sourcePath: assetRelativePath,
        sourceRef: assetRef,
      })
      protectedAssets.push({
        artifactPath,
        sourcePath: assetRelativePath,
        sourceRef: assetRef,
      })
    }

    return ok({
      protectedAssets,
      publicAssets,
    })
  } catch (error) {
    return err({
      message: `failed to collect public assets: ${error instanceof Error ? error.message : 'Unknown asset collection failure'}`,
      type: 'conflict',
    })
  }
}

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

const loadGardenSourceData = async (input: {
  sourceScopePath?: string | null
  vaultRootRef: string
}): Promise<Result<GardenResolvedSourceData, DomainError>> => {
  const source = await resolveGardenSourceScope(input)

  if (!source.ok) {
    return source
  }

  const loadedConfig = await loadGardenSourceConfig(source.value)

  if (!loadedConfig.ok) {
    return loadedConfig
  }

  const pageSources = await collectGardenPageSources(source.value)

  if (!pageSources.ok) {
    return pageSources
  }

  const assets = await collectGardenAssets(source.value)

  if (!assets.ok) {
    return assets
  }

  return ok({
    config: loadedConfig.value.config,
    configSource: loadedConfig.value.source,
    pageSources: pageSources.value,
    protectedAssets: assets.value.protectedAssets,
    publicAssets: assets.value.publicAssets,
    source: source.value,
  })
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

const buildGardenSourceFingerprint = async (input: {
  classifiedPages: readonly GardenClassifiedPage[]
  configSource: string
  pageSources: readonly GardenCollectedPageSource[]
  publicAssets: readonly GardenBuiltAsset[]
}): Promise<Result<string, DomainError>> => {
  const emittedSourcePaths = new Set(
    input.classifiedPages
      .filter((page) => page.exposure !== 'hidden')
      .map((page) => page.sourcePath),
  )
  const fingerprintEntries: Array<{ contentSha256: string; path: string }> = [
    {
      contentSha256: hashContentSha256(input.configSource),
      path: '_garden.yml',
    },
  ]

  for (const pageSource of input.pageSources) {
    if (!emittedSourcePaths.has(pageSource.page.sourcePath)) {
      continue
    }

    fingerprintEntries.push({
      contentSha256: pageSource.sourceContentSha256,
      path: pageSource.page.sourcePath,
    })
  }

  try {
    for (const asset of input.publicAssets) {
      fingerprintEntries.push({
        contentSha256: await hashFileSha256(asset.sourceRef),
        path: asset.sourcePath,
      })
    }
  } catch (error) {
    return err({
      message: `failed to hash garden source files: ${error instanceof Error ? error.message : 'Unknown fingerprint failure'}`,
      type: 'conflict',
    })
  }

  return ok(hashFingerprintEntries(fingerprintEntries))
}

const hydratePageMarkdown = async (input: {
  page: GardenClassifiedPage
  pageSource: GardenCollectedPageSource
}): Promise<Result<GardenClassifiedPage, DomainError>> => {
  let raw: string
  try {
    raw = await readFile(input.pageSource.sourceRef, 'utf8')
  } catch (error) {
    return err({
      message: `failed to read ${input.page.sourcePath}: ${error instanceof Error ? error.message : 'Unknown read failure'}`,
      type: 'conflict',
    })
  }

  const parsedPage = parseGardenPage({
    raw,
    sourcePath: input.page.sourcePath,
  })

  if (!parsedPage.ok) {
    return parsedPage
  }

  return ok({
    ...input.page,
    rawMarkdown: parsedPage.value.rawMarkdown,
  })
}

const renderPageBody = (input: {
  availablePublicAssetPaths: ReadonlySet<string>
  page: GardenClassifiedPage
  pagesBySlug: Map<string, GardenClassifiedPage>
  warnings: ReturnType<typeof createWarningCollector>
  wikiTargetSlugByBasename: ReadonlyMap<string, string>
}): string => {
  const rewritten = rewriteGardenLinks({
    availablePublicAssetPaths: input.availablePublicAssetPaths,
    currentFilePath: input.page.sourcePath,
    currentRoutePath: input.page.routePath,
    currentSlug: input.page.slug,
    markdown: input.page.rawMarkdown,
    wikiTargetSlugByBasename: input.wikiTargetSlugByBasename,
    onInternalLink: ({ anchor, label, slug }) => {
      const targetPage = input.pagesBySlug.get(slug)

      if (!targetPage) {
        return {
          kind: 'text' as const,
          text: label,
          warning: {
            code: 'unresolved_link' as const,
            message: `Link target "${slug}" could not be resolved`,
            sourcePath: input.page.sourcePath,
            target: slug,
          },
        }
      }

      if (targetPage.exposure === 'hidden') {
        return {
          kind: 'text' as const,
          text: label,
          warning: {
            code: 'hidden_link' as const,
            message: `Link target "${slug}" is excluded from the published garden`,
            sourcePath: input.page.sourcePath,
            target: slug,
          },
        }
      }

      return {
        href: buildRelativeRouteHref(input.page.routePath, targetPage.routePath, anchor),
        kind: 'link' as const,
      }
    },
  })

  for (const warning of rewritten.warnings) {
    input.warnings.add(warning)
  }

  return rewritten.markdown
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

const chunkListingItems = <TValue>(values: readonly TValue[], size: number): TValue[][] => {
  const chunks: TValue[][] = []

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }

  return chunks
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

const resolveDisplayUpdatedAt = (page: GardenClassifiedPage): string | undefined =>
  page.updated ??
  page.date ??
  page.sourcePath.match(/\d{4}-\d{2}-\d{2}/)?.[0] ??
  page.sourceUpdatedAt

const toListingItems = (pages: readonly GardenClassifiedPage[]): GardenListingItem[] =>
  pages.map((page) => ({
    date: page.date,
    description: page.excerpt ?? page.description,
    routePath: page.routePath,
    tags: page.tags,
    title: page.title,
    ...(resolveDisplayUpdatedAt(page) ? { updated: resolveDisplayUpdatedAt(page) } : {}),
  }))

const titleizeSegment = (value: string): string =>
  value
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())

const resolveSearchSectionSlug = (sourceSlug: string): string | undefined => {
  if (!sourceSlug || sourceSlug === 'index') {
    return undefined
  }

  const parentSlug = sourceSlug.split('/').slice(0, -1).join('/')
  return parentSlug || sourceSlug
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

const resolveCoverImageArtifactPath = (
  page: GardenClassifiedPage,
  availablePublicAssetPaths: ReadonlySet<string>,
): Result<string | undefined, DomainError> => {
  if (!page.coverImage) {
    return ok(undefined)
  }

  if (!availablePublicAssetPaths.has(page.coverImage)) {
    return err({
      message: `${page.sourcePath}: cover_image "${page.coverImage}" was not found under public/`,
      type: 'validation',
    })
  }

  return ok(page.coverImage)
}

const withHomeAliasArtifact = (input: {
  artifacts: GardenBuiltPage[]
  homeAliasRoutePath?: string
  homeSlug?: string
  page: GardenClassifiedPage
  siteTitle?: string
}): GardenBuiltPage[] => {
  if (
    !input.homeAliasRoutePath ||
    !input.homeSlug ||
    input.page.slug !== input.homeSlug ||
    input.page.exposure !== 'public' ||
    input.page.routePath === input.homeAliasRoutePath
  ) {
    return input.artifacts
  }

  return [
    ...input.artifacts,
    {
      artifactPath: routePathToArtifactPath(input.homeAliasRoutePath),
      content: renderRedirectPage({
        fromRoutePath: input.homeAliasRoutePath,
        siteTitle: input.siteTitle,
        targetRoutePath: input.page.routePath,
        title: input.page.title,
      }),
      ...(input.page.coverImage ? { coverImageArtifactPath: input.page.coverImage } : {}),
      ...(input.page.description ? { description: input.page.description } : {}),
      ...(input.page.excerpt ? { excerpt: input.page.excerpt } : {}),
      ...(input.page.order !== undefined ? { order: input.page.order } : {}),
      routePath: input.homeAliasRoutePath,
      sourcePath: input.page.sourcePath,
      sourceSlug: input.page.slug,
      tags: input.page.tags,
      title: input.page.title,
      visibility: 'public',
    },
  ]
}

const emitPageArtifacts = (input: {
  availablePublicAssetPaths: ReadonlySet<string>
  baseMarkdown: string
  config: GardenSourceConfig
  hasProtectedSearch: boolean
  homeAliasRoutePath?: string
  homeSlug?: string
  searchSectionLabels: Record<string, string>
  listingChildrenByParent: Map<string, GardenClassifiedPage[]>
  page: GardenClassifiedPage
  sidebarItems: readonly GardenSidebarItem[]
}): Result<GardenBuiltPage[], DomainError> => {
  const visibility = input.page.exposure === 'protected' ? 'protected' : 'public'
  const listingChildren =
    input.page.listing !== false && input.page.exposure !== 'hidden'
      ? (input.listingChildrenByParent.get(input.page.slug) ?? []).filter((child) =>
          canListChildExposure(input.page.exposure, child.exposure),
        )
      : []
  const coverImageArtifactPath = resolveCoverImageArtifactPath(
    input.page,
    input.availablePublicAssetPaths,
  )

  if (!coverImageArtifactPath.ok) {
    return coverImageArtifactPath
  }

  const pageSize =
    input.page.listingPageSize ?? input.config.listing.defaultPageSize ?? DEFAULT_LISTING_PAGE_SIZE

  if (listingChildren.length === 0) {
    return ok(
      withHomeAliasArtifact({
        artifacts: [
          {
            artifactPath: routePathToArtifactPath(input.page.routePath),
            content: renderGardenPage({
              bodyMarkdown: input.baseMarkdown,
              coverImageArtifactPath: coverImageArtifactPath.value,
              currentRoutePath: input.page.routePath,
              date: input.page.date,
              description: input.page.description,
              excerpt: input.page.excerpt,
              hasProtectedSearch: input.hasProtectedSearch,
              order: input.page.order,
              navigationItems: input.config.navigation,
              noindex: input.config.noindex,
              sidebarItems: input.sidebarItems,
              seo: input.page.seo,
              searchSectionLabels: input.searchSectionLabels,
              siteDescription: input.config.description,
              siteImage: input.config.image,
              siteTitle: input.config.title,
              siteTwitter: input.config.twitter,
              lastUpdated: input.page.slug.includes('/')
                ? resolveDisplayUpdatedAt(input.page)
                : undefined,
              sourceSlug: input.page.slug,
              tags: input.page.tags,
              title: input.page.title,
              updated: input.page.updated,
              visibility,
            }),
            ...(coverImageArtifactPath.value
              ? { coverImageArtifactPath: coverImageArtifactPath.value }
              : {}),
            ...(input.page.description ? { description: input.page.description } : {}),
            ...(input.page.excerpt ? { excerpt: input.page.excerpt } : {}),
            ...(input.page.order !== undefined ? { order: input.page.order } : {}),
            routePath: input.page.routePath,
            sourcePath: input.page.sourcePath,
            sourceSlug: input.page.slug,
            ...(input.page.synthetic ? { synthetic: true } : {}),
            tags: input.page.tags,
            title: input.page.title,
            visibility,
          },
        ],
        homeAliasRoutePath: input.homeAliasRoutePath,
        homeSlug: input.homeSlug,
        page: input.page,
        siteTitle: input.config.title,
      }),
    )
  }

  const listingChunks = chunkListingItems(listingChildren, pageSize)

  return ok(
    withHomeAliasArtifact({
      artifacts: listingChunks.map((chunk, index) => {
        const listingPageNumber = index + 1
        const routePath =
          listingPageNumber === 1
            ? input.page.routePath
            : input.page.routePath === '/'
              ? `/page/${listingPageNumber}`
              : `${input.page.routePath}/page/${listingPageNumber}`

        return {
          artifactPath: routePathToArtifactPath(routePath),
          content: renderGardenPage({
            bodyMarkdown: input.baseMarkdown,
            coverImageArtifactPath: coverImageArtifactPath.value,
            currentRoutePath: routePath,
            date: input.page.date,
            description: input.page.description,
            excerpt: input.page.excerpt,
            hasProtectedSearch: input.hasProtectedSearch,
            listing: {
              currentPage: listingPageNumber,
              items: toListingItems(chunk),
              parentRoutePath: input.page.routePath,
              totalPages: listingChunks.length,
            },
            order: input.page.order,
            navigationItems: input.config.navigation,
            noindex: input.config.noindex,
            sidebarItems: input.sidebarItems,
            seo: input.page.seo,
            searchSectionLabels: input.searchSectionLabels,
            siteDescription: input.config.description,
            siteImage: input.config.image,
            siteTitle: input.config.title,
            siteTwitter: input.config.twitter,
            sourceSlug: input.page.slug,
            tags: input.page.tags,
            title: input.page.title,
            updated: input.page.updated,
            visibility,
          }),
          ...(coverImageArtifactPath.value
            ? { coverImageArtifactPath: coverImageArtifactPath.value }
            : {}),
          ...(input.page.description ? { description: input.page.description } : {}),
          ...(input.page.excerpt ? { excerpt: input.page.excerpt } : {}),
          ...(input.page.order !== undefined ? { order: input.page.order } : {}),
          listingPageNumber,
          routePath,
          sourcePath: input.page.sourcePath,
          sourceSlug: input.page.slug,
          ...(input.page.synthetic ? { synthetic: true } : {}),
          tags: input.page.tags,
          title: input.page.title,
          visibility,
        }
      }),
      homeAliasRoutePath: input.homeAliasRoutePath,
      homeSlug: input.homeSlug,
      page: input.page,
      siteTitle: input.config.title,
    }),
  )
}

const toManifestPage = (page: GardenBuiltPage): GardenManifestPage => ({
  artifactPath: page.artifactPath,
  ...(page.coverImageArtifactPath ? { coverImageArtifactPath: page.coverImageArtifactPath } : {}),
  ...(page.description ? { description: page.description } : {}),
  ...(page.excerpt ? { excerpt: page.excerpt } : {}),
  ...(page.listingPageNumber ? { listingPageNumber: page.listingPageNumber } : {}),
  ...(page.order !== undefined ? { order: page.order } : {}),
  routePath: page.routePath,
  sourcePath: page.sourcePath,
  sourceSlug: page.sourceSlug,
  tags: page.tags,
  title: page.title,
  visibility: page.visibility,
})

const buildManifest = (input: {
  pages: GardenManifestPage[]
  publicAssets: readonly GardenBuiltAsset[]
  protectedPageCount: number
  publicPageCount: number
  sourceFingerprintSha256: string
  warnings: GardenBuildWarning[]
  search?: GardenBuildManifest['search']
}): GardenBuildManifest => ({
  assets: input.publicAssets.map((asset) => ({
    artifactPath: asset.artifactPath,
    sourcePath: asset.sourcePath,
  })),
  pages: [...input.pages].sort((left, right) => left.routePath.localeCompare(right.routePath)),
  protectedPageCount: input.protectedPageCount,
  publicPageCount: input.publicPageCount,
  ...(input.search ? { search: input.search } : {}),
  sourceFingerprintSha256: input.sourceFingerprintSha256,
  warnings: input.warnings,
})

const createDirectoryEnsurer = () => {
  const ensured = new Set<string>()

  return async (outputRef: string) => {
    const directoryRef = dirname(outputRef)

    if (ensured.has(directoryRef)) {
      return
    }

    await mkdir(directoryRef, { recursive: true })
    ensured.add(directoryRef)
  }
}

const writeBuiltPage = async (input: {
  ensureDirectory: (outputRef: string) => Promise<void>
  outputRootRef: string
  page: GardenBuiltPage
}): Promise<void> => {
  const outputRef = resolve(input.outputRootRef, input.page.artifactPath)

  await input.ensureDirectory(outputRef)
  await writeFile(outputRef, input.page.content, 'utf8')
}

const copyBuiltAsset = async (input: {
  asset: GardenBuiltAsset
  ensureDirectory: (outputRef: string) => Promise<void>
  outputRootRef: string
}): Promise<void> => {
  const outputRef = resolve(input.outputRootRef, input.asset.artifactPath)

  await input.ensureDirectory(outputRef)
  await copyFile(input.asset.sourceRef, outputRef)
}

export const computeGardenSourceFingerprint = async (input: {
  sourceScopePath?: string | null
  vaultRootRef: string
}): Promise<Result<string, DomainError>> => {
  const sourceData = await loadGardenSourceData(input)

  if (!sourceData.ok) {
    return sourceData
  }

  const classifiedPages = sourceData.value.pageSources
    .map((pageSource) => pageSource.page)
    .map((page) => classifyPageExposure(page, sourceData.value.config))

  return buildGardenSourceFingerprint({
    classifiedPages,
    configSource: sourceData.value.configSource,
    pageSources: sourceData.value.pageSources,
    publicAssets: sourceData.value.publicAssets,
  })
}

export const buildGardenSite = async (input: {
  sourceScopePath?: string | null
  vaultRootRef: string
}): Promise<Result<GardenBuildResult, DomainError>> => {
  const prepared = await prepareGardenBuildContext(input)

  if (!prepared.ok) {
    return prepared
  }
  const warnings = createWarningCollector()
  const publicPages: GardenBuiltPage[] = []
  const protectedPages: GardenBuiltPage[] = []

  for (const page of prepared.value.classifiedPages) {
    if (page.exposure === 'hidden') {
      continue
    }

    const pageSource = prepared.value.pageSourcesBySlug.get(page.slug)
    const hydratedPage = page.synthetic
      ? ok(page)
      : pageSource
        ? await hydratePageMarkdown({
            page,
            pageSource,
          })
        : err({
            message: `failed to resolve source for ${page.sourcePath}`,
            type: 'conflict',
          } as DomainError)

    if (!hydratedPage.ok) {
      return hydratedPage
    }

    const baseMarkdown = renderPageBody({
      availablePublicAssetPaths: prepared.value.availablePublicAssetPaths,
      page: hydratedPage.value,
      pagesBySlug: prepared.value.classifiedBySlug,
      warnings,
      wikiTargetSlugByBasename: prepared.value.wikiTargetSlugByBasename,
    })

    const artifacts = emitPageArtifacts({
      availablePublicAssetPaths: prepared.value.availablePublicAssetPaths,
      baseMarkdown,
      config: prepared.value.config,
      hasProtectedSearch: prepared.value.hasProtectedSearch,
      homeAliasRoutePath: prepared.value.homeAliasRoutePath,
      homeSlug: prepared.value.homeSlug,
      searchSectionLabels: prepared.value.searchSectionLabels,
      listingChildrenByParent: prepared.value.listingChildrenByParent,
      page: hydratedPage.value,
      sidebarItems:
        hydratedPage.value.exposure === 'protected'
          ? prepared.value.protectedSidebarItems
          : prepared.value.publicSidebarItems,
    })

    if (!artifacts.ok) {
      return artifacts
    }

    if (hydratedPage.value.exposure === 'public') {
      publicPages.push(...artifacts.value)
      continue
    }

    protectedPages.push(...artifacts.value)
  }

  const sourceFingerprint = await buildGardenSourceFingerprint({
    classifiedPages: prepared.value.classifiedPages,
    configSource: prepared.value.configSource,
    pageSources: prepared.value.pageSources,
    publicAssets: prepared.value.publicAssets,
  })

  if (!sourceFingerprint.ok) {
    return sourceFingerprint
  }

  const manifestPages = [...publicPages, ...protectedPages].map(toManifestPage)

  return ok({
    config: prepared.value.config,
    manifest: buildManifest({
      pages: manifestPages,
      protectedPageCount: protectedPages.filter((page) => !page.synthetic).length,
      publicAssets: prepared.value.publicAssets,
      publicPageCount: publicPages.filter((page) => !page.synthetic).length,
      sourceFingerprintSha256: sourceFingerprint.value,
      warnings: warnings.all(),
    }),
    protectedAssets: prepared.value.protectedAssets,
    protectedPages,
    publicAssets: prepared.value.publicAssets,
    publicPages,
    source: prepared.value.source,
  })
}

export const compileGardenBuildOutput = async (input: {
  outputRootRef: string
  sourceScopePath?: string | null
  vaultRootRef: string
}): Promise<Result<GardenCompiledBuildResult, DomainError>> => {
  const prepared = await prepareGardenBuildContext(input)

  if (!prepared.ok) {
    return prepared
  }

  const sourceFingerprint = await buildGardenSourceFingerprint({
    classifiedPages: prepared.value.classifiedPages,
    configSource: prepared.value.configSource,
    pageSources: prepared.value.pageSources,
    publicAssets: prepared.value.publicAssets,
  })

  if (!sourceFingerprint.ok) {
    return sourceFingerprint
  }

  const publicRootRef = resolve(input.outputRootRef, 'public')
  const protectedRootRef = resolve(input.outputRootRef, 'protected')
  const ensureDirectory = createDirectoryEnsurer()
  const warnings = createWarningCollector()
  const manifestPages: GardenManifestPage[] = []
  let publicPageCount = 0
  let protectedPageCount = 0

  try {
    await rm(input.outputRootRef, {
      force: true,
      recursive: true,
    })
    await mkdir(publicRootRef, { recursive: true })
    await mkdir(protectedRootRef, { recursive: true })

    for (const page of prepared.value.classifiedPages) {
      if (page.exposure === 'hidden') {
        continue
      }

      const pageSource = prepared.value.pageSourcesBySlug.get(page.slug)
      const hydratedPage = page.synthetic
        ? ok(page)
        : pageSource
          ? await hydratePageMarkdown({
              page,
              pageSource,
            })
          : err({
              message: `failed to resolve source for ${page.sourcePath}`,
              type: 'conflict',
            } as DomainError)

      if (!hydratedPage.ok) {
        return hydratedPage
      }

      const baseMarkdown = renderPageBody({
        availablePublicAssetPaths: prepared.value.availablePublicAssetPaths,
        page: hydratedPage.value,
        pagesBySlug: prepared.value.classifiedBySlug,
        warnings,
        wikiTargetSlugByBasename: prepared.value.wikiTargetSlugByBasename,
      })

      const artifacts = emitPageArtifacts({
        availablePublicAssetPaths: prepared.value.availablePublicAssetPaths,
        baseMarkdown,
        config: prepared.value.config,
        hasProtectedSearch: prepared.value.hasProtectedSearch,
        homeAliasRoutePath: prepared.value.homeAliasRoutePath,
        homeSlug: prepared.value.homeSlug,
        listingChildrenByParent: prepared.value.listingChildrenByParent,
        page: hydratedPage.value,
        searchSectionLabels: prepared.value.searchSectionLabels,
        sidebarItems:
          hydratedPage.value.exposure === 'protected'
            ? prepared.value.protectedSidebarItems
            : prepared.value.publicSidebarItems,
      })

      if (!artifacts.ok) {
        return artifacts
      }

      const outputRootRef =
        hydratedPage.value.exposure === 'protected' ? protectedRootRef : publicRootRef

      for (const artifact of artifacts.value) {
        await writeBuiltPage({
          ensureDirectory,
          outputRootRef,
          page: artifact,
        })

        manifestPages.push(toManifestPage(artifact))

        if (artifact.synthetic) {
          continue
        }

        if (artifact.visibility === 'protected') {
          protectedPageCount += 1
          continue
        }

        publicPageCount += 1
      }
    }

    for (const asset of prepared.value.publicAssets) {
      await copyBuiltAsset({
        asset,
        ensureDirectory,
        outputRootRef: publicRootRef,
      })
    }

    for (const asset of prepared.value.protectedAssets) {
      await copyBuiltAsset({
        asset,
        ensureDirectory,
        outputRootRef: protectedRootRef,
      })
    }

    const search = await writeGardenSearchArtifacts({
      protectedPageCount,
      protectedRootRef,
      publicPageCount,
      publicRootRef,
    })

    if (!search.ok) {
      return search
    }

    return ok({
      config: prepared.value.config,
      manifest: buildManifest({
        pages: manifestPages,
        protectedPageCount,
        publicAssets: prepared.value.publicAssets,
        publicPageCount,
        search: search.value,
        sourceFingerprintSha256: sourceFingerprint.value,
        warnings: warnings.all(),
      }),
      protectedRootRef,
      publicRootRef,
      source: prepared.value.source,
    })
  } catch (error) {
    return err({
      message: `failed to compile garden build output: ${error instanceof Error ? error.message : 'Unknown write failure'}`,
      type: 'conflict',
    })
  }
}

export const writeGardenBuildOutput = async (input: {
  build: GardenBuildResult
  outputRootRef: string
}): Promise<Result<GardenBuildWriteResult, DomainError>> => {
  const publicRootRef = resolve(input.outputRootRef, 'public')
  const protectedRootRef = resolve(input.outputRootRef, 'protected')
  const ensureDirectory = createDirectoryEnsurer()

  try {
    await rm(input.outputRootRef, {
      force: true,
      recursive: true,
    })
    await mkdir(publicRootRef, { recursive: true })
    await mkdir(protectedRootRef, { recursive: true })

    for (const page of input.build.publicPages) {
      await writeBuiltPage({
        ensureDirectory,
        outputRootRef: publicRootRef,
        page,
      })
    }

    for (const page of input.build.protectedPages) {
      await writeBuiltPage({
        ensureDirectory,
        outputRootRef: protectedRootRef,
        page,
      })
    }

    for (const asset of input.build.publicAssets) {
      await copyBuiltAsset({
        asset,
        ensureDirectory,
        outputRootRef: publicRootRef,
      })
    }

    for (const asset of input.build.protectedAssets) {
      await copyBuiltAsset({
        asset,
        ensureDirectory,
        outputRootRef: protectedRootRef,
      })
    }

    const search = await writeGardenSearchArtifacts({
      protectedPageCount: input.build.protectedPages.filter((page) => !page.synthetic).length,
      protectedRootRef,
      publicPageCount: input.build.publicPages.filter((page) => !page.synthetic).length,
      publicRootRef,
    })

    if (!search.ok) {
      return search
    }

    return ok({
      protectedRootRef,
      publicRootRef,
      search: search.value,
    })
  } catch (error) {
    return err({
      message: `failed to write garden build output: ${error instanceof Error ? error.message : 'Unknown write failure'}`,
      type: 'conflict',
    })
  }
}
