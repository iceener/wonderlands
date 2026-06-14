import { basename, extname, relative, resolve } from 'node:path'

import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'

const sanitizeFilenameSegment = (value: string): string => {
  const sanitized = value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]+/g, '')
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return sanitized.length > 0 ? sanitized : 'file'
}

const toAttachmentExtension = (originalFilename: string): string => {
  const extension = extname(sanitizeFilenameSegment(originalFilename)).toLowerCase()

  return extension && extension !== '.' ? extension : ''
}

const toDateSegments = (createdAt: string): [string, string, string] => {
  const parsed = new Date(createdAt)

  if (Number.isNaN(parsed.getTime())) {
    return ['0000', '00', '00']
  }

  return [
    String(parsed.getUTCFullYear()).padStart(4, '0'),
    String(parsed.getUTCMonth() + 1).padStart(2, '0'),
    String(parsed.getUTCDate()).padStart(2, '0'),
  ]
}

const toShard = (fileId: string): string => {
  const normalized = fileId
    .replace(/^fil_/, '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toLowerCase()

  return normalized.slice(0, 2).padEnd(2, '0')
}

export const toAttachmentObjectName = (fileId: string, originalFilename: string): string =>
  `${fileId}${toAttachmentExtension(originalFilename)}`

export const toAttachmentRelativePath = (
  createdAt: string,
  fileId: string,
  originalFilename: string,
): string => {
  const [year, month, day] = toDateSegments(createdAt)

  return `${year}/${month}/${day}/${toShard(fileId)}/${toAttachmentObjectName(fileId, originalFilename)}`
}

export const toAttachmentStorageKey = (input: {
  blobStorageRoot: string
  createdAt: string
  fileId: string
  originalFilename: string
  workspaceAttachmentsRef: string
}): Result<string, DomainError> => {
  const storageKey = relative(
    resolve(input.blobStorageRoot),
    resolve(
      input.workspaceAttachmentsRef,
      toAttachmentRelativePath(input.createdAt, input.fileId, input.originalFilename),
    ),
  ).replace(/\\/g, '/')

  if (
    storageKey.length === 0 ||
    storageKey === '.' ||
    storageKey.startsWith('../') ||
    storageKey === '..'
  ) {
    return err({
      message: `attachment storage path for file ${input.fileId} is outside the blob store root`,
      type: 'conflict',
    })
  }

  return ok(storageKey)
}

export const toAttachmentInternalPath = (storageKey: string): string => {
  const normalized = storageKey.replace(/\\/g, '/').replace(/^\/+/, '')
  const marker = 'vault/attachments/'
  const markerIndex = normalized.indexOf(marker)

  if (markerIndex >= 0) {
    return `/${normalized.slice(markerIndex)}`
  }

  return `/vault/attachments/${basename(normalized)}`
}
