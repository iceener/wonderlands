import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join, matchesGlob, relative, resolve } from 'node:path'
import type { BlobStore } from '../../domain/files/blob-store'
import type { FileRecord } from '../../domain/files/file-repository'
import type { SandboxExecutionRecord } from '../../domain/sandbox/sandbox-execution-repository'
import type { SandboxExecutionRequest } from '../../domain/sandbox/types'
import type { DomainError } from '../../shared/errors'
import { asFileId, asSandboxExecutionFileId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { toAttachmentStorageKey } from '../files/attachment-storage'
import {
  createFileLinkRepository,
  createFileRepository,
  createSandboxExecutionFileRepository,
} from '../persistence/repositories'
import { createWorkspaceService } from '../workspaces/workspace-service'

export interface PromotedSandboxArtifact {
  file: FileRecord
  sandboxPath: string
}

export interface SandboxArtifactService {
  promoteExecutionOutputs: (
    scope: TenantScope,
    execution: SandboxExecutionRecord,
  ) => Promise<Result<PromotedSandboxArtifact[], DomainError>>
}

const toSandboxRequest = (value: unknown): SandboxExecutionRequest =>
  value as SandboxExecutionRequest

const computeSha256 = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex')

const toMimeType = (path: string): string | null => {
  const normalized = path.toLowerCase()

  if (normalized.endsWith('.txt') || normalized.endsWith('.md')) {
    return 'text/plain'
  }
  if (normalized.endsWith('.json')) {
    return 'application/json'
  }
  if (normalized.endsWith('.csv')) {
    return 'text/csv'
  }
  if (normalized.endsWith('.html')) {
    return 'text/html'
  }
  if (normalized.endsWith('.js') || normalized.endsWith('.mjs') || normalized.endsWith('.cjs')) {
    return 'application/javascript'
  }
  if (normalized.endsWith('.png')) {
    return 'image/png'
  }
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
    return 'image/jpeg'
  }
  if (normalized.endsWith('.webp')) {
    return 'image/webp'
  }
  if (normalized.endsWith('.gif')) {
    return 'image/gif'
  }
  if (normalized.endsWith('.pdf')) {
    return 'application/pdf'
  }

  return null
}

const walkFiles = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const path = join(root, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path)))
      continue
    }

    if (entry.isFile()) {
      files.push(path)
    }
  }

  return files
}

const matchesOutputGlobs = (sandboxPath: string, relativePath: string, globs: string[]): boolean =>
  globs.some(
    (globPattern) =>
      matchesGlob(sandboxPath, globPattern) || matchesGlob(relativePath, globPattern),
  )

