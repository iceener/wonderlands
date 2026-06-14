import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { close, createIndex } from 'pagefind'

import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import type { GardenManifestSearch, GardenManifestSearchBundle } from '../compiler/types'

const PUBLIC_BUNDLE_ROUTE_PREFIX = '/_pagefind/public/'
const PUBLIC_BUNDLE_ARTIFACT_PREFIX = '_pagefind/public'
const PROTECTED_BUNDLE_ROUTE_PREFIX = '/_pagefind/protected/'
const PROTECTED_BUNDLE_ARTIFACT_PREFIX = '_pagefind/protected'

let pagefindQueue: Promise<void> = Promise.resolve()

const runSerializedPagefindTask = async <TValue>(task: () => Promise<TValue>): Promise<TValue> => {
  const nextTask = pagefindQueue.then(task, task)
  pagefindQueue = nextTask.then(
    () => undefined,
    () => undefined,
  )
  return nextTask
}

const countFiles = async (rootRef: string): Promise<number> => {
  const entries = await readdir(rootRef, {
    withFileTypes: true,
  })
  let count = 0

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue
    }

    const entryRef = resolve(rootRef, entry.name)

    if (entry.isDirectory()) {
      count += await countFiles(entryRef)
      continue
    }

    count += 1
  }

  return count
}

const toBundleManifest = (input: {
  artifactPrefix: string
  fileCount: number
  indexedPageCount: number
}): GardenManifestSearchBundle => ({
  artifactPrefix: input.artifactPrefix,
  fileCount: input.fileCount,
  indexedPageCount: input.indexedPageCount,
})

const writeBundle = async (input: {
  indexedPageCount: number
  outputRef: string
  rootRef: string
  routePrefix: string
}): Promise<Result<GardenManifestSearchBundle, DomainError>> => {
  try {
    const created = await createIndex({
      rootSelector: 'html',
      verbose: false,
      writePlayground: false,
    })

    if (!created.index) {
      return err({
        message: created.errors[0] ?? `failed to initialize Pagefind for ${input.routePrefix}`,
        type: 'conflict',
      })
    }

    try {
      const indexed = await created.index.addDirectory({
        glob: '**/*.html',
        path: input.rootRef,
      })

      if (indexed.errors.length > 0) {
        return err({
          message: `failed to index Garden bundle ${input.routePrefix}: ${indexed.errors.join('; ')}`,
          type: 'conflict',
        })
      }

      const written = await created.index.writeFiles({
        outputPath: input.outputRef,
      })

      if (written.errors.length > 0) {
        return err({
          message: `failed to write Pagefind bundle ${input.routePrefix}: ${written.errors.join('; ')}`,
          type: 'conflict',
        })
      }

      return ok(
        toBundleManifest({
          artifactPrefix: input.routePrefix,
          fileCount: await countFiles(input.outputRef),
          indexedPageCount: input.indexedPageCount,
        }),
      )
    } finally {
      await created.index.deleteIndex().catch(() => null)
    }
  } catch (error) {
    return err({
      message: `failed to build Pagefind bundle ${input.routePrefix}: ${error instanceof Error ? error.message : 'Unknown Pagefind failure'}`,
      type: 'conflict',
    })
  }
}

export const writeGardenSearchArtifacts = async (input: {
  protectedPageCount: number
  protectedRootRef: string
  publicPageCount: number
  publicRootRef: string
}): Promise<Result<GardenManifestSearch, DomainError>> =>
  runSerializedPagefindTask(async () => {
    try {
      const publicBundle = await writeBundle({
        indexedPageCount: input.publicPageCount,
        outputRef: resolve(input.publicRootRef, PUBLIC_BUNDLE_ARTIFACT_PREFIX),
        rootRef: input.publicRootRef,
        routePrefix: PUBLIC_BUNDLE_ROUTE_PREFIX,
      })

      if (!publicBundle.ok) {
        return publicBundle
      }

      if (input.protectedPageCount === 0) {
        return ok({
          enabled: true,
          engine: 'pagefind',
          protectedBundle: null,
          publicBundle: publicBundle.value,
        })
      }

      const protectedBundle = await writeBundle({
        indexedPageCount: input.protectedPageCount,
        outputRef: resolve(input.protectedRootRef, PROTECTED_BUNDLE_ARTIFACT_PREFIX),
        rootRef: input.protectedRootRef,
        routePrefix: PROTECTED_BUNDLE_ROUTE_PREFIX,
      })

      if (!protectedBundle.ok) {
        return protectedBundle
      }

      return ok({
        enabled: true,
        engine: 'pagefind',
        protectedBundle: protectedBundle.value,
        publicBundle: publicBundle.value,
      })
    } finally {
      await close().catch(() => null)
    }
  })
