import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

import type { BlobStore } from '../../domain/files/blob-store'
import { createFileLinkRepository } from '../../domain/files/file-link-repository'
import { createFileRepository, type FileRecord } from '../../domain/files/file-repository'
import {
  createKernelSessionArtifactRepository,
  type KernelSessionArtifactRecord,
} from '../../domain/kernel/kernel-session-artifact-repository'
import type { KernelSessionRecord } from '../../domain/kernel/kernel-session-repository'
import type { KernelArtifactKind } from '../../domain/kernel/types'
import type { ToolContext } from '../../domain/tooling/tool-registry'
import type { DomainError } from '../../shared/errors'
import { asFileId, asKernelSessionArtifactId, type KernelSessionArtifactId } from '../../shared/ids'
import { ok, type Result } from '../../shared/result'
import { toAttachmentStorageKey } from '../files/attachment-storage'
import { createWorkspaceService } from '../workspaces/workspace-service'

export interface PersistKernelArtifactInput {
  body: Uint8Array
  filename: string
  kind: KernelArtifactKind
  metadata?: Record<string, unknown>
  mimeType: string
}

export interface PersistedKernelArtifact {
  file: FileRecord
  kernelArtifact: KernelSessionArtifactRecord
  kind: KernelArtifactKind
}

export interface KernelArtifactService {
  persistArtifacts: (
    context: ToolContext,
    session: KernelSessionRecord,
    artifacts: PersistKernelArtifactInput[],
  ) => Promise<Result<PersistedKernelArtifact[], DomainError>>
}

export const createKernelArtifactService = (input: {
  blobStore: BlobStore
  createId: <TPrefix extends string>(prefix: TPrefix) => `${TPrefix}_${string}`
  db: Parameters<typeof createWorkspaceService>[0]
  fileStorageRoot: string
}): KernelArtifactService => {
  const workspaceService = createWorkspaceService(input.db, {
    createId: input.createId,
    fileStorageRoot: input.fileStorageRoot,
  })

  return {
    persistArtifacts: async (context, session, artifacts) => {
      const workspace = workspaceService.ensureAccountWorkspace(context.tenantScope, {
        nowIso: session.completedAt ?? session.createdAt,
      })

      if (!workspace.ok) {
        return workspace
      }

      const attachmentsRef = workspaceService.ensureAttachmentsRef(workspace.value)
      const fileRepository = createFileRepository(input.db)
      const fileLinkRepository = createFileLinkRepository(input.db)
      const kernelArtifactRepository = createKernelSessionArtifactRepository(input.db)
      const persisted: PersistedKernelArtifact[] = []

      for (const artifact of artifacts) {
        const fileId = asFileId(input.createId('fil'))
        const storageKey = toAttachmentStorageKey({
          blobStorageRoot: resolve(input.fileStorageRoot, '..'),
          createdAt: session.completedAt ?? session.createdAt,
          fileId,
          originalFilename: artifact.filename,
          workspaceAttachmentsRef: attachmentsRef,
        })

        if (!storageKey.ok) {
          return storageKey
        }

        const stored = await input.blobStore.put({
          data: artifact.body,
          storageKey: storageKey.value,
        })

        if (!stored.ok) {
          return stored
        }

        const checksumSha256 = createHash('sha256').update(artifact.body).digest('hex')
        const createdFile = fileRepository.create(context.tenantScope, {
          accessScope: 'session_local',
          checksumSha256,
          createdAt: session.completedAt ?? session.createdAt,
          createdByAccountId: context.tenantScope.accountId,
          createdByRunId: session.runId,
          id: fileId,
          metadata: {
            kernelArtifactKind: artifact.kind,
            kernelSessionId: session.id,
            ...(artifact.metadata ?? {}),
          },
          mimeType: artifact.mimeType,
          originalFilename: artifact.filename,
          sizeBytes: artifact.body.byteLength,
          sourceKind: 'artifact',
          status: 'ready',
          storageKey: storageKey.value,
          title: artifact.filename,
          updatedAt: session.completedAt ?? session.createdAt,
        })

        if (!createdFile.ok) {
          return createdFile
        }

        const links = [
          fileLinkRepository.create(context.tenantScope, {
            createdAt: session.completedAt ?? session.createdAt,
            fileId,
            id: input.createId('flk'),
            linkType: 'session',
            targetId: session.sessionId,
          }),
          fileLinkRepository.create(context.tenantScope, {
            createdAt: session.completedAt ?? session.createdAt,
            fileId,
            id: input.createId('flk'),
            linkType: 'run',
            targetId: session.runId,
          }),
          ...(session.toolExecutionId
            ? [
                fileLinkRepository.create(context.tenantScope, {
                  createdAt: session.completedAt ?? session.createdAt,
                  fileId,
                  id: input.createId('flk'),
                  linkType: 'tool_execution',
                  targetId: session.toolExecutionId,
                }),
              ]
            : []),
        ]

        for (const link of links) {
          if (!link.ok) {
            return link
          }
        }

        const kernelArtifactId = asKernelSessionArtifactId(input.createId('ksa'))
        const createdArtifact = kernelArtifactRepository.create(context.tenantScope, {
          createdAt: session.completedAt ?? session.createdAt,
          fileId,
          id: kernelArtifactId as KernelSessionArtifactId,
          kernelSessionId: session.id,
          kind: artifact.kind,
          metadataJson: artifact.metadata ?? null,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.body.byteLength,
        })

        if (!createdArtifact.ok) {
          return createdArtifact
        }

        persisted.push({
          file: createdFile.value,
          kernelArtifact: createdArtifact.value,
          kind: artifact.kind,
        })
      }

      return ok(persisted)
    },
  }
}
