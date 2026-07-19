import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { createFileLinkRepository } from '../../adapters/persistence/sqlite/files/file-link-repository'
import { createFileRepository } from '../../adapters/persistence/sqlite/files/file-repository'
import { createUploadRepository } from '../../adapters/persistence/sqlite/files/upload-repository'
import { createTenantMembershipRepository } from '../../adapters/persistence/sqlite/tenancy/tenant-membership-repository'
import { withTransaction } from '../../db/transaction'
import { type FileAccessScope, isMimeTypeAllowed } from '../../domain/files/file-access'
import type { FileRecord } from '../../domain/files/file-repository'
import { type DomainError, DomainErrorException } from '../../shared/errors'
import { asFileId, asUploadId, type WorkSessionId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import { createResourceAccessService } from '../access/resource-access'
import type { CommandContext, CommandResult } from '../commands/command-context'
import { createEventStore } from '../commands/event-store'
import { createWorkspaceService } from '../workspaces/workspace-service'
import { toAttachmentStorageKey } from './attachment-storage'

export interface UploadedFileLike {
  arrayBuffer: () => Promise<ArrayBuffer>
  name: string
  size: number
  type: string
}

export interface UploadFileInput {
  accessScope: FileAccessScope
  file: UploadedFileLike
  sessionId?: WorkSessionId | null
  title?: string | null
}

export interface UploadFileOutput {
  file: FileRecord
  uploadId: ReturnType<typeof asUploadId>
}

const unwrapOrThrow = <TValue>(result: Result<TValue, DomainError>): TValue => {
  if (!result.ok) {
    throw new DomainErrorException(result.error)
  }

  return result.value
}

const markUploadFailed = (
  context: CommandContext,
  uploadId: ReturnType<typeof asUploadId>,
  errorText: string,
) => {
  const uploadRepository = createUploadRepository(context.db)
  const now = context.services.clock.nowIso()

  uploadRepository.fail(context.tenantScope, {
    errorText,
    id: uploadId,
    updatedAt: now,
  })
  createEventStore(context.db).append({
    actorAccountId: context.tenantScope.accountId,
    aggregateId: uploadId,
    aggregateType: 'upload',
    outboxTopics: ['projection', 'realtime'],
    payload: {
      errorText,
      uploadId,
    },
    tenantId: context.tenantScope.tenantId,
    traceId: context.traceId,
    type: 'upload.failed',
  })
}

export const createUploadFileCommand = () => ({
  execute: async (
    context: CommandContext,
    input: UploadFileInput,
  ): Promise<CommandResult<UploadFileOutput>> => {
    let stagedStorageKey: string | null = null
    const membershipRepository = createTenantMembershipRepository(context.db)
    const membership = membershipRepository.requireMembership(context.tenantScope)

    if (!membership.ok) {
      return membership
    }

    if (input.accessScope === 'session_local' && !input.sessionId) {
      return err({
        message: 'sessionId is required when accessScope=session_local',
        type: 'validation',
      })
    }

    if (input.accessScope === 'account_library' && input.sessionId) {
      return err({
        message: 'sessionId is not allowed when accessScope=account_library',
        type: 'validation',
      })
    }

    if (!input.file.name.trim()) {
      return err({
        message: 'Uploaded file must have a name',
        type: 'validation',
      })
    }

    if (input.file.size <= 0) {
      return err({
        message: 'Uploaded file must not be empty',
        type: 'validation',
      })
    }

    if (input.file.size > context.config.files.maxUploadBytes) {
      return err({
        message: `Uploaded file exceeds the configured limit of ${context.config.files.maxUploadBytes} bytes`,
        type: 'validation',
      })
    }

    if (!isMimeTypeAllowed(input.file.type || null, context.config.files.allowedMimeTypes)) {
      return err({
        message: `Uploaded file type ${input.file.type || 'unknown'} is not allowed`,
        type: 'validation',
      })
    }

    if (input.sessionId) {
      const session = createResourceAccessService(context.db).requireSessionAccess(
        context.tenantScope,
        input.sessionId,
      )

      if (!session.ok) {
        return session
      }

      if (session.value.status !== 'active') {
        return err({
          message: `session ${input.sessionId} is not active`,
          type: 'conflict',
        })
      }
    }

    const now = context.services.clock.nowIso()
    const uploadId = asUploadId(context.services.ids.create('upl'))
    const fileId = asFileId(context.services.ids.create('fil'))
    const uploadRepository = createUploadRepository(context.db)
    const createdUpload = uploadRepository.create(context.tenantScope, {
      accessScope: input.accessScope,
      accountId: context.tenantScope.accountId,
      createdAt: now,
      declaredMimeType: input.file.type || null,
      id: uploadId,
      originalFilename: input.file.name,
      sessionId: input.sessionId ?? null,
      status: 'pending',
      title: input.title ?? null,
      updatedAt: now,
    })

    if (!createdUpload.ok) {
      return createdUpload
    }

    try {
      const workspaceService = createWorkspaceService(context.db, {
        createId: context.services.ids.create,
        fileStorageRoot: context.config.files.storage.root,
      })
      const workspace = workspaceService.ensureAccountWorkspace(context.tenantScope, {
        nowIso: now,
      })

      if (!workspace.ok) {
        markUploadFailed(context, uploadId, workspace.error.message)
        return workspace
      }

      const body = new Uint8Array(await input.file.arrayBuffer())
      const checksumSha256 = createHash('sha256').update(body).digest('hex')
      const attachmentsRef = workspaceService.ensureAttachmentsRef(workspace.value)
      const storageKey = toAttachmentStorageKey({
        blobStorageRoot: resolve(context.config.files.storage.root, '..'),
        createdAt: now,
        fileId,
        originalFilename: input.file.name,
        workspaceAttachmentsRef: attachmentsRef,
      })

      if (!storageKey.ok) {
        markUploadFailed(context, uploadId, storageKey.error.message)
        return storageKey
      }

      stagedStorageKey = storageKey.value

      const storedBlob = await context.services.files.blobStore.put({
        data: body,
        storageKey: stagedStorageKey,
      })

      if (!storedBlob.ok) {
        markUploadFailed(context, uploadId, storedBlob.error.message)
        return storedBlob
      }

      const file = withTransaction(context.db, (tx) => {
        const fileRepository = createFileRepository(tx)
        const fileLinkRepository = createFileLinkRepository(tx)
        const txUploadRepository = createUploadRepository(tx)
        const eventStore = createEventStore(tx)
        const createdFile = unwrapOrThrow(
          fileRepository.create(context.tenantScope, {
            accessScope: input.accessScope,
            checksumSha256,
            createdAt: now,
            createdByAccountId: context.tenantScope.accountId,
            id: fileId,
            mimeType: input.file.type || null,
            originUploadId: uploadId,
            originalFilename: input.file.name,
            sizeBytes: body.byteLength,
            sourceKind: 'upload',
            status: 'ready',
            storageKey: stagedStorageKey!,
            title: input.title ?? null,
            updatedAt: now,
          }),
        )

        if (input.sessionId) {
          unwrapOrThrow(
            fileLinkRepository.create(context.tenantScope, {
              createdAt: now,
              fileId,
              id: context.services.ids.create('flk'),
              linkType: 'session',
              targetId: input.sessionId,
            }),
          )

          unwrapOrThrow(
            eventStore.append({
              actorAccountId: context.tenantScope.accountId,
              aggregateId: fileId,
              aggregateType: 'file',
              outboxTopics: ['projection', 'realtime'],
              payload: {
                fileId,
                linkType: 'session',
                sessionId: input.sessionId,
                targetId: input.sessionId,
              },
              tenantId: context.tenantScope.tenantId,
              traceId: context.traceId,
              type: 'file.linked',
            }),
          )
        }

        unwrapOrThrow(
          txUploadRepository.complete(context.tenantScope, {
            checksumSha256,
            completedAt: now,
            detectedMimeType: input.file.type || null,
            fileId,
            id: uploadId,
            sizeBytes: body.byteLength,
            stagedStorageKey: stagedStorageKey!,
            updatedAt: now,
          }),
        )

        unwrapOrThrow(
          eventStore.append({
            actorAccountId: context.tenantScope.accountId,
            aggregateId: fileId,
            aggregateType: 'file',
            outboxTopics: ['projection', 'realtime'],
            payload: {
              accessScope: input.accessScope,
              fileId,
              mimeType: createdFile.mimeType,
              sessionId: input.sessionId ?? null,
              uploadId,
            },
            tenantId: context.tenantScope.tenantId,
            traceId: context.traceId,
            type: 'file.uploaded',
          }),
        )

        return createdFile
      })

      return ok({
        file,
        uploadId,
      })
    } catch (error) {
      if (stagedStorageKey) {
        await context.services.files.blobStore.delete(stagedStorageKey)
      }

      if (error instanceof DomainErrorException) {
        markUploadFailed(context, uploadId, error.domainError.message)
        return err(error.domainError)
      }

      const message = error instanceof Error ? error.message : 'Unknown upload failure'
      markUploadFailed(context, uploadId, message)

      return err({
        message: `failed to upload file ${input.file.name}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
