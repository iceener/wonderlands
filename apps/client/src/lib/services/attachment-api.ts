import type {
  FileAccessScope,
  MessageAttachment,
  SessionId,
  UploadedBackendFileSummary,
} from '@wonderlands/contracts/chat'
import { apiRequest, toApiUrl } from './backend'

interface UploadAttachmentOptions {
  accessScope: FileAccessScope
  sessionId?: SessionId | null
  title?: string | null
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isUploadedBackendFileSummary = (value: unknown): value is UploadedBackendFileSummary => {
  if (!isObject(value)) {
    return false
  }

  return (
    (value.accessScope === 'session_local' || value.accessScope === 'account_library') &&
    typeof value.contentUrl === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.id === 'string' &&
    (typeof value.mimeType === 'string' || value.mimeType === null) &&
    typeof value.originalFilename === 'string' &&
    typeof value.sizeBytes === 'number' &&
    typeof value.status === 'string' &&
    (typeof value.title === 'string' || value.title === null) &&
    typeof value.uploadId === 'string'
  )
}

const toAttachmentKind = (mime: string): MessageAttachment['kind'] =>
  mime.startsWith('image/') ? 'image' : 'file'

export const uploadAttachment = async (
  file: File,
  options: UploadAttachmentOptions,
): Promise<MessageAttachment> => {
  const formData = new FormData()
  formData.set('file', file)
  formData.set('accessScope', options.accessScope)

  if (options.sessionId) {
    formData.set('sessionId', options.sessionId)
  }

  if (options.title?.trim()) {
    formData.set('title', options.title.trim())
  }

  const payload = await apiRequest<unknown>('/uploads', {
    body: formData,
    method: 'POST',
  })

  if (!isUploadedBackendFileSummary(payload)) {
    throw new Error('File upload returned an invalid file summary payload.')
  }

  const mime = payload.mimeType?.trim() || file.type.trim() || 'application/octet-stream'
  const url = toApiUrl(payload.contentUrl)
  const kind = toAttachmentKind(mime)

  return {
    id: payload.id,
    kind,
    mime,
    name: payload.originalFilename,
    size: payload.sizeBytes,
    url,
    ...(kind === 'image' ? { thumbnailUrl: url } : {}),
  }
}
