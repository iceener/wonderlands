import type { FileRecord } from '../../../../domain/files/file-repository'

export interface MessageAttachmentEntry {
  id: string
  kind: string
  mime: string
  name: string
  size: number
  thumbnailUrl?: string
  url: string
}

export const toMessageAttachmentEntry = (
  apiBasePath: string,
  file: Pick<FileRecord, 'id' | 'mimeType' | 'originalFilename' | 'sizeBytes' | 'title'>,
): MessageAttachmentEntry => {
  const url = `${apiBasePath}/files/${file.id}/content`
  const mime = file.mimeType ?? 'application/octet-stream'
  const kind = mime.startsWith('image/') ? 'image' : 'file'

  return {
    id: file.id,
    kind,
    mime,
    name: file.originalFilename ?? file.title ?? 'file',
    size: file.sizeBytes ?? 0,
    url,
    ...(kind === 'image' ? { thumbnailUrl: url } : {}),
  }
}

export const mergeUniqueMessageAttachments = (
  existing: MessageAttachmentEntry[] | undefined,
  incoming: MessageAttachmentEntry,
): MessageAttachmentEntry[] => {
  const next = existing ? [...existing] : []

  if (next.some((attachment) => attachment.id === incoming.id)) {
    return next
  }

  next.push(incoming)
  return next
}

export const sortMessageAttachments = (
  attachmentFileIds: string[],
  attachments: MessageAttachmentEntry[],
): MessageAttachmentEntry[] => {
  const orderById = new Map(attachmentFileIds.map((fileId, index) => [fileId, index]))

  return [...attachments].sort((left, right) => {
    const leftIndex = orderById.get(left.id)
    const rightIndex = orderById.get(right.id)

    if (leftIndex !== undefined || rightIndex !== undefined) {
      if (leftIndex === undefined) {
        return 1
      }

      if (rightIndex === undefined) {
        return -1
      }

      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex
      }
    }

    return left.id.localeCompare(right.id)
  })
}
