import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { FileRecord } from '../../../domain/files/file-repository'
import { normalizeSeparators, toFileExtension } from './path-utils'
import type { AttachmentIndexedEntry } from './types'

const normalizeBlobStorageKey = (storageKey: string): string => {
  const normalized = normalizeSeparators(storageKey).replace(/^\/+/, '')

  if (normalized.startsWith('files/') || normalized.startsWith('workspaces/')) {
    return normalized
  }

  return `files/${normalized}`
}

const resolveBlobStoragePath = (fileStorageRoot: string, storageKey: string): string => {
  const blobRoot = resolve(fileStorageRoot, '..')
  const normalizedStorageKey = normalizeBlobStorageKey(storageKey)
  const resolvedRoot = resolve(blobRoot)
  const resolvedPath = resolve(resolvedRoot, normalizedStorageKey)

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`)) {
    throw new Error(`storage key ${storageKey} resolves outside configured blob root`)
  }

  return resolvedPath
}

const toAttachmentEntry = (file: FileRecord): AttachmentIndexedEntry => {
  const label = (file.originalFilename ?? file.title ?? file.id).trim() || file.id

  return {
    accessScope: file.accessScope,
    depth: 0,
    extension: toFileExtension(label),
    fileId: file.id,
    fileName: label,
    mimeType: file.mimeType,
    mtimeMs: file.updatedAt ? new Date(file.updatedAt).getTime() : 0,
    nameLower: label.toLowerCase(),
    pathLower: label.toLowerCase(),
    relativePath: label,
    sizeBytes: file.sizeBytes,
    source: 'attachment',
  }
}

export const dedupeAttachments = (files: readonly FileRecord[]): AttachmentIndexedEntry[] => {
  const deduped = new Map<string, AttachmentIndexedEntry>()

  for (const file of files) {
    if (deduped.has(file.id)) {
      continue
    }

    deduped.set(file.id, toAttachmentEntry(file))
  }

  return [...deduped.values()]
}

export const filterFilesWithPresentBlobs = async (
  files: readonly FileRecord[],
  fileStorageRoot: string,
): Promise<FileRecord[]> => {
  const settled = await Promise.all(
    files.map(async (file) => {
      try {
        await access(resolveBlobStoragePath(fileStorageRoot, file.storageKey))
        return file
      } catch {
        return null
      }
    }),
  )

  return settled.filter((file): file is FileRecord => file !== null)
}
