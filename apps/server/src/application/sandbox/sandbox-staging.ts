import { createHash } from 'node:crypto'
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createFileRepository } from '../../adapters/persistence/sqlite/files/file-repository'
import type { BlobStore } from '../../domain/files/blob-store'
import type { SandboxExecutionFileRecord } from '../../domain/sandbox/sandbox-execution-file-repository'
import { createSandboxExecutionFileRepository } from '../../adapters/persistence/sqlite/sandbox/sandbox-execution-file-repository'
import type { SandboxExecutionRecord } from '../../domain/sandbox/sandbox-execution-repository'
import { createSandboxExecutionPackageRepository } from '../../adapters/persistence/sqlite/sandbox/sandbox-package-repository'
import type { PreparedSandboxExecution } from '../../domain/sandbox/sandbox-runner'
import type { SandboxExecutionRequest, SandboxPolicy } from '../../domain/sandbox/types'
import type { DomainError } from '../../shared/errors'
import { asFileId, asSandboxExecutionFileId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { createWorkspaceService } from '../workspaces/workspace-service'

export interface SandboxStagingService {
  prepareExecution: (
    scope: TenantScope,
    execution: SandboxExecutionRecord,
  ) => Promise<
    Result<
      PreparedSandboxExecution & {
        stagedFiles: SandboxExecutionFileRecord[]
      },
      DomainError
    >
  >
}

const toSandboxRequest = (value: unknown): SandboxExecutionRequest =>
  value as SandboxExecutionRequest
const toSandboxPolicy = (value: unknown): SandboxPolicy => value as SandboxPolicy

const sanitizeFilename = (value: string): string =>
  value
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/[^A-Za-z0-9._-]/g, '_') || 'input.bin'