export const createSandboxArtifactService = (input: {
  blobStore: BlobStore
  createId: <TPrefix extends string>(prefix: TPrefix) => `${TPrefix}_${string}`
  db: Parameters<typeof createWorkspaceService>[0]
  fileStorageRoot: string
}): SandboxArtifactService => {
  const workspaceService = createWorkspaceService(input.db, {
    createId: input.createId,
    fileStorageRoot: input.fileStorageRoot,
  })

  return {
    promoteExecutionOutputs: async (scope, execution) => {
      try {
        const request = toSandboxRequest(execution.requestJson)
        const attachGlobs = request.outputs?.attachGlobs ?? []

        if (attachGlobs.length === 0) {
          return ok([])
        }

        const workspace = execution.workspaceId
          ? workspaceService.requireWritableWorkspace(scope, {
              nowIso: execution.createdAt,
              workspaceId: execution.workspaceId,
            })
          : workspaceService.ensureAccountWorkspace(scope, {
              nowIso: execution.createdAt,
            })

        if (!workspace.ok) {
          return workspace
        }

        const layout = workspaceService.buildLayout(
          workspace.value,
          execution.sessionId,
          execution.runId,
        )
        const outputRootRef = join(layout.runRef, 'sandboxes', execution.id, 'output')
        const artifactPaths = await walkFiles(outputRootRef).catch((error: unknown) => {
          throw error
        })
        const fileRepository = createFileRepository(input.db)
        const fileLinkRepository = createFileLinkRepository(input.db)
        const sandboxFileRepository = createSandboxExecutionFileRepository(input.db)
        const attachmentsRef = workspaceService.ensureAttachmentsRef(workspace.value)
        const promoted: PromotedSandboxArtifact[] = []

        for (const outputPath of artifactPaths) {
          const relativePath = relative(outputRootRef, outputPath).replace(/\\/g, '/')
          const sandboxPath = `/output/${relativePath}`

          if (!matchesOutputGlobs(sandboxPath, relativePath, attachGlobs)) {
            continue
          }

          const body = new Uint8Array(await readFile(outputPath))
          const checksumSha256 = computeSha256(body)
          const fileId = asFileId(input.createId('fil'))
          const storageKey = toAttachmentStorageKey({
            blobStorageRoot: resolve(input.fileStorageRoot, '..'),
            createdAt: execution.completedAt ?? execution.createdAt,
            fileId,
            originalFilename: basename(relativePath),
            workspaceAttachmentsRef: attachmentsRef,
          })

          if (!storageKey.ok) {
            return storageKey
          }

          const stored = await input.blobStore.put({
            data: body,
            storageKey: storageKey.value,
          })

          if (!stored.ok) {
            return stored
          }

          const createdFile = fileRepository.create(scope, {
            accessScope: 'session_local',
            checksumSha256,
            createdAt: execution.completedAt ?? execution.createdAt,
            createdByAccountId: scope.accountId,
            createdByRunId: execution.runId,
            id: fileId,
            metadata: {
              relativePath,
              sandboxExecutionId: execution.id,
              sandboxPath,
            },
            mimeType: toMimeType(relativePath),
            originalFilename: basename(relativePath),
            sizeBytes: body.byteLength,
            sourceKind: 'artifact',
            status: 'ready',
            storageKey: storageKey.value,
            title: relativePath,
            updatedAt: execution.completedAt ?? execution.createdAt,
          })

          if (!createdFile.ok) {
            return createdFile
          }

          const sessionLink = fileLinkRepository.create(scope, {
            createdAt: execution.completedAt ?? execution.createdAt,
            fileId,
            id: input.createId('flk'),
            linkType: 'session',
            targetId: execution.sessionId,
          })

          if (!sessionLink.ok) {
            return sessionLink
          }

          const runLink = fileLinkRepository.create(scope, {
            createdAt: execution.completedAt ?? execution.createdAt,
            fileId,
            id: input.createId('flk'),
            linkType: 'run',
            targetId: execution.runId,
          })

          if (!runLink.ok) {
            return runLink
          }

          if (execution.toolExecutionId) {
            const toolExecutionLink = fileLinkRepository.create(scope, {
              createdAt: execution.completedAt ?? execution.createdAt,
              fileId,
              id: input.createId('flk'),
              linkType: 'tool_execution',
              targetId: execution.toolExecutionId,
            })

            if (!toolExecutionLink.ok) {
              return toolExecutionLink
            }
          }

          const sandboxFile = sandboxFileRepository.create(scope, {
            checksumSha256,
            createdAt: execution.completedAt ?? execution.createdAt,
            createdFileId: fileId,
            id: asSandboxExecutionFileId(input.createId('sbf')),
            mimeType: createdFile.value.mimeType,
            role: 'generated_output',
            sandboxExecutionId: execution.id,
            sandboxPath,
            sizeBytes: body.byteLength,
          })

          if (!sandboxFile.ok) {
            return sandboxFile
          }

          promoted.push({
            file: createdFile.value,
            sandboxPath,
          })
        }

        return ok(promoted)
      } catch (error) {
        return err({
          message:
            error instanceof Error ? error.message : 'Unknown sandbox artifact promotion failure',
          type: 'conflict',
        })
      }
    },
  }
}
