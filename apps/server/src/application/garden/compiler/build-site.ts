import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { writeGardenSearchArtifacts } from '../search/pagefind-index'
import {
  buildGardenSourceFingerprint,
  collectGardenAssets,
  collectGardenPageSources,
  loadGardenSourceData,
} from './build-site-source'
import {
  buildManifest,
  emitPageArtifacts,
  hydratePageMarkdown,
  renderPageBody,
  toManifestPage,
} from './build-site-pages'
import { writeGardenBuildOutput } from './build-site-artifacts'
import {
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
} from './build-site-structure'
import type {
  GardenBuildResult,
  GardenBuildWarning,
  GardenBuiltPage,
  GardenCompiledBuildResult,
  GardenManifestPage,
} from './types'

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
  const built = await buildGardenSite({
    sourceScopePath: input.sourceScopePath,
    vaultRootRef: input.vaultRootRef,
  })

  if (!built.ok) {
    return built
  }

  const written = await writeGardenBuildOutput({
    build: built.value,
    outputRootRef: input.outputRootRef,
  })

  if (!written.ok) {
    return written
  }

  return ok({
    config: built.value.config,
    manifest: {
      ...built.value.manifest,
      search: written.value.search,
    },
    protectedRootRef: written.value.protectedRootRef,
    publicRootRef: written.value.publicRootRef,
    source: built.value.source,
  })
}

export {
  buildGardenSourceFingerprint,
  buildManifest,
  buildSearchSectionLabels,
  buildSidebarNavigation,
  buildWikiTargetSlugByBasename,
  canListChildExposure,
  classifyPageExposure,
  collectGardenAssets,
  collectGardenPageSources,
  createWarningCollector,
  emitPageArtifacts,
  hydratePageMarkdown,
  loadGardenSourceData,
  prepareGardenBuildContext,
  renderPageBody,
  resolveConfiguredHomeSlug,
  resolveSearchSectionSlug,
  synthesizeMissingListingPages,
  toListingChildrenMap,
  titleizeSegment,
  toManifestPage,
  writeGardenBuildOutput,
  writeGardenSearchArtifacts,
}
