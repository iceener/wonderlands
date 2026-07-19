import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { writeGardenSearchArtifacts } from '../search/pagefind-index'
import type { GardenBuiltAsset, GardenBuiltPage, GardenBuildWriteResult } from './types'

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

const writeGardenBuildOutput = async (input: {
  build: {
    protectedAssets: readonly GardenBuiltAsset[]
    protectedPages: readonly GardenBuiltPage[]
    publicAssets: readonly GardenBuiltAsset[]
    publicPages: readonly GardenBuiltPage[]
  }
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

export { copyBuiltAsset, createDirectoryEnsurer, writeBuiltPage, writeGardenBuildOutput }
