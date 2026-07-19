import type { FileRecord } from '../../../domain/files/file-repository'
import type { FileId } from '../../../shared/ids'

export interface WorkspaceIndexedEntry {
  depth: number
  extension: string
  fileName: string
  mtimeMs: number
  nameLower: string
  pathLower: string
  relativePath: string
  source: 'workspace'
}

export interface AttachmentIndexedEntry {
  accessScope: FileRecord['accessScope']
  depth: number
  extension: string
  fileId: FileId
  fileName: string
  mimeType: string | null
  mtimeMs: number
  nameLower: string
  pathLower: string
  relativePath: string
  sizeBytes: number | null
  source: 'attachment'
}

export interface McpIndexedEntry {
  depth: number
  extension: string
  fileName: string
  mtimeMs: number
  nameLower: string
  pathLower: string
  relativePath: string
  source: 'mcp'
}

export type IndexedEntry = WorkspaceIndexedEntry | AttachmentIndexedEntry | McpIndexedEntry

export interface ScoredEntry {
  entry: IndexedEntry
  matchIndices: number[]
  score: number
}
