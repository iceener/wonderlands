import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { createSandboxExecutionRepository } from '../../domain/sandbox/sandbox-execution-repository'
import {
  createSandboxWritebackRepository,
  type SandboxWritebackOperationRecord,
} from '../../domain/sandbox/sandbox-writeback-repository'
import type { DomainError } from '../../shared/errors'
import type { SandboxExecutionId, SandboxWritebackOperationId } from '../../shared/ids'
import { ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { createWorkspaceService } from '../workspaces/workspace-service'

export interface SandboxWritebackCommitResult {
  applied: SandboxWritebackOperationRecord[]
  executionId: SandboxExecutionId
  skipped: Array<{
    id: SandboxWritebackOperationId
    reason: string
  }>
  writebacks: SandboxWritebackOperationRecord[]
}

export interface SandboxWritebackService {
  commitApprovedWritebacks: (
    scope: TenantScope,
    input: {
      committedAt: string
      operationIds?: SandboxWritebackOperationId[]
      sandboxExecutionId: SandboxExecutionId
    },
  ) => Promise<Result<SandboxWritebackCommitResult, DomainError>>
}

const ensureWithinRoot = (root: string, relativePath: string): string => {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(resolvedRoot, relativePath)

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`)) {
    throw new Error(`path ${relativePath} escapes the expected root`)
  }

  return resolvedPath
}

const toSandboxHostPath = (hostRoot: string, sandboxPath: string): string =>
  ensureWithinRoot(hostRoot, sandboxPath.replace(/^\/+/, ''))

const toVaultHostPath = (vaultRoot: string, vaultPath: string): string =>
  ensureWithinRoot(vaultRoot, vaultPath.replace(/^\/vault\/?/, ''))

export const createSandboxWritebackService = (input: {
  createId: <TPrefix extends string>(prefix: TPrefix) => `${TPrefix}_${string}`
  db: Parameters<typeof createWorkspaceService>[0]
  fileStorageRoot: string
}): SandboxWritebackService => {
  const workspaceService = createWorkspaceService(input.db, {
    createId: input.createId,
    fileStorageRoot: input.fileStorageRoot,
  })

  return {
    commitApprovedWritebacks: async (scope, request) => {
      try {
        const executionRepository = createSandboxExecutionRepository(input.db)
        const writebackRepository = createSandboxWritebackRepository(input.db)
        const execution = executionRepository.getById(scope, request.sandboxExecutionId)

        if (!execution.ok) {
          return execution
        }

        if (execution.value.status !== 'completed') {
          return {
            error: {
              message: `sandbox execution ${request.sandboxExecutionId} must be completed before write-back`,
              type: 'conflict',
            },
            ok: false,
          }
        }

        const workspace = execution.value.workspaceId
          ? workspaceService.requireWritableWorkspace(scope, {
              nowIso: execution.value.completedAt ?? execution.value.createdAt,
              workspaceId: execution.value.workspaceId,
            })
          : workspaceService.ensureAccountWorkspace(scope, {
              nowIso: execution.value.completedAt ?? execution.value.createdAt,
            })

        if (!workspace.ok) {
          return workspace
        }

        const layout = workspaceService.buildLayout(
          workspace.value,
          execution.value.sessionId,
          execution.value.runId,
        )
        const hostRootRef = join(layout.runRef, 'sandboxes', execution.value.id)
        const writebacks = writebackRepository.listBySandboxExecutionId(scope, execution.value.id)

        if (!writebacks.ok) {
          return writebacks
        }

        const selectedIds = request.operationIds ? new Set(request.operationIds) : null
        const applicable = writebacks.value.filter((operation) =>
          selectedIds ? selectedIds.has(operation.id) : true,
        )
        const applied: SandboxWritebackOperationRecord[] = []
        const skipped: SandboxWritebackCommitResult['skipped'] = []

        for (const operation of applicable) {
          if (operation.status === 'applied') {
            skipped.push({
              id: operation.id,
              reason: 'already_applied',
            })
            continue
          }

          if (operation.status !== 'approved') {
            skipped.push({
              id: operation.id,
              reason: `status_${operation.status}`,
            })
            continue
          }

          try {
            const targetPath = toVaultHostPath(layout.vaultRef, operation.targetVaultPath)
            if (operation.operation === 'delete') {
              await rm(targetPath, {
                force: true,
                recursive: true,
              })
            } else {
              const sourcePath = toSandboxHostPath(hostRootRef, operation.sourceSandboxPath)
              const sourceStat = await stat(sourcePath)

              await mkdir(dirname(targetPath), { recursive: true })

              if (operation.operation === 'move') {
                await cp(sourcePath, targetPath, {
                  force: true,
                  recursive: true,
                })
                await rm(sourcePath, {
                  force: true,
                  recursive: sourceStat.isDirectory(),
                })
              } else {
                await cp(sourcePath, targetPath, {
                  force: true,
                  recursive: sourceStat.isDirectory(),
                })
              }
            }

            const updated = writebackRepository.update(scope, {
              appliedAt: request.committedAt,
              errorText: null,
              id: operation.id,
              status: 'applied',
            })

            if (!updated.ok) {
              return updated
            }

            applied.push(updated.value)
          } catch (error) {
            const updated = writebackRepository.update(scope, {
              errorText: error instanceof Error ? error.message : 'Unknown write-back failure',
              id: operation.id,
              status: 'failed',
            })

            if (!updated.ok) {
              return updated
            }

            skipped.push({
              id: operation.id,
              reason: updated.value.errorText ?? 'failed',
            })
          }
        }

        const currentWritebacks = writebackRepository.listBySandboxExecutionId(
          scope,
          execution.value.id,
        )

        if (!currentWritebacks.ok) {
          return currentWritebacks
        }

        return ok({
          applied,
          executionId: execution.value.id,
          skipped,
          writebacks: currentWritebacks.value,
        })
      } catch (error) {
        return {
          error: {
            message: error instanceof Error ? error.message : 'Unknown sandbox write-back failure',
            type: 'conflict',
          },
          ok: false,
        }
      }
    },
  }
}
