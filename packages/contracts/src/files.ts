import type { FileId, UploadId } from './ids'

export type FileAccessScope = 'session_local' | 'account_library'
export type BackendFileStatus = 'ready' | 'processing' | 'failed' | 'deleted' | (string & {})

export interface BackendFileSummary {
  accessScope: FileAccessScope
  contentUrl: string
  createdAt: string
  id: FileId
  mimeType: string | null
  originalFilename: string
  sizeBytes: number
  sourceKind: string
  status: BackendFileStatus
  title: string | null
}

export type UploadedBackendFileSummary = Omit<BackendFileSummary, 'sourceKind'> & {
  sourceKind?: string
  uploadId: UploadId
}

export interface BackendFilePickerResult {
  accessScope: FileAccessScope | null
  depth: number
  extension: string | null
  fileId: FileId | null
  label: string
  matchIndices: number[]
  mentionText: string
  mimeType: string | null
  relativePath: string
  sizeBytes: number | null
  source: 'attachment' | 'workspace'
}
