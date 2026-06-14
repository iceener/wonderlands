import type { AppDatabase } from '../../db/client'
import { createFileRepository, type FileRecord } from '../../domain/files/file-repository'
import { createJobRepository } from '../../domain/runtime/job-repository'
import {
  createSandboxExecutionFileRepository,
  type SandboxExecutionFileRecord,
} from '../../domain/sandbox/sandbox-execution-file-repository'
import {
  createSandboxExecutionRepository,
  type SandboxExecutionRecord,
} from '../../domain/sandbox/sandbox-execution-repository'
import { createSandboxExecutionPackageRepository } from '../../domain/sandbox/sandbox-package-repository'
import {
  createSandboxWritebackRepository,
  type SandboxWritebackOperationRecord,
} from '../../domain/sandbox/sandbox-writeback-repository'
import type { DomainError } from '../../shared/errors'
import type { SandboxExecutionId } from '../../shared/ids'
import { ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import {
  buildSandboxExecutionOutput,
  coerceSandboxFailure,
  type SandboxExecutionResultOutput,
} from './sandbox-result'

export interface SandboxExecutionSummaryFile {
  fileId: FileRecord['id']
  mimeType: string | null
  originalFilename: string | null
  sandboxPath: string
  sizeBytes: number | null
}

export interface SandboxExecutionSummaryWriteback {
  appliedAt: string | null
  approvedAt: string | null
  errorText: string | null
  id: SandboxWritebackOperationRecord['id']
  operation: SandboxWritebackOperationRecord['operation']
  requiresApproval: boolean
  sourceSandboxPath?: string
  status: SandboxWritebackOperationRecord['status']
  targetVaultPath: string
}

export type SandboxExecutionSummary = SandboxExecutionResultOutput

export interface SandboxReadModelService {
  getExecutionSummary: (
    scope: TenantScope,
    sandboxExecutionId: SandboxExecutionId,
  ) => Result<SandboxExecutionSummary, DomainError>
}

const sortFiles = (
  files: Array<{
    file: FileRecord
    sandboxFile: SandboxExecutionFileRecord
  }>,
): Array<{
  file: FileRecord
  sandboxFile: SandboxExecutionFileRecord
}> =>
  [...files].sort((left, right) =>
    left.sandboxFile.sandboxPath.localeCompare(right.sandboxFile.sandboxPath),
  )

const readEffectiveNetworkMode = (value: unknown): SandboxExecutionRecord['networkMode'] | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const candidate = (value as { effectiveNetworkMode?: unknown }).effectiveNetworkMode

  return candidate === 'off' || candidate === 'allow_list' || candidate === 'open'
    ? candidate
    : null
}

export const createSandboxReadModelService = (db: AppDatabase): SandboxReadModelService => ({
  getExecutionSummary: (scope, sandboxExecutionId) => {
    const executionRepository = createSandboxExecutionRepository(db)
    const sandboxFileRepository = createSandboxExecutionFileRepository(db)
    const packageRepository = createSandboxExecutionPackageRepository(db)
    const writebackRepository = createSandboxWritebackRepository(db)
    const jobRepository = createJobRepository(db)
    const fileRepository = createFileRepository(db)
    const execution = executionRepository.getById(scope, sandboxExecutionId)

    if (!execution.ok) {
      return execution
    }

    const sandboxFiles = sandboxFileRepository.listBySandboxExecutionId(scope, sandboxExecutionId)

    if (!sandboxFiles.ok) {
      return sandboxFiles
    }

    const generatedOutputFiles = sandboxFiles.value.filter(
      (file) => file.role === 'generated_output' && file.createdFileId,
    )
    const durableFiles = fileRepository.listByIds(
      scope,
      generatedOutputFiles.flatMap((file) => (file.createdFileId ? [file.createdFileId] : [])),
    )

    if (!durableFiles.ok) {
      return durableFiles
    }

    const durableFilesById = new Map(durableFiles.value.map((file) => [file.id, file]))
    const files = sortFiles(
      generatedOutputFiles.flatMap((sandboxFile) => {
        const file = sandboxFile.createdFileId
          ? durableFilesById.get(sandboxFile.createdFileId)
          : null

        return file ? [{ file, sandboxFile }] : []
      }),
    ).map(({ file, sandboxFile }) => ({
      fileId: file.id,
      mimeType: file.mimeType,
      originalFilename: file.originalFilename,
      sandboxPath: sandboxFile.sandboxPath,
      sizeBytes: file.sizeBytes,
    }))

    const writebacks = writebackRepository.listBySandboxExecutionId(scope, sandboxExecutionId)

    if (!writebacks.ok) {
      return writebacks
    }

    const packages = packageRepository.listBySandboxExecutionId(scope, sandboxExecutionId)

    if (!packages.ok) {
      return packages
    }

    const jobResult =
      execution.value.jobId != null ? jobRepository.getById(scope, execution.value.jobId) : ok(null)

    if (!jobResult.ok) {
      return jobResult
    }

    const persistedFailure =
      jobResult.value?.resultJson &&
      typeof jobResult.value.resultJson === 'object' &&
      !Array.isArray(jobResult.value.resultJson)
        ? coerceSandboxFailure((jobResult.value.resultJson as { failure?: unknown }).failure)
        : null
    const persistedEffectiveNetworkMode = readEffectiveNetworkMode(jobResult.value?.resultJson)

    return ok(
      buildSandboxExecutionOutput({
        durationMs: execution.value.durationMs,
        effectiveNetworkMode: persistedEffectiveNetworkMode ?? execution.value.networkMode,
        execution: execution.value,
        failure: persistedFailure,
        files,
        packages: packages.value.map((pkg) => ({
          errorText: pkg.errorText,
          id: pkg.id,
          name: pkg.name,
          requestedVersion: pkg.requestedVersion,
          resolvedVersion: pkg.resolvedVersion,
          status: pkg.status,
        })),
        stagedFiles: sandboxFiles.value,
        status: execution.value.status,
        stderr: execution.value.stderrText,
        stdout: execution.value.stdoutText,
        writebacks: writebacks.value.map((operation) => ({
          appliedAt: operation.appliedAt,
          approvedAt: operation.approvedAt,
          errorText: operation.errorText,
          id: operation.id,
          operation: operation.operation,
          requiresApproval: operation.requiresApproval,
          ...(operation.operation === 'delete'
            ? {}
            : { sourceSandboxPath: operation.sourceSandboxPath }),
          status: operation.status,
          targetVaultPath: operation.targetVaultPath,
        })),
      }),
    )
  },
})
