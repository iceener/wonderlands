import type { ToolContext } from '../../application/tooling/tool-registry'
import { createRunDependencyRepository } from '../../adapters/persistence/sqlite/runtime/run-dependency-repository'
import { createRunRepository } from '../../adapters/persistence/sqlite/runtime/run-repository'
import { createToolExecutionRepository } from '../../adapters/persistence/sqlite/runtime/tool-execution-repository'
import type { DomainError } from '../../shared/errors'
import type { RunId } from '../../shared/ids'
import { asRunId } from '../../shared/ids'
import { err, type Result } from '../../shared/result'
import { type RunWaitResolutionState, resolveRunWait } from '../runtime/waits/run-wait-resolution'
import { requiresConfirmationForToolWait } from '../runtime/waits/tool-confirmation'

export interface ResumeDelegatedRunInput {
  approve?: boolean
  childRunId: string
  errorMessage?: string
  output?: unknown
  rememberApproval?: boolean
  waitId: string
}

export interface ResumeDelegatedRunResult {
  childRunId: RunId
  childTask: string
  waitState: RunWaitResolutionState
}

const toCommandContext = (context: ToolContext) => ({
  config: context.config,
  db: context.db,
  requestId: context.requestId,
  services: context.services,
  tenantScope: context.tenantScope,
  traceId: context.traceId,
})

export const resumeDelegatedRun = async (
  context: ToolContext,
  input: ResumeDelegatedRunInput,
): Promise<Result<ResumeDelegatedRunResult, DomainError>> => {
  const childRunId = asRunId(input.childRunId)
  const childRun = createRunRepository(context.db).getById(context.tenantScope, childRunId)

  if (!childRun.ok) {
    return childRun
  }

  if (childRun.value.parentRunId !== context.run.id) {
    return err({
      message: `run ${input.childRunId} is not a delegated child of run ${context.run.id}`,
      type: 'permission',
    })
  }

  const runDependency = createRunDependencyRepository(context.db).getById(
    context.tenantScope,
    input.waitId,
  )

  if (!runDependency.ok) {
    return runDependency
  }

  if (runDependency.value.runId !== childRunId) {
    return err({
      message: `wait ${input.waitId} does not belong to delegated child run ${input.childRunId}`,
      type: 'conflict',
    })
  }

  if (input.approve !== undefined) {
    const toolExecution = createToolExecutionRepository(context.db).getById(
      context.tenantScope,
      runDependency.value.callId,
    )
    if (
      toolExecution.ok &&
      requiresConfirmationForToolWait(runDependency.value, toolExecution.value)
    ) {
      return err({
        message: `wait ${input.waitId} requires human confirmation and cannot be resolved by an agent`,
        type: 'permission',
      })
    }
  }

  if (runDependency.value.status === 'resolved') {
    return {
      ok: true,
      value: {
        childRunId,
        childTask: childRun.value.task,
        waitState: {
          kind: 'ready_to_resume',
        },
      },
    }
  }

  if (childRun.value.status !== 'waiting') {
    return err({
      message: `delegated child run ${input.childRunId} is not waiting`,
      type: 'conflict',
    })
  }

  const resolved = await resolveRunWait(toCommandContext(context), childRunId, {
    ...(input.approve !== undefined ? { approve: input.approve } : {}),
    ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
    output: input.output,
    ...(input.rememberApproval !== undefined ? { rememberApproval: input.rememberApproval } : {}),
    waitId: input.waitId,
  })

  if (!resolved.ok) {
    return resolved
  }

  return {
    ok: true,
    value: {
      childRunId,
      childTask: childRun.value.task,
      waitState: resolved.value,
    },
  }
}
