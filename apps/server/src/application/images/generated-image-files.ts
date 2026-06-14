import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

import { createFileLinkRepository } from '../../domain/files/file-link-repository'
import { createFileRepository, type FileRecord } from '../../domain/files/file-repository'
import type { ToolContext } from '../../domain/tooling/tool-registry'
import type { DomainError } from '../../shared/errors'
import { asFileId } from '../../shared/ids'
import { ok, type Result } from '../../shared/result'
import { toAttachmentStorageKey } from '../files/attachment-storage'
import { createWorkspaceService } from '../workspaces/workspace-service'

export interface PersistGeneratedImageInput {
  images: Array<{
    base64Data: string
    mimeType: string
  }>
  metadata?: Record<string, unknown>
}

const mimeExtensions: Record<string, string> = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

const decodeBase64 = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'base64'))

const toFilename = (mimeType: string, index: number): string => {
  const extension = mimeExtensions[mimeType] ?? '.png'

  return `generated-image-${index}${extension}`
}

export const persistGeneratedImages = async (
  context: ToolContext,
  input: PersistGeneratedImageInput,
): Promise<Result<FileRecord[], DomainError>> => {
  const now = context.nowIso()
  const workspaceService = createWorkspaceService(context.db, {
    createId: context.createId,
    fileStorageRoot: context.config.files.storage.root,
  })
  const workspace = workspaceService.ensureAccountWorkspace(context.tenantScope, {
    nowIso: now,
  })

  if (!workspace.ok) {
    return workspace
  }

  const attachmentsRef = workspaceService.ensureAttachmentsRef(workspace.value)
  const fileRepository = createFileRepository(context.db)
  const fileLinkRepository = createFileLinkRepository(context.db)
  const createdFiles: FileRecord[] = []

  for (const [index, image] of input.images.entries()) {
    const body = decodeBase64(image.base64Data)
    const fileId = asFileId(context.createId('fil'))
    const originalFilename = toFilename(image.mimeType, index + 1)
    const storageKey = toAttachmentStorageKey({
      blobStorageRoot: resolve(context.config.files.storage.root, '..'),
      createdAt: now,
      fileId,
      originalFilename,
      workspaceAttachmentsRef: attachmentsRef,
    })

    if (!storageKey.ok) {
      return storageKey
    }

    const storedBlob = await context.services.files.blobStore.put({
      data: body,
      storageKey: storageKey.value,
    })

    if (!storedBlob.ok) {
      return storedBlob
    }

    const checksumSha256 = createHash('sha256').update(body).digest('hex')
    const createdFile = fileRepository.create(context.tenantScope, {
      accessScope: 'session_local',
      checksumSha256,
      createdAt: now,
      createdByAccountId: context.tenantScope.accountId,
      createdByRunId: context.run.id,
      id: fileId,
      metadata: {
        ...(input.metadata ?? {}),
        toolCallId: context.toolCallId,
      },
      mimeType: image.mimeType,
      originalFilename,
      sizeBytes: body.byteLength,
      sourceKind: 'generated',
      status: 'ready',
      storageKey: storageKey.value,
      title: originalFilename,
      updatedAt: now,
    })

    if (!createdFile.ok) {
      return createdFile
    }

    const sessionLink = fileLinkRepository.create(context.tenantScope, {
      createdAt: now,
      fileId,
      id: context.createId('flk'),
      linkType: 'session',
      targetId: context.run.sessionId,
    })

    if (!sessionLink.ok) {
      return sessionLink
    }

    const runLink = fileLinkRepository.create(context.tenantScope, {
      createdAt: now,
      fileId,
      id: context.createId('flk'),
      linkType: 'run',
      targetId: context.run.id,
    })

    if (!runLink.ok) {
      return runLink
    }

    createdFiles.push(createdFile.value)
  }

  return ok(createdFiles)
}
