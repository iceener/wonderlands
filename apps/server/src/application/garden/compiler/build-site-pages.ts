import { readFile } from 'node:fs/promises'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { canListChildExposure } from './build-site-structure'
import { parseGardenPage } from './parse-page'
import { type GardenListingItem, renderGardenPage } from './render-page'
import { buildRelativeRouteHref, rewriteGardenLinks } from './rewrite-links'
import type {
  GardenBuildManifest,
  GardenBuildWarning,
  GardenBuiltAsset,
  GardenBuiltPage,
  GardenClassifiedPage,
  GardenManifestPage,
  GardenSidebarItem,
  GardenSourceConfig,
} from './types'

const DEFAULT_LISTING_PAGE_SIZE = 20

const routePathToArtifactPath = (routePath: string): string =>
  routePath === '/' ? 'index.html' : `${routePath.slice(1)}.html`

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

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

const hydratePageMarkdown = async (input: {
  page: GardenClassifiedPage
  pageSource: { sourceRef: string }
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

const _comparePagesForDisplay = (
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

export type { GardenBuiltPage }
export {
  buildManifest,
  emitPageArtifacts,
  hydratePageMarkdown,
  renderPageBody,
  resolveDisplayUpdatedAt,
  toListingItems,
  toManifestPage,
}
