import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type { BlobStore } from '../../domain/files/blob-store'
import { err, ok } from '../../shared/result'

export interface LocalBlobStoreConfig {
  root: string
}

const normalizeStorageKey = (storageKey: string): string => {
  const normalized = storageKey.replace(/\\/g, '/').replace(/^\/+/, '')

  if (normalized.startsWith('files/') || normalized.startsWith('workspaces/')) {
    return normalized
  }

  // Legacy keys were stored as <tenantId>/<fileId> beneath var/files/.
  return `files/${normalized}`
}

const resolveStoragePath = (root: string, storageKey: string): string => {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(resolvedRoot, normalizeStorageKey(storageKey))

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`)) {
    throw new Error(`storage key ${storageKey} resolves outside configured blob root`)
  }

  return resolvedPath
}

export const createLocalBlobStore = (config: LocalBlobStoreConfig): BlobStore => ({
  delete: async (storageKey) => {
    try {
      await unlink(resolveStoragePath(config.root, storageKey))

      return ok(undefined)
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        return ok(undefined)
      }

      const message = error instanceof Error ? error.message : 'Unknown blob delete failure'

      return err({
        message: `failed to delete blob ${storageKey}: ${message}`,
        type: 'conflict',
      })
    }
  },
  get: async (storageKey) => {
    try {
      const body = new Uint8Array(await readFile(resolveStoragePath(config.root, storageKey)))

      return ok({
        body,
        storageKey,
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code

      if (code === 'ENOENT') {
        return err({
          message: `blob ${storageKey} not found in local storage`,
          type: 'not_found',
        })
      }

      const message = error instanceof Error ? error.message : 'Unknown blob read failure'

      return err({
        message: `failed to read blob ${storageKey}: ${message}`,
        type: 'conflict',
      })
    }
  },
  put: async (input) => {
    try {
      const path = resolveStoragePath(config.root, input.storageKey)

      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, input.data)

      return ok({
        byteLength: input.data.byteLength,
        storageKey: input.storageKey,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown blob write failure'

      return err({
        message: `failed to write blob ${input.storageKey}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
