import type { AppDatabase } from '../../db/client'
import { withTransaction } from '../../db/transaction'
import { createJobRepository, type JobRecord } from '../../domain/runtime/job-repository'
import {
  createSandboxExecutionRepository,
  type SandboxExecutionRecord,
} from '../../domain/sandbox/sandbox-execution-repository'
import {
  createSandboxExecutionPackageRepository,
  type SandboxExecutionPackageRecord,
} from '../../domain/sandbox/sandbox-package-repository'
import {
  createSandboxWritebackRepository,
  type SandboxWritebackOperationRecord,
} from '../../domain/sandbox/sandbox-writeback-repository'
import type { SandboxPolicy, SandboxProvider, SandboxRuntime } from '../../domain/sandbox/types'
import type { DomainError } from '../../shared/errors'
import type {
  AgentId,
  AgentRevisionId,
  JobId,
  RunId,
  SandboxExecutionId,
  SandboxExecutionPackageId,
  SandboxWritebackOperationId,
  SessionThreadId,
  WorkSessionId,
  WorkspaceId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type {
  NormalizedSandboxExecutionRequest,
  NormalizedSandboxRequestedPackage,
  NormalizedSandboxWritebackRequest,
} from './sandbox-policy'

export interface QueueSandboxExecutionInput {
  assignedAgentId?: AgentId | null
  assignedAgentRevisionId?: AgentRevisionId | null
  createdAt: string
  executionId: SandboxExecutionId
  jobId: JobId
  parentJobId?: JobId | null
  policySnapshot: SandboxPolicy
  request: NormalizedSandboxExecutionRequest
  requestedPackages?: Array<
    NormalizedSandboxRequestedPackage & {
      id: SandboxExecutionPackageId
    }
  >
  rootJobId?: JobId | null
  runId: RunId
  sessionId: WorkSessionId
  threadId?: SessionThreadId | null
  title: string
  toolExecutionId?: string | null
  vaultAccessMode: SandboxExecutionRecord['vaultAccessMode']
  writebacks?: Array<
    NormalizedSandboxWritebackRequest & {
      id: SandboxWritebackOperationId
    }
  >
  workspaceId?: WorkspaceId | null
  workspaceRef?: string | null
}

export interface QueuedSandboxExecution {
  execution: SandboxExecutionRecord
  job: JobRecord
  packages: SandboxExecutionPackageRecord[]
  writebacks: SandboxWritebackOperationRecord[]
}

export interface SandboxExecutionService {
  provider: SandboxProvider
  supportedRuntimes: SandboxRuntime[]
  queueExecution: (
    scope: TenantScope,
    input: QueueSandboxExecutionInput,
  ) => Result<QueuedSandboxExecution, DomainError>
}

export interface CreateSandboxExecutionServiceDependencies {
  db: AppDatabase
  provider: SandboxProvider
  supportedRuntimes: SandboxRuntime[]
}

const toJsonRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>
const deleteWritebackSourceSandboxPath = '/__delete__'

export const createSandboxExecutionService = (
  dependencies: CreateSandboxExecutionServiceDependencies,
): SandboxExecutionService => {
  return {
    provider: dependencies.provider,
    supportedRuntimes: [...dependencies.supportedRuntimes],
    queueExecution: (scope, input) =>
      withTransaction(dependencies.db, (tx) => {
        if (!dependencies.supportedRuntimes.includes(input.request.runtime)) {
          return err({
            message: `sandbox runtime ${input.request.runtime} is not supported by provider ${dependencies.provider}`,
            type: 'conflict',
          })
        }

        const jobRepository = createJobRepository(tx)
        const executionRepository = createSandboxExecutionRepository(tx)
        const packageRepository = createSandboxExecutionPackageRepository(tx)
        const writebackRepository = createSandboxWritebackRepository(tx)

        const job = jobRepository.create(scope, {
          assignedAgentId: input.assignedAgentId ?? null,
          assignedAgentRevisionId: input.assignedAgentRevisionId ?? null,
          createdAt: input.createdAt,
          currentRunId: input.runId,
          id: input.jobId,
          inputJson: input.request,
          kind: 'sandbox',
          parentJobId: input.parentJobId ?? null,
          priority: 100,
          queuedAt: input.createdAt,
          rootJobId: input.rootJobId ?? input.jobId,
          sessionId: input.sessionId,
          status: 'queued',
          threadId: input.threadId ?? null,
          title: input.title,
          updatedAt: input.createdAt,
        })

        if (!job.ok) {
          return job
        }

        const execution = executionRepository.create(scope, {
          createdAt: input.createdAt,
          id: input.executionId,
          jobId: input.jobId,
          networkMode: input.request.network?.mode ?? 'off',
          policySnapshotJson: toJsonRecord(input.policySnapshot),
          provider: dependencies.provider,
          queuedAt: input.createdAt,
          requestJson: toJsonRecord(input.request),
          runId: input.runId,
          runtime: input.request.runtime,
          sessionId: input.sessionId,
          status: 'queued',
          threadId: input.threadId ?? null,
          toolExecutionId: input.toolExecutionId ?? null,
          vaultAccessMode: input.vaultAccessMode,
          workspaceId: input.workspaceId ?? null,
          workspaceRef: input.workspaceRef ?? null,
        })

        if (!execution.ok) {
          return execution
        }

        const packages: SandboxExecutionPackageRecord[] = []

        for (const requestedPackage of input.requestedPackages ?? []) {
          const packageRecord = packageRepository.create(scope, {
            createdAt: input.createdAt,
            id: requestedPackage.id,
            installScriptsAllowed: requestedPackage.installScriptsAllowed,
            name: requestedPackage.name,
            registryHost: requestedPackage.registryHost,
            requestedVersion: requestedPackage.version,
            sandboxExecutionId: input.executionId,
            status: 'requested',
          })

          if (!packageRecord.ok) {
            return packageRecord
          }

          packages.push(packageRecord.value)
        }

        const writebacks: SandboxWritebackOperationRecord[] = []

        for (const writeback of input.writebacks ?? []) {
          const writebackRecord = writebackRepository.create(scope, {
            createdAt: input.createdAt,
            id: writeback.id,
            operation: writeback.mode,
            requiresApproval: writeback.requiresApproval,
            sandboxExecutionId: input.executionId,
            sourceSandboxPath:
              writeback.mode === 'delete' ? deleteWritebackSourceSandboxPath : writeback.fromPath,
            status: writeback.requiresApproval ? 'pending' : 'approved',
            targetVaultPath: writeback.toVaultPath,
          })

          if (!writebackRecord.ok) {
            return writebackRecord
          }

          writebacks.push(writebackRecord.value)
        }

        return ok({
          execution: execution.value,
          job: job.value,
          packages,
          writebacks,
        })
      }),
  }
}
