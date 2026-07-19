import { createRunDependencyRepository } from '../../../adapters/persistence/sqlite/runtime/run-dependency-repository'
import type { RunRecord } from '../../../domain/runtime/run-repository'
import type { RunId } from '../../../shared/ids'
import { err, ok } from '../../../shared/result'
import { createResourceAccessService } from '../../access/resource-access'
import type { CancelRunOutput, createCancelRunCommand } from '../../commands/cancel-run'
import type { CommandContext, CommandResult } from '../../commands/command-context'
import type { createExecuteRunCommand, ExecuteRunInput } from '../../commands/execute-run'
import type { createResumeRunCommand, RuntimeResumeRunInput } from '../../commands/resume-run'
import { rebuildRunExecutionOutput } from '../projection/rebuild-run-execution-output'
import { toRunExecutionTerminalError } from '../run-execution-convergence'
import { classifyRunForCancelRecovery } from './run-cancellation'
import type { ResumeRunOutput, RunExecutionOutput } from './run-persistence'

const delay = async (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })

const toRecoveryDeadline = (context: CommandContext): number =>
  Date.now() + Math.min(context.config.ai.defaults.timeoutMs, 15_000)

const readAuthorizedRun = (context: CommandContext, runId: RunId): CommandResult<RunRecord> => {
  const authorized = createResourceAccessService(context.db).requireRunAccess(
    context.tenantScope,
    runId,
  )

  if (!authorized.ok) {
    return authorized
  }

  return ok(authorized.value.run)
}

const rebuildDurableRunOutput = (
  context: CommandContext,
  run: RunRecord,
): CommandResult<RunExecutionOutput> => {
  const rebuilt = rebuildRunExecutionOutput(context, run)

  if (!rebuilt.ok) {
    return rebuilt
  }

  if (!rebuilt.value) {
    return err({
      message: `run ${run.id} could not be rebuilt from durable state`,
      type: 'conflict',
    })
  }

  return ok(rebuilt.value)
}

const pollRecovery = async <TValue>(
  context: CommandContext,
  evaluate: () => Promise<CommandResult<TValue | null>> | CommandResult<TValue | null>,
): Promise<CommandResult<TValue | null>> => {
  const deadline = toRecoveryDeadline(context)

  while (Date.now() <= deadline) {
    const evaluated = await evaluate()

    if (!evaluated.ok) {
      return evaluated
    }

    if (evaluated.value !== null) {
      return evaluated
    }

    await delay(100)
  }

  return ok(null)
}

export const toRunTerminalError = toRunExecutionTerminalError

export const recoverExecuteRunOutput = async (input: {
  command: ReturnType<typeof createExecuteRunCommand>
  context: CommandContext
  executeInput: ExecuteRunInput
  runId: RunId
}): Promise<CommandResult<RunExecutionOutput | null>> =>
  pollRecovery(input.context, async () => {
    const currentRun = readAuthorizedRun(input.context, input.runId)

    if (!currentRun.ok) {
      return currentRun
    }

    switch (currentRun.value.status) {
      case 'pending': {
        const executed = await input.command.execute(
          input.context,
          currentRun.value.id,
          input.executeInput,
        )

        if (executed.ok) {
          return executed
        }

        if (executed.error.type !== 'conflict') {
          return executed
        }

        return ok(null)
      }
      case 'running':
      case 'cancelling':
        return ok(null)
      case 'waiting':
      case 'completed':
        return rebuildDurableRunOutput(input.context, currentRun.value)
      case 'failed':
      case 'cancelled':
        return err(toRunTerminalError(currentRun.value))
    }
  })

export const recoverResumeRunOutput = async (input: {
  command: ReturnType<typeof createResumeRunCommand>
  context: CommandContext
  resumeInput: RuntimeResumeRunInput
  runId: RunId
}): Promise<CommandResult<ResumeRunOutput | null>> => {
  const runDependencyRepository = createRunDependencyRepository(input.context.db)
  const toAcceptedResumeOutput = (): ResumeRunOutput => ({
    runId: input.runId,
    status: 'accepted',
  })

  return pollRecovery(input.context, async () => {
    const currentRun = readAuthorizedRun(input.context, input.runId)

    if (!currentRun.ok) {
      return currentRun
    }

    switch (currentRun.value.status) {
      case 'waiting': {
        const runDependency = runDependencyRepository.getById(
          input.context.tenantScope,
          input.resumeInput.waitId,
        )

        if (!runDependency.ok) {
          return runDependency
        }

        if (runDependency.value.runId !== input.runId) {
          return err({
            message: `wait ${input.resumeInput.waitId} does not belong to run ${input.runId}`,
            type: 'conflict',
          })
        }

        if (runDependency.value.status === 'pending') {
          const resumed = await input.command.execute(
            input.context,
            currentRun.value.id,
            input.resumeInput,
          )

          if (resumed.ok) {
            return resumed
          }

          if (resumed.error.type !== 'conflict') {
            return resumed
          }

          return ok(null)
        }

        const rebuilt = rebuildDurableRunOutput(input.context, currentRun.value)

        if (!rebuilt.ok) {
          return rebuilt
        }

        if (
          rebuilt.value.status === 'completed' ||
          !rebuilt.value.waitIds.includes(input.resumeInput.waitId)
        ) {
          return rebuilt
        }

        return ok(toAcceptedResumeOutput())
      }
      case 'running':
      case 'cancelling':
        return ok(toAcceptedResumeOutput())
      case 'completed':
        return rebuildDurableRunOutput(input.context, currentRun.value)
      case 'failed':
      case 'cancelled':
        return err(toRunTerminalError(currentRun.value))
      case 'pending':
        return err({
          message: `run ${input.runId} is still pending and cannot be resumed yet`,
          type: 'conflict',
        })
    }
  })
}

export const recoverCancelRunOutput = async (input: {
  cancelInput: {
    reason?: string
  }
  command: ReturnType<typeof createCancelRunCommand>
  context: CommandContext
  runId: RunId
}): Promise<CommandResult<CancelRunOutput | null>> =>
  pollRecovery(input.context, () => {
    const currentRun = readAuthorizedRun(input.context, input.runId)

    if (!currentRun.ok) {
      return currentRun
    }

    const disposition = classifyRunForCancelRecovery(currentRun.value)

    if (!disposition.ok) {
      return disposition
    }

    switch (disposition.value) {
      case 'already_cancelled':
        return ok({
          runId: currentRun.value.id,
          status: 'cancelled',
        })
      case 'already_cancelling':
        return ok({
          runId: currentRun.value.id,
          status: 'cancelling',
        })
      case 'execute': {
        const cancelled = input.command.execute(
          input.context,
          currentRun.value.id,
          input.cancelInput,
        )

        if (cancelled.ok) {
          return cancelled
        }

        if (cancelled.error.type !== 'conflict') {
          return cancelled
        }

        return ok(null)
      }
    }
  })
