import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { finished } from 'node:stream/promises'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { loadGardenSourceConfig } from './load-source-config'
import { parseGardenPage } from './parse-page'
import { isGardenReservedRoot, resolveGardenSourceScope } from './resolve-source-path'
import type {
  GardenBuiltAsset,
  GardenClassifiedPage,
  GardenParsedPage,
  GardenSourceConfig,
  GardenSourceScopeResolution,
} from './types'

export interface GardenCollectedPageSource {
  page: GardenParsedPage
  sourceContentSha256: string
  sourceRef: string
}

export interface GardenResolvedSourceData {
  config: GardenSourceConfig
  configSource: string
  pageSources: GardenCollectedPageSource[]
  protectedAssets: GardenBuiltAsset[]
  publicAssets: GardenBuiltAsset[]
  source: GardenSourceScopeResolution
}

const normalizeSeparators = (value: string): string => value.replace(/\\/g, '/')

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

export {
  buildGardenSourceFingerprint,
  collectGardenAssets,
  collectGardenPageSources,
  loadGardenSourceData,
}
