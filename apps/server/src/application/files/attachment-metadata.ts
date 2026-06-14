import type { FileId } from '../../shared/ids'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const readMessageAttachmentFileIds = (metadata: unknown): FileId[] => {
  if (!isRecord(metadata) || !Array.isArray(metadata.attachmentFileIds)) {
    return []
  }

  return metadata.attachmentFileIds.filter(
    (value): value is FileId => typeof value === 'string' && value.length > 0,
  )
}

export const withMessageAttachmentFileIds = (
  metadata: unknown,
  fileIds: FileId[],
): Record<string, unknown> | null => {
  const next = isRecord(metadata) ? { ...metadata } : {}
  const deduped = [...new Set(fileIds)]

  if (deduped.length === 0) {
    delete next.attachmentFileIds
  } else {
    next.attachmentFileIds = deduped
  }

  return Object.keys(next).length > 0 ? next : null
}
