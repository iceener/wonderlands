import { createFileRepository } from '../../../adapters/persistence/sqlite/files/file-repository'
import type {
  ChildRunResultEnvelope,
  ChildRunSuspendedWait,
} from '../../../domain/agents/agent-types'
import { createRunDependencyRepository } from '../../../adapters/persistence/sqlite/runtime/run-dependency-repository'
import type { RunRecord } from '../../../domain/runtime/run-repository'
import { createRunRepository } from '../../../adapters/persistence/sqlite/runtime/run-repository'
import { createToolExecutionRepository } from '../../../adapters/persistence/sqlite/runtime/tool-execution-repository'
import { ok } from '../../../shared/result'
import type { CommandContext, CommandResult } from '../../commands/command-context'
import { toToolArgs } from '../tool-execution-persistence'
import { isParentDeliverableChildWait } from './delegated-child-waits'
import { resolveRunWait } from './run-wait-resolution'
import { requiresConfirmationForToolWait } from './tool-confirmation'

const toRunSummary = (run: RunRecord): string | null => {
  if (!run.resultJson || typeof run.resultJson !== 'object') {
    return null
  }

  const candidate = run.resultJson as {
    outputText?: unknown
  }

  return typeof candidate.outputText === 'string' && candidate.outputText.length > 0
    ? candidate.outputText
    : null
}

const loadSuspendedWaitSummaries = (
  context: CommandContext,
  childRun: RunRecord,
): CommandResult<ChildRunSuspendedWait[]> => {
  const runDependencyRepository = createRunDependencyRepository(context.db)
  const toolExecutionRepository = createToolExecutionRepository(context.db)
  const pendingWaits = runDependencyRepository.listPendingByRunId(context.tenantScope, childRun.id)

  if (!pendingWaits.ok) {
    return pendingWaits
  }

  const deliverableWaits = pendingWaits.value.filter(isParentDeliverableChildWait)

  if (deliverableWaits.length === 0) {
    return ok([])
  }

  const waitSummaries: ChildRunSuspendedWait[] = []

  for (const wait of deliverableWaits) {
    const toolExecution = toolExecutionRepository.getById(context.tenantScope, wait.callId)

    if (!toolExecution.ok) {
      return toolExecution
    }

    waitSummaries.push({
      args: toToolArgs(toolExecution.value.argsJson),
      description: wait.description,
      targetKind: wait.targetKind,
      targetRef: wait.targetRef,
      tool: toolExecution.value.tool,
      type: wait.type,
      waitId: wait.id,
      ...(requiresConfirmationForToolWait(wait, toolExecution.value)
        ? { requiresApproval: true }
        : {}),
    })
  }

  return ok(waitSummaries)
}

export const loadChildRunResultEnvelope = (
  context: CommandContext,
  run: RunRecord,
): CommandResult<ChildRunResultEnvelope | null> => {
  switch (run.status) {
    case 'completed': {
      const fileRepository = createFileRepository(context.db)
      const runFiles = fileRepository.listByRunId(context.tenantScope, run.id)
      const generatedFileIds = runFiles.ok
        ? runFiles.value.filter((f) => f.sourceKind === 'generated').map((f) => f.id)
        : []

      return ok({
        childRunId: run.id,
        ...(generatedFileIds.length > 0 ? { generatedFileIds } : {}),
        kind: 'completed',
        result: run.resultJson,
        summary: toRunSummary(run),
      })
    }
    case 'cancelled':
      return ok({
        childRunId: run.id,
        kind: 'cancelled',
        result: run.resultJson,
      })
    case 'failed':
      return ok({
        childRunId: run.id,
        error: run.errorJson ?? {
          message: `child run ${run.id} failed`,
          type: 'conflict',
        },
        kind: 'failed',
      })
    case 'waiting': {
      const suspendedWaits = loadSuspendedWaitSummaries(context, run)

      if (!suspendedWaits.ok) {
        return suspendedWaits
      }

      if (suspendedWaits.value.length === 0) {
        return ok(null)
      }

      const allRequireHumanApproval = suspendedWaits.value.every(
        (wait) => wait.requiresApproval === true,
      )

      if (allRequireHumanApproval) {
        return ok(null)
      }

      return ok({
        childRunId: run.id,
        kind: 'suspended',
        summary: toRunSummary(run) ?? suspendedWaits.value[0]?.description ?? null,
        waits: suspendedWaits.value,
      })
    }
    default:
      return ok(null)
  }
}

export const deliverChildResultToParentWaits = async (
  context: CommandContext,
  childRun: RunRecord,
): Promise<CommandResult<{ deliveredWaitIds: string[] }>> => {
  const runDependencyRepository = createRunDependencyRepository(context.db)
  const runRepository = createRunRepository(context.db)
  const pendingWaits = runDependencyRepository.listPendingAgentByTargetRunId(
    context.tenantScope,
    childRun.id,
  )

  if (!pendingWaits.ok) {
    return pendingWaits
  }

  if (pendingWaits.value.length === 0) {
    return ok({
      deliveredWaitIds: [],
    })
  }

  const envelope = loadChildRunResultEnvelope(context, childRun)

  if (!envelope.ok) {
    return envelope
  }

  if (!envelope.value) {
    return ok({
      deliveredWaitIds: [],
    })
  }

  const deliveredWaitIds: string[] = []

  for (const runDependency of pendingWaits.value) {
    const parentRun = runRepository.getById(context.tenantScope, runDependency.runId)

    if (!parentRun.ok) {
      return parentRun
    }

    if (parentRun.value.status !== 'waiting') {
      continue
    }

    const resolved = await resolveRunWait(context, parentRun.value.id, {
      output: envelope.value,
      waitId: runDependency.id,
    })

    if (!resolved.ok) {
      const currentWait = runDependencyRepository.getById(context.tenantScope, runDependency.id)

      if (currentWait.ok && currentWait.value.status !== 'pending') {
        deliveredWaitIds.push(runDependency.id)
        continue
      }

      return resolved
    }

    deliveredWaitIds.push(runDependency.id)
  }

  return ok({
    deliveredWaitIds,
  })
}
