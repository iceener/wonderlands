export const fileAccessScopeValues = ['session_local', 'account_library'] as const
export const uploadStatusValues = ['pending', 'completed', 'failed', 'cancelled'] as const

export type FileAccessScope = (typeof fileAccessScopeValues)[number]
export type UploadStatus = (typeof uploadStatusValues)[number]

export const isMimeTypeAllowed = (mimeType: string | null, allowedMimeTypes: string[]): boolean => {
  if (allowedMimeTypes.includes('*')) {
    return true
  }

  if (!mimeType) {
    return false
  }

  for (const allowedMimeType of allowedMimeTypes) {
    if (allowedMimeType.endsWith('/*')) {
      const prefix = allowedMimeType.slice(0, -1)

      if (mimeType.startsWith(prefix)) {
        return true
      }

      continue
    }

    if (allowedMimeType === mimeType) {
      return true
    }
  }

  return false
}
