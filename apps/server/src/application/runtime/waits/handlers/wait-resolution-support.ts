import { toChildRunReplayOutput } from '../../../../domain/agents/agent-types'
import type { AiProviderName } from '../../../../domain/ai/types'
import type { RunDependencyRecord, RunDependencyStatus } from '../../../../domain/runtime/run-dependency-repository'
import { createRunDependencyRepository } from '../../../../adapters/persistence/sqlite/runtime/run-dependency-repository'
import type { RunRecord } from '../../../../domain/runtime/run-repository'
import type { ToolExecutionRecord } from '../../../../domain/runtime/tool-execution-repository'
import { createToolExecutionRepository } from '../../../../adapters/persistence/sqlite/runtime/tool-execution-repository'
import { type DomainError, DomainErrorException } from '../../../../shared/errors'
import type { RunId } from '../../../../shared/ids'
import { ok, type Result } from '../../../../shared/result'
import type { CommandContext, CommandResult } from '../../../commands/command-context'
import {
  refreshWaitingRunSnapshot,
  type WaitingRunExecutionOutput,
  type WaitingRunPendingWait,
} from '../../persistence/run-persistence'
import {
  toToolErrorOutput as toSharedToolErrorOutput,
  toToolArgs,
} from '../../tool-execution-persistence'
import { requiresConfirmationForToolWait } from '../tool-confirmation'

export type WaitResolutionStatus = Extract<RunDependencyStatus, 'resolved' | 'timed_out'>

export interface RunWaitResolutionInput {
  approve?: boolean
  error?: DomainError
  errorMessage?: string
  maxOutputTokens?: number
  model?: string
  modelAlias?: string
  output?: unknown
  provider?: AiProviderName
  rememberApproval?: boolean
  temperature?: number
  waitId: string
  waitResolution?: {
    resolutionJson?: unknown
    status?: WaitResolutionStatus
  }
}

export type RunWaitResolutionState =
  | {
      kind: 'ready_to_resume'
    }
  | {
      kind: 'waiting'
      output: WaitingRunExecutionOutput
    }

export interface LoadedWaitResolution {
  context: CommandContext
  currentRun: RunRecord
  input: RunWaitResolutionInput
  resolvedAt: string
  runDependency: RunDependencyRecord
  runId: RunId
  toolExecution: ToolExecutionRecord
}

export const unwrapOrThrow = <TValue>(result: Result<TValue, DomainError>): TValue => {
  if (!result.ok) {
    throw new DomainErrorException(result.error)
  }

  return result.value
}

const toConflictError = (message: string): DomainError => ({
  message,
  type: 'conflict',
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const toToolFailure = (
  input: Pick<RunWaitResolutionInput, 'error' | 'errorMessage'>,
): DomainError | null =>
  input.error ?? (input.errorMessage ? toConflictError(input.errorMessage) : null)

export const toPersistedWaitOutput = (
  runDependency: Pick<RunDependencyRecord, 'targetKind' | 'type'>,
  output: unknown,
): unknown => {
  if (runDependency.type === 'agent' && runDependency.targetKind === 'run') {
    return toChildRunReplayOutput(output) ?? output
  }

  return output
}

const toSandboxFailureSummary = (details: unknown): string | null => {
  if (!isRecord(details) || typeof details.sandboxExecutionId !== 'string') {
    return null
  }

  const failure = details.failure

  if (!isRecord(failure) || typeof failure.summary !== 'string' || failure.summary.length === 0) {
    return null
  }

  return failure.summary
}

const toDetailedToolErrorMessage = (error: string | DomainError, details: unknown): string => {
  const sandboxFailureSummary = toSandboxFailureSummary(details)

  if (sandboxFailureSummary) {
    return sandboxFailureSummary
  }

  return typeof error === 'string' ? error : error.message
}

export const toToolErrorOutput = (error: string | DomainError, details?: unknown) =>
  toSharedToolErrorOutput(error, {
    ...(details !== undefined ? { details } : {}),
    message: toDetailedToolErrorMessage(error, details),
  })

export const toConfigSnapshot = (
  context: CommandContext,
  input: Pick<
    RunWaitResolutionInput,
    'maxOutputTokens' | 'model' | 'modelAlias' | 'provider' | 'temperature'
  >,
  currentSnapshot: Record<string, unknown>,
): Record<string, unknown> => ({
  ...currentSnapshot,
  apiBasePath: context.config.api.basePath,
  maxOutputTokens: input.maxOutputTokens ?? currentSnapshot.maxOutputTokens ?? null,
  model: input.model ?? currentSnapshot.model ?? null,
  modelAlias: input.modelAlias ?? currentSnapshot.modelAlias ?? null,
  provider: input.provider ?? currentSnapshot.provider ?? context.config.ai.defaults.provider,
  temperature: input.temperature ?? currentSnapshot.temperature ?? null,
  version: context.config.api.version,
})

export const requiresApprovalForWait = (
  wait: RunDependencyRecord,
  toolExecution: Pick<ToolExecutionRecord, 'domain' | 'tool'>,
): boolean => requiresConfirmationForToolWait(wait, toolExecution)

const toPendingWaitSummary = (
  wait: RunDependencyRecord,
  toolExecution: ToolExecutionRecord,
): WaitingRunPendingWait => ({
  args: toToolArgs(toolExecution.argsJson),
  callId: wait.callId,
  createdAt: wait.createdAt,
  description: wait.description,
  requiresApproval: requiresApprovalForWait(wait, toolExecution),
  targetKind: wait.targetKind,
  targetRef: wait.targetRef,
  tool: toolExecution.tool,
  type: wait.type,
  waitId: wait.id,
})

const loadPendingWaitSummaries = (
  context: CommandContext,
  waits: RunDependencyRecord[],
): CommandResult<WaitingRunPendingWait[]> => {
  const toolExecutionRepository = createToolExecutionRepository(context.db)
  const summaries: WaitingRunPendingWait[] = []

  for (const wait of waits) {
    const toolExecution = toolExecutionRepository.getById(context.tenantScope, wait.callId)

    if (!toolExecution.ok) {
      return toolExecution
    }

    summaries.push(toPendingWaitSummary(wait, toolExecution.value))
  }

  return ok(summaries)
}

export const resumeOrStayWaiting = async (
  context: CommandContext,
  currentRun: RunRecord,
  runId: RunId,
): Promise<CommandResult<RunWaitResolutionState>> => {
  const runDependencyRepository = createRunDependencyRepository(context.db)
  const pendingWaits = runDependencyRepository.listPendingByRunId(context.tenantScope, runId)

  if (!pendingWaits.ok) {
    return pendingWaits
  }

  if (pendingWaits.value.length > 0) {
    const pendingWaitSummaries = loadPendingWaitSummaries(context, pendingWaits.value)

    if (!pendingWaitSummaries.ok) {
      return pendingWaitSummaries
    }

    const refreshedSnapshot = refreshWaitingRunSnapshot(
      context,
      currentRun,
      pendingWaitSummaries.value,
      pendingWaitSummaries.value.map((wait) => wait.waitId),
    )

    if (!refreshedSnapshot.ok) {
      return refreshedSnapshot
    }

    return ok({
      kind: 'waiting',
      output: refreshedSnapshot.value,
    })
  }

  return ok({
    kind: 'ready_to_resume',
  })
}