const ensureWithinRoot = (root: string, relativePath: string): Result<string, DomainError> => {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(resolvedRoot, relativePath)

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`)) {
    return err({
      message: `sandbox path ${relativePath} escapes the staging root`,
      type: 'validation',
    })
  }

  return ok(resolvedPath)
}

const toHostSandboxPath = (hostRoot: string, sandboxPath: string): Result<string, DomainError> => {
  const relativePath = sandboxPath.replace(/^\/+/, '')
  return ensureWithinRoot(hostRoot, relativePath)
}

const toVaultHostPath = (vaultRoot: string, vaultPath: string): Result<string, DomainError> => {
  const relativePath = vaultPath.replace(/^\/vault\/?/, '')
  return ensureWithinRoot(vaultRoot, relativePath)
}

const computeSha256 = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex')

const statSize = async (path: string): Promise<number | null> => {
  try {
    return (await stat(path)).size
  } catch {
    return null
  }
}

export const createSandboxStagingService = (input: {
  blobStore: BlobStore
  createId: <TPrefix extends string>(prefix: TPrefix) => `${TPrefix}_${string}`
  db: Parameters<typeof createWorkspaceService>[0]
  fileStorageRoot: string
}): SandboxStagingService => {
  const workspaceService = createWorkspaceService(input.db, {
    createId: input.createId,
    fileStorageRoot: input.fileStorageRoot,
  })

  return {
    prepareExecution: async (scope, execution) => {
      try {
        const fileRepository = createFileRepository(input.db)
        const sandboxFileRepository = createSandboxExecutionFileRepository(input.db)
        const packageRepository = createSandboxExecutionPackageRepository(input.db)
        const request = toSandboxRequest(execution.requestJson)
        const policy = toSandboxPolicy(execution.policySnapshotJson)
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

        const packages = packageRepository.listBySandboxExecutionId(scope, execution.id)

        if (!packages.ok) {
          return packages
        }

        const layout = workspaceService.buildLayout(
          workspace.value,
          execution.sessionId,
          execution.runId,
        )
        const hostRootRef = join(layout.runRef, 'sandboxes', execution.id)
        const inputRootRef = join(hostRootRef, 'input')
        const workRootRef = join(hostRootRef, 'work')
        const outputRootRef = join(hostRootRef, 'output')
        const logsRootRef = join(hostRootRef, 'logs')
        const vaultRootRef = join(hostRootRef, 'vault')
        const stagedFiles: SandboxExecutionFileRecord[] = []

        await rm(hostRootRef, {
          force: true,
          recursive: true,
        })
        await mkdir(inputRootRef, { recursive: true })
        await mkdir(workRootRef, { recursive: true })
        await mkdir(outputRootRef, { recursive: true })
        await mkdir(logsRootRef, { recursive: true })
        await mkdir(vaultRootRef, { recursive: true })

        await writeFile(join(hostRootRef, 'request.json'), JSON.stringify(request, null, 2), 'utf8')
        await writeFile(join(hostRootRef, 'policy.json'), JSON.stringify(policy, null, 2), 'utf8')

        const stageAttachment = async (
          attachment: NonNullable<SandboxExecutionRequest['attachments']>[number],
        ) => {
          const file = fileRepository.getById(scope, asFileId(attachment.fileId))

          if (!file.ok) {
            return file
          }

          const blob = await input.blobStore.get(file.value.storageKey)

          if (!blob.ok) {
            return blob
          }

          const sandboxPath =
            attachment.mountPath ??
            `/input/${sanitizeFilename(file.value.originalFilename ?? file.value.id)}`
          const hostPath = toHostSandboxPath(hostRootRef, sandboxPath)

          if (!hostPath.ok) {
            return hostPath
          }

          await mkdir(dirname(hostPath.value), { recursive: true })
          await writeFile(hostPath.value, blob.value.body)

          const record = sandboxFileRepository.create(scope, {
            checksumSha256: computeSha256(blob.value.body),
            createdAt: execution.createdAt,
            id: asSandboxExecutionFileId(input.createId('sbf')),
            mimeType: file.value.mimeType,
            role: 'attachment_input',
            sandboxExecutionId: execution.id,
            sandboxPath,
            sizeBytes: blob.value.body.byteLength,
            sourceFileId: file.value.id,
          })

          if (!record.ok) {
            return record
          }

          stagedFiles.push(record.value)
          return ok(null)
        }

        const stageVaultEntry = async (inputValue: {
          role: 'vault_input'
          sandboxPath: string
          vaultPath: string
        }): Promise<Result<null, DomainError>> => {
          const sourcePath = toVaultHostPath(layout.vaultRef, inputValue.vaultPath)

          if (!sourcePath.ok) {
            return sourcePath
          }

          const targetPath = toHostSandboxPath(hostRootRef, inputValue.sandboxPath)

          if (!targetPath.ok) {
            return targetPath
          }

          await mkdir(dirname(targetPath.value), { recursive: true })
          await cp(sourcePath.value, targetPath.value, {
            errorOnExist: false,
            force: true,
            recursive: true,
          })

          const record = sandboxFileRepository.create(scope, {
            createdAt: execution.createdAt,
            id: asSandboxExecutionFileId(input.createId('sbf')),
            role: inputValue.role,
            sandboxExecutionId: execution.id,
            sandboxPath: inputValue.sandboxPath,
            sizeBytes: await statSize(targetPath.value),
            sourceVaultPath: inputValue.vaultPath,
          })

          if (!record.ok) {
            return record
          }

          stagedFiles.push(record.value)
          return ok(null)
        }

        for (const attachment of request.attachments ?? []) {
          const staged = await stageAttachment(attachment)

          if (!staged.ok) {
            return staged
          }
        }

        const stagedVaultPaths = new Set<string>()
        const stageVaultPathOnce = async (vaultPath: string, sandboxPath: string) => {
          const key = `${vaultPath}:${sandboxPath}`

          if (stagedVaultPaths.has(key)) {
            return ok(null)
          }

          stagedVaultPaths.add(key)
          return stageVaultEntry({
            role: 'vault_input',
            sandboxPath,
            vaultPath,
          })
        }

        for (const vaultInput of request.vaultInputs ?? []) {
          const staged = await stageVaultPathOnce(
            vaultInput.vaultPath,
            vaultInput.mountPath ?? vaultInput.vaultPath,
          )

          if (!staged.ok) {
            return staged
          }
        }

        if (request.cwdVaultPath) {
          const staged = await stageVaultPathOnce(request.cwdVaultPath, request.cwdVaultPath)

          if (!staged.ok) {
            return staged
          }
        }

        if (request.source.kind === 'workspace_script') {
          const staged = await stageVaultPathOnce(
            request.source.vaultPath,
            request.source.vaultPath,
          )

          if (!staged.ok) {
            return staged
          }
        }

        return ok({
          executionId: execution.id,
          hostRootRef,
          inputRootRef,
          packages: packages.value.map((pkg) => ({
            id: pkg.id,
            installScriptsAllowed: pkg.installScriptsAllowed,
            name: pkg.name,
            registryHost: pkg.registryHost,
            requestedVersion: pkg.requestedVersion,
          })),
          outputRootRef,
          policySnapshotJson: execution.policySnapshotJson,
          requestJson: execution.requestJson,
          runtime: execution.runtime,
          stagedFiles,
          workRootRef,
        })
      } catch (error) {
        return err({
          message: error instanceof Error ? error.message : 'Unknown sandbox staging failure',
          type: 'conflict',
        })
      }
    },
  }
}
