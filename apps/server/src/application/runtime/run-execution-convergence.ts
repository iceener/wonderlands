import type { RunRecord } from '../../domain/runtime/run-repository'
import type { DomainError } from '../../shared/errors'
import type { RunId } from '../../shared/ids'
import { err, ok } from '../../shared/result'
import type { CommandContext, CommandResult } from '../commands/command-context'
import { createRunDependencyRepository, createRunRepository } from '../persistence/repositories'
import type { RunExecutionOutput } from './persistence/run-persistence'
import { rebuildRunExecutionOutput } from './projection/rebuild-run-execution-output'

const delay = async (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })

export const toRunExecutionTerminalError = (run: RunRecord): DomainError => {
  if (
    run.status === 'failed' &&
    run.errorJson &&
    typeof run.errorJson === 'object' &&
    run.errorJson !== null
  ) {
    const candidate = run.errorJson as {
      message?: unknown
      provider?: unknown
      type?: unknown
    }

    if (typeof candidate.message === 'string') {
      if (candidate.type === 'provider' && typeof candidate.provider === 'string') {
        return {
          message: candidate.message,
          provider: candidate.provider,
          type: 'provider',
        }
      }

      if (
        candidate.type === 'validation' ||
        candidate.type === 'auth' ||
        candidate.type === 'permission' ||
        candidate.type === 'not_found' ||
        candidate.type === 'conflict' ||
        candidate.type === 'capacity' ||
        candidate.type === 'timeout'
      ) {
        return {
          message: candidate.message,
          type: candidate.type,
        }
      }
    }
  }

  if (run.status === 'cancelled') {
    return {
      message: `run ${run.id} was cancelled`,
      type: 'conflict',
    }
  }

  return {
    message: `run ${run.id} ended in unexpected status ${run.status}`,
    type: 'conflict',
  }
}

export const convergeRunExecutionConflict = async (
  context: CommandContext,
  runId: RunId,
  fallbackError: DomainError,
): Promise<CommandResult<RunExecutionOutput>> => {
  const deadline = Date.now() + 250

  while (true) {
    const currentRun = createRunRepository(context.db).getById(context.tenantScope, runId)

    if (!currentRun.ok) {
      return currentRun
    }

    if (currentRun.value.status === 'completed' || currentRun.value.status === 'waiting') {
      const rebuilt = rebuildRunExecutionOutput(context, currentRun.value)

      if (!rebuilt.ok) {
        return rebuilt
      }

      if (rebuilt.value) {
        return ok(rebuilt.value)
      }
    }

    if (currentRun.value.status === 'failed' || currentRun.value.status === 'cancelled') {
      return err(toRunExecutionTerminalError(currentRun.value))
    }

    if (Date.now() > deadline) {
      return err(fallbackError)
    }

    await delay(10)
  }
}

export const waitForRunToReachDurableState = async (
  context: CommandContext,
  runId: RunId,
  fallbackError?: DomainError,
): Promise<CommandResult<RunExecutionOutput>> => {
  const deadline = Date.now() + Math.min(context.config.ai.defaults.timeoutMs, 15_000)

  while (Date.now() <= deadline) {
    const currentRun = createRunRepository(context.db).getById(context.tenantScope, runId)

    if (!currentRun.ok) {
      return currentRun
    }

    if (currentRun.value.status === 'completed') {
      const rebuilt = rebuildRunExecutionOutput(context, currentRun.value)

      if (!rebuilt.ok) {
        return rebuilt
      }

      if (rebuilt.value) {
        return ok(rebuilt.value)
      }
    }

    if (currentRun.value.status === 'waiting') {
      const pendingWaits = createRunDependencyRepository(context.db).listPendingByRunId(
        context.tenantScope,
        runId,
      )

      if (!pendingWaits.ok) {
        return pendingWaits
      }

      if (pendingWaits.value.length > 0) {
        const rebuilt = rebuildRunExecutionOutput(context, currentRun.value)

        if (!rebuilt.ok) {
          return rebuilt
        }

        if (rebuilt.value) {
          return ok(rebuilt.value)
        }
      }
    }

    if (currentRun.value.status === 'failed' || currentRun.value.status === 'cancelled') {
      return err(toRunExecutionTerminalError(currentRun.value))
    }

    const worked = await context.services.multiagent.processOneDecision()

    if (!worked) {
      await delay(100)
    }
  }

  return err(
    fallbackError ?? {
      message: `run ${runId} did not reach a durable execution state in time`,
      type: 'conflict',
    },
  )
}
