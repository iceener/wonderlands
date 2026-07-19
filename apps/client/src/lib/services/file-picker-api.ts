import type { BackendFilePickerResult, SessionId } from '@wonderlands/contracts/chat'
import { apiRequest } from './backend'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isBackendFilePickerResult = (value: unknown): value is BackendFilePickerResult => {
  if (!isObject(value)) {
    return false
  }

  return (
    (value.accessScope === 'session_local' ||
      value.accessScope === 'account_library' ||
      value.accessScope === null) &&
    typeof value.depth === 'number' &&
    (typeof value.extension === 'string' || value.extension === null) &&
    (typeof value.fileId === 'string' || value.fileId === null) &&
    typeof value.label === 'string' &&
    Array.isArray(value.matchIndices) &&
    value.matchIndices.every((index) => typeof index === 'number') &&
    typeof value.mentionText === 'string' &&
    (typeof value.mimeType === 'string' || value.mimeType === null) &&
    typeof value.relativePath === 'string' &&
    (typeof value.sizeBytes === 'number' || value.sizeBytes === null) &&
    (value.source === 'attachment' || value.source === 'workspace' || value.source === 'mcp')
  )
}

export interface SearchFilePickerOptions {
  limit?: number
  sessionId?: SessionId | null
}

export const searchFilePicker = async (
  query: string,
  options: SearchFilePickerOptions = {},
): Promise<BackendFilePickerResult[]> => {
  const params = new URLSearchParams()
  params.set('query', query)

  if (typeof options.limit === 'number') {
    params.set('limit', String(options.limit))
  }

  if (options.sessionId) {
    params.set('sessionId', options.sessionId)
  }

  const payload = await apiRequest<unknown>(`/file-picker/search?${params.toString()}`)

  if (!Array.isArray(payload) || payload.some((item) => !isBackendFilePickerResult(item))) {
    throw new Error('File picker search returned an invalid payload.')
  }

  return payload
}
