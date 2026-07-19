import type { AppConfig } from '../../app/config'
import type { AppServices } from '../../app/runtime'
import type { AppDatabase } from '../../db/client'
import { createJobRepository } from '../persistence/repositories'
import { createRunDependencyRepository } from '../persistence/repositories'
import { createRunRepository } from '../persistence/repositories'
import type { SandboxExecutionRecord } from '../../domain/sandbox/sandbox-execution-repository'
import { createSandboxExecutionRepository } from '../persistence/repositories'
import { createSandboxExecutionPackageRepository } from '../persistence/repositories'
import type { SandboxRunner } from '../../domain/sandbox/sandbox-runner'
import { createSandboxWritebackRepository } from '../persistence/repositories'
import type { DomainError } from '../../shared/errors'
import { asSandboxExecutionPackageId } from '../../shared/ids'
import { ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { isToolAllowedForRun } from '../agents/agent-runtime-policy'
import { createInternalCommandContext } from '../commands/internal-command-context'
import { createPollingWorker } from '../polling-worker'
import { toToolContext } from '../runtime/execution/run-tool-execution'
import { resolveExecutionScopeForSession } from '../runtime/run-execution-scope'
import { resolveRunWait } from '../runtime/waits/run-wait-resolution'
import { createSandboxArtifactService } from './sandbox-artifacts'
import { buildSandboxExecutionOutput } from './sandbox-result'
import { createSandboxStagingService } from './sandbox-staging'

export interface SandboxWorker {
  processQueuedExecutions: () => Promise<number>
  start: () => void
  stop: () => Promise<void>
}

const toApprovedRuntimeNames = (requestJson: unknown): string[] => {
  if (
    typeof requestJson !== 'object' ||
    requestJson === null ||
    !('mcpCodeModeApprovedRuntimeNames' in requestJson)
  ) {
    return []
  }

  const value = (requestJson as { mcpCodeModeApprovedRuntimeNames?: unknown })
    .mcpCodeModeApprovedRuntimeNames

  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

export const createSandboxWorker = (input: {
  config: AppConfig
  db: AppDatabase
  runner: SandboxRunner
  services: AppServices
}): SandboxWorker => {
  const logger = input.services.logger.child({
    subsystem: 'sandbox_worker',
  })
  const executionRepository = createSandboxExecutionRepository(input.db)
  const jobRepository = createJobRepository(input.db)
  const stagingService = createSandboxStagingService({
    blobStore: input.services.files.blobStore,
    createId: input.services.ids.create,
    db: input.db,
    fileStorageRoot: input.config.files.storage.root,
  })
  const artifactService = createSandboxArtifactService({
    blobStore: input.services.files.blobStore,
    createId: input.services.ids.create,
    db: input.db,
    fileStorageRoot: input.config.files.storage.root,
  })
  const pollIntervalMs = Math.max(500, input.config.multiagent.worker.pollIntervalMs)

  const toScope = (
    execution: Pick<SandboxExecutionRecord, 'sessionId' | 'tenantId'>,
  ): Result<TenantScope, DomainError> =>
    resolveExecutionScopeForSession(input.db, {
      sessionId: execution.sessionId,
      tenantId: execution.tenantId,
    })

  const findPendingWaitId = (
    scope: TenantScope,
    execution: SandboxExecutionRecord,
  ): Result<string | null, DomainError> => {
    const dependencies = createRunDependencyRepository(input.db).listPendingByRunId(
      scope,
      execution.runId,
    )

    if (!dependencies.ok) {
      return dependencies
    }

    const wait = dependencies.value.find(
      (entry) =>
        entry.targetKind === 'external' && entry.targetRef === `sandbox_execution:${execution.id}`,
    )

    return ok(wait?.id ?? null)
  }

  const updateSandboxJob = (
    scope: TenantScope,
    execution: SandboxExecutionRecord,
    inputValue: Omit<Parameters<typeof jobRepository.update>[1], 'jobId'>,
  ) => {
    if (!execution.jobId) {
      return ok(null)
    }

    const updated = jobRepository.update(scope, {
      ...inputValue,
      jobId: execution.jobId,
    })

    if (!updated.ok) {
      return updated
    }

    return ok(null)
  }

  const syncPackageFailure = (
    scope: TenantScope,
    execution: SandboxExecutionRecord,
    errorText: string,
  ) => {
    const packageRepository = createSandboxExecutionPackageRepository(input.db)
    const packages = packageRepository.listBySandboxExecutionId(scope, execution.id)

    if (!packages.ok) {
      return packages
    }

    for (const pkg of packages.value) {
      if (pkg.status === 'installed') {
        continue
      }

      const updated = packageRepository.update(scope, {
        errorText,
        id: pkg.id,
        resolvedVersion: pkg.resolvedVersion,
        status: pkg.status === 'blocked' ? 'blocked' : 'failed',
      })

      if (!updated.ok) {
        return updated
      }
    }

    return ok(null)
  }

  const syncPackageResults = (
    scope: TenantScope,
    executionId: SandboxExecutionRecord['id'],
    packageResults: Array<{
      errorText: string | null
      id: string
      resolvedVersion: string | null
      status: 'blocked' | 'failed' | 'installed'
    }>,
  ) => {
    const packageRepository = createSandboxExecutionPackageRepository(input.db)

    for (const packageResult of packageResults) {
      const updated = packageRepository.update(scope, {
        errorText: packageResult.errorText,
        id: asSandboxExecutionPackageId(packageResult.id),
        resolvedVersion: packageResult.resolvedVersion,
        status: packageResult.status,
      })

      if (!updated.ok) {
        logger.warn('Failed to persist sandbox package result', {
          executionId,
          message: updated.error.message,
          packageId: packageResult.id,
        })
      }
    }
  }

  const markExecutionFailed = async (inputValue: {
    completedAt: string
    errorMessage: string
    execution: SandboxExecutionRecord
    scope: TenantScope
  }): Promise<void> => {
    const packageFailureSync = syncPackageFailure(
      inputValue.scope,
      inputValue.execution,
      inputValue.errorMessage,
    )

    if (!packageFailureSync.ok) {
      logger.warn('Failed to mark sandbox packages as failed', {
        executionId: inputValue.execution.id,
        message: packageFailureSync.error.message,
        tenantId: inputValue.execution.tenantId,
      })
    }

    executionRepository.update(inputValue.scope, {
      completedAt: inputValue.completedAt,
      errorText: inputValue.errorMessage,
      id: inputValue.execution.id,
      status: 'failed',
    })

    updateSandboxJob(inputValue.scope, inputValue.execution, {
      completedAt: inputValue.completedAt,
      resultJson: {
        error: inputValue.errorMessage,
      },
      status: 'blocked',
      statusReasonJson: {
        error: inputValue.errorMessage,
        kind: 'sandbox_failed',
      },
      updatedAt: inputValue.completedAt,
    })

    const resolved = await resolveExecutionWait({
      errorMessage: inputValue.errorMessage,
      execution: inputValue.execution,
      scope: inputValue.scope,
    })

    if (!resolved.ok) {
      logger.warn('Failed to resolve sandbox wait after failure', {
        executionId: inputValue.execution.id,
        message: resolved.error.message,
        tenantId: inputValue.execution.tenantId,
      })
    }
  }

  const resolveExecutionWait = async (inputValue: {
    errorMessage?: string
    output?: unknown
    scope: TenantScope
    execution: SandboxExecutionRecord
  }) => {
    const waitId = findPendingWaitId(inputValue.scope, inputValue.execution)

    if (!waitId.ok) {
      return waitId
    }

    if (!waitId.value) {
      return ok(null)
    }

    return await resolveRunWait(
      createInternalCommandContext(
        {
          config: input.config,
          db: input.db,
          services: input.services,
        },
        inputValue.scope,
      ),
      inputValue.execution.runId,
      {
        ...(inputValue.errorMessage ? { errorMessage: inputValue.errorMessage } : {}),
        ...(inputValue.output !== undefined ? { output: inputValue.output } : {}),
        waitId: waitId.value,
      },
    )
  }

  const processExecution = async (
    scope: TenantScope,
    execution: SandboxExecutionRecord,
  ): Promise<boolean> => {
    const startedAt = input.services.clock.nowIso()
    const runningJob = updateSandboxJob(scope, execution, {
      lastHeartbeatAt: startedAt,
      queuedAt: null,
      status: 'running',
      updatedAt: startedAt,
    })

    if (!runningJob.ok) {
      logger.warn('Failed to mark sandbox job as running', {
        executionId: execution.id,
        message: runningJob.error.message,
        tenantId: execution.tenantId,
      })
    }

    const staged = await stagingService.prepareExecution(scope, execution)

    if (!staged.ok) {
      const failedAt = input.services.clock.nowIso()
      await markExecutionFailed({
        completedAt: failedAt,
        errorMessage: staged.error.message,
        execution,
        scope,
      })
      return true
    }

    const run = createRunRepository(input.db).getById(scope, execution.runId)

    if (!run.ok) {
      const failedAt = input.services.clock.nowIso()
      await markExecutionFailed({
        completedAt: failedAt,
        errorMessage: run.error.message,
        execution,
        scope,
      })
      return true
    }

    const internalCommandContext = createInternalCommandContext(
      {
        config: input.config,
        db: input.db,
        services: input.services,
      },
      scope,
    )
    const stagedExecution = {
      ...staged.value,
      mcpDispatcher: async (dispatcherInput: { args: unknown; runtimeName: string }) => {
        const mcpCodeModeApprovedRuntimeNames = toApprovedRuntimeNames(execution.requestJson)
        const tool = input.services.tools.get(dispatcherInput.runtimeName)

        if (!tool || tool.domain !== 'mcp') {
          return {
            error: {
              message: `MCP tool ${dispatcherInput.runtimeName} is not available`,
              type: 'not_found' as const,
            },
            ok: false as const,
          }
        }

        if (!isToolAllowedForRun(input.db, scope, run.value, tool)) {
          return {
            error: {
              message: `MCP tool ${dispatcherInput.runtimeName} is not allowed for this run`,
              type: 'permission' as const,
            },
            ok: false as const,
          }
        }

        const validated = tool.validateArgs
          ? tool.validateArgs(dispatcherInput.args ?? {})
          : ok(dispatcherInput.args ?? {})

        if (!validated.ok) {
          return validated
        }

        const outcome = await tool.execute(
          {
            ...toToolContext(internalCommandContext, run.value, input.services.ids.create('tcl')),
            ...(mcpCodeModeApprovedRuntimeNames.length > 0
              ? { mcpCodeModeApprovedRuntimeNames }
              : {}),
          },
          validated.value,
        )

        if (!outcome.ok) {
          return outcome
        }

        if (outcome.value.kind !== 'immediate') {
          return {
            error: {
              message: `MCP tool ${dispatcherInput.runtimeName} requires confirmation and cannot resume inside execute script mode yet`,
              type: 'conflict' as const,
            },
            ok: false as const,
          }
        }

        return ok(outcome.value.output)
      },
    }

    const executed = await input.runner.runExecution(stagedExecution)
    const completedAt = input.services.clock.nowIso()

    if (!executed.ok) {
      await markExecutionFailed({
        completedAt,
        errorMessage: executed.error.message,
        execution,
        scope,
      })
      return true
    }

    const persisted = executionRepository.update(scope, {
      completedAt: executed.value.completedAt,
      durationMs: executed.value.durationMs,
      errorText: executed.value.errorText,
      externalSandboxId: executed.value.externalSandboxId,
      id: execution.id,
      startedAt: executed.value.startedAt,
      status: executed.value.status,
      stderrText: executed.value.stderrText,
      stdoutText: executed.value.stdoutText,
    })

    if (!persisted.ok) {
      logger.error('Failed to persist sandbox execution result', {
        executionId: execution.id,
        message: persisted.error.message,
        tenantId: execution.tenantId,
      })
      return false
    }

    syncPackageResults(scope, persisted.value.id, executed.value.packages)

    const promotedOutputs =
      executed.value.status === 'completed'
        ? await artifactService.promoteExecutionOutputs(scope, persisted.value)
        : ok([])

    if (!promotedOutputs.ok) {
      await markExecutionFailed({
        completedAt,
        errorMessage: promotedOutputs.error.message,
        execution: persisted.value,
        scope,
      })
      return true
    }

    const writebacks = createSandboxWritebackRepository(input.db).listBySandboxExecutionId(
      scope,
      persisted.value.id,
    )

    if (!writebacks.ok) {
      await markExecutionFailed({
        completedAt,
        errorMessage: writebacks.error.message,
        execution: persisted.value,
        scope,
      })
      return true
    }

    const output = buildSandboxExecutionOutput({
      durationMs: executed.value.durationMs,
      effectiveNetworkMode: executed.value.networkMode,
      execution,
      failure: executed.value.failure,
      packages: executed.value.packages.map((pkg) => ({
        errorText: pkg.errorText,
        id: pkg.id,
        name: pkg.name,
        requestedVersion: pkg.requestedVersion,
        resolvedVersion: pkg.resolvedVersion,
        status: pkg.status,
      })),
      files: promotedOutputs.value.map((artifact) => ({
        fileId: artifact.file.id,
        mimeType: artifact.file.mimeType,
        originalFilename: artifact.file.originalFilename,
        sandboxPath: artifact.sandboxPath,
        sizeBytes: artifact.file.sizeBytes,
      })),
      stagedFiles: staged.value.stagedFiles,
      status: executed.value.status,
      stderr: executed.value.stderrText,
      stdout: executed.value.stdoutText,
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
    })

    const syncedJob = updateSandboxJob(scope, execution, {
      completedAt: executed.value.completedAt,
      resultJson: output,
      status: executed.value.status === 'completed' ? 'completed' : 'blocked',
      statusReasonJson:
        executed.value.status === 'completed'
          ? {
              kind: 'sandbox_completed',
            }
          : {
              error: executed.value.errorText,
              kind: 'sandbox_failed',
            },
      updatedAt: executed.value.completedAt,
    })

    if (!syncedJob.ok) {
      logger.warn('Failed to update sandbox job terminal state', {
        executionId: execution.id,
        message: syncedJob.error.message,
        tenantId: execution.tenantId,
      })
    }

    const resolved = await resolveExecutionWait({
      execution: persisted.value,
      output,
      scope,
    })

    if (!resolved.ok) {
      logger.warn('Failed to resolve sandbox wait after completion', {
        executionId: execution.id,
        message: resolved.error.message,
        tenantId: execution.tenantId,
      })
    }

    return true
  }

  const processQueuedExecutions = async (): Promise<number> => {
    const queued = executionRepository.listQueuedGlobal(10)

    if (!queued.ok) {
      throw new Error(queued.error.message)
    }

    let processedCount = 0

    for (const candidate of queued.value) {
      const scope = toScope(candidate)

      if (!scope.ok) {
        logger.warn('Skipping sandbox execution because execution scope could not be resolved', {
          executionId: candidate.id,
          message: scope.error.message,
          tenantId: candidate.tenantId,
        })
        continue
      }

      const claimed = executionRepository.claimQueued(scope.value, {
        id: candidate.id,
        startedAt: input.services.clock.nowIso(),
      })

      if (!claimed.ok) {
        continue
      }

      try {
        if (await processExecution(scope.value, claimed.value)) {
          processedCount += 1
        }
      } catch (error) {
        await markExecutionFailed({
          completedAt: input.services.clock.nowIso(),
          errorMessage:
            error instanceof Error ? error.message : 'Unknown sandbox execution failure',
          execution: claimed.value,
          scope: scope.value,
        })
        logger.error('Unhandled sandbox execution failure', {
          executionId: claimed.value.id,
          message: error instanceof Error ? error.message : 'Unknown sandbox execution failure',
          tenantId: claimed.value.tenantId,
        })
      }
    }

    return processedCount
  }

  const lifecycle = createPollingWorker<number>({
    computeNextDelay: ({ result }) => (result && result > 0 ? 0 : pollIntervalMs),
    onError: (error) => {
      logger.error('Unhandled sandbox worker failure', {
        message: error instanceof Error ? error.message : 'Unknown sandbox worker failure',
      })
    },
    runOnce: processQueuedExecutions,
  })

  return {
    processQueuedExecutions,
    start: lifecycle.start,
    stop: lifecycle.stop,
  }
}
