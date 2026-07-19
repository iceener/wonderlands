import type { AppDatabase } from '../../db/client'
import type { FileRecord } from '../../domain/files/file-repository'
import type { DomainError } from '../../shared/errors'
import type { FileId, WorkSessionId } from '../../shared/ids'
import { ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { createResourceAccessService } from '../access/resource-access'
import { createFileRepository } from '../persistence/repositories'
import { createWorkspaceService } from '../workspaces/workspace-service'
import { dedupeAttachments, filterFilesWithPresentBlobs } from './file-picker/attachments'
import { buildMcpEntries, type McpFileRoot, resolveMcpFileRoots } from './file-picker/mcp-index'
import { scoreEntry } from './file-picker/scoring'
import { TopKHeap } from './file-picker/top-k-heap'
import type { IndexedEntry, ScoredEntry } from './file-picker/types'
import { workspaceIndexManager } from './file-picker/workspace-index'

export type { McpFileRoot } from './file-picker/mcp-index'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 50

export interface FilePickerSearchResultItem {
  accessScope: FileRecord['accessScope'] | null
  depth: number
  extension: string | null
  fileId: FileId | null
  label: string
  matchIndices: number[]
  mentionText: string
  mimeType: string | null
  relativePath: string
  sizeBytes: number | null
  source: 'attachment' | 'workspace' | 'mcp'
}

export interface SearchFilePickerInput {
  limit?: number
  query?: string
  sessionId?: WorkSessionId | null
}

const clampLimit = (value: number | undefined): number => {
  if (!value || Number.isNaN(value)) {
    return DEFAULT_LIMIT
  }

  return Math.min(Math.max(Math.floor(value), 1), MAX_LIMIT)
}

const toSearchResultItem = (candidate: ScoredEntry): FilePickerSearchResultItem => {
  if (candidate.entry.source === 'attachment') {
    return {
      accessScope: candidate.entry.accessScope,
      depth: candidate.entry.depth,
      extension: candidate.entry.extension || null,
      fileId: candidate.entry.fileId,
      label: candidate.entry.fileName,
      matchIndices: candidate.matchIndices,
      mentionText: candidate.entry.fileName,
      mimeType: candidate.entry.mimeType,
      relativePath: candidate.entry.relativePath,
      sizeBytes: candidate.entry.sizeBytes,
      source: candidate.entry.source,
    }
  }

  return {
    accessScope: null,
    depth: candidate.entry.depth,
    extension: candidate.entry.extension || null,
    fileId: null,
    label: candidate.entry.fileName,
    matchIndices: candidate.matchIndices,
    mentionText: candidate.entry.relativePath,
    mimeType: null,
    relativePath: candidate.entry.relativePath,
    sizeBytes: null,
    source: candidate.entry.source,
  }
}

export const searchFilePicker = async (
  db: AppDatabase,
  input: SearchFilePickerInput,
  context: {
    createId: <TPrefix extends string>(prefix: TPrefix) => `${TPrefix}_${string}`
    fileStorageRoot: string
    mcpFileRoots?: readonly McpFileRoot[]
    tenantScope: TenantScope
  },
): Promise<Result<FilePickerSearchResultItem[], DomainError>> => {
  const workspaceService = createWorkspaceService(db, {
    createId: context.createId,
    fileStorageRoot: context.fileStorageRoot,
  })
  const workspace = workspaceService.ensureAccountWorkspace(context.tenantScope, {
    nowIso: new Date().toISOString(),
  })

  if (!workspace.ok) {
    return workspace
  }

  const workspaceEntries = await workspaceIndexManager.get(
    workspaceService.ensureVaultRef(workspace.value),
  )
  const fileRepository = createFileRepository(db)
  const accountLibraryFiles = fileRepository.listAccountLibraryByAccountId(context.tenantScope)

  if (!accountLibraryFiles.ok) {
    return accountLibraryFiles
  }

  let sessionFiles: FileRecord[] = []
  if (input.sessionId) {
    const sessionRecord = createResourceAccessService(db).requireSessionAccess(
      context.tenantScope,
      input.sessionId,
    )

    if (!sessionRecord.ok) {
      return sessionRecord
    }

    const linkedFiles = fileRepository.listBySessionId(context.tenantScope, input.sessionId)

    if (!linkedFiles.ok) {
      return linkedFiles
    }

    sessionFiles = linkedFiles.value
  }

  const availableAttachmentFiles = await filterFilesWithPresentBlobs(
    [...sessionFiles, ...accountLibraryFiles.value],
    context.fileStorageRoot,
  )
  const attachmentEntries = dedupeAttachments(availableAttachmentFiles)
  const mcpEntries = await buildMcpEntries(resolveMcpFileRoots(context.mcpFileRoots))
  const normalizedQuery = (input.query ?? '').trim().toLowerCase()
  const heap = new TopKHeap(clampLimit(input.limit))

  const allEntries: IndexedEntry[] = [...workspaceEntries, ...attachmentEntries, ...mcpEntries]

  for (const entry of allEntries) {
    const scored = scoreEntry(entry, normalizedQuery)

    if (!scored) {
      continue
    }

    heap.push({
      entry,
      matchIndices: scored.matchIndices,
      score: scored.score,
    })
  }

  return ok(heap.toSortedArray().map(toSearchResultItem))
}
