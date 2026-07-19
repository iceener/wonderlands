import { withTransaction } from '../../../../db/transaction'
import { createItemRepository } from '../../../persistence/repositories'
import { createRunDependencyRepository } from '../../../persistence/repositories'
import { createToolExecutionRepository } from '../../../persistence/repositories'
import { createSandboxWritebackRepository } from '../../../persistence/repositories'
import {
  asItemId,
  asSandboxExecutionId,
  asSandboxWritebackOperationId,
} from '../../../../shared/ids'
import { ok } from '../../../../shared/result'
import type { CommandResult } from '../../../commands/command-context'
import { createEventStore } from '../../../commands/event-store'
import { toCommitSandboxWritebackOutput } from '../../../sandbox/register-sandbox-native-tools'
import { validateCommitSandboxWritebackArgs } from '../../../sandbox/sandbox-policy'
import { getToolAppsMetaPayload } from '../../tool-apps-meta'
import {
  appendToolCompletedEvent,
  appendToolConfirmationGrantedEvent,
  appendToolConfirmationRejectedEvent,
  appendToolFailedEvent,
  persistCompletedToolExecutionWithOutput,
  persistFailedToolExecutionWithOutput,
} from '../../tool-execution-persistence'
import {
  type LoadedWaitResolution,
  type RunWaitResolutionState,
  resumeOrStayWaiting,
  toToolErrorOutput,
  unwrapOrThrow,
} from './wait-resolution-support'

export const resolveSandboxWritebackWait = async (
  loaded: LoadedWaitResolution,
): Promise<CommandResult<RunWaitResolutionState>> => {
  const { context, currentRun, input, resolvedAt, runDependency, runId, toolExecution } = loaded
  const parsedArgs = validateCommitSandboxWritebackArgs(toolExecution.argsJson ?? {})

  if (!parsedArgs.ok) {
    return parsedArgs
  }

  const sandboxExecutionId = asSandboxExecutionId(parsedArgs.value.sandboxExecutionId)
  const selectedIds = parsedArgs.value.operations
    ? new Set(parsedArgs.value.operations.map(asSandboxWritebackOperationId))
    : null
  const currentWritebacks = createSandboxWritebackRepository(context.db).listBySandboxExecutionId(
    context.tenantScope,
    sandboxExecutionId,
  )

  if (!currentWritebacks.ok) {
    return currentWritebacks
  }

  const applicableWritebacks = currentWritebacks.value.filter((operation) =>
    selectedIds ? selectedIds.has(operation.id) : true,
  )
  const pendingApprovalWritebacks = applicableWritebacks.filter(
    (operation) => operation.requiresApproval && operation.status === 'pending',
  )

  if (!input.approve) {
    if (pendingApprovalWritebacks.length > 0) {
      const reviewed = context.services.sandbox.review.reviewWritebacks(context.tenantScope, {
        decisions: pendingApprovalWritebacks.map((operation) => ({
          decision: 'reject' as const,
          id: operation.id,
        })),
        reviewedAt: resolvedAt,
        sandboxExecutionId,
      })

      if (!reviewed.ok) {
        return reviewed
      }
    }

    const rejectionMessage = 'Sandbox write-back rejected during confirmation'
    const rejected = withTransaction(context.db, (tx) => {
      const txItemRepository = createItemRepository(tx)
      const txToolExecutionRepository = createToolExecutionRepository(tx)
      const txRunDependencyRepository = createRunDependencyRepository(tx)
      const eventStore = createEventStore(tx)
      const nextSequence = unwrapOrThrow(
        txItemRepository.getNextSequence(context.tenantScope, runId),
      )
      const errorEnvelope = toToolErrorOutput(rejectionMessage)

      persistFailedToolExecutionWithOutput({
        callId: runDependency.callId,
        completedAt: resolvedAt,
        durationMs: null,
        errorText: rejectionMessage,
        itemId: asItemId(context.services.ids.create('itm')),
        itemRepository: txItemRepository,
        output: errorEnvelope,
        runId,
        scope: context.tenantScope,
        sequence: nextSequence,
        tool: toolExecution.tool,
        toolExecutionRepository: txToolExecutionRepository,
      })

      unwrapOrThrow(
        txRunDependencyRepository.resolve(context.tenantScope, {
          id: input.waitId,
          resolutionJson: {
            approved: false,
            error: rejectionMessage,
          },
          resolvedAt,
          status: 'resolved',
        }),
      )

      appendToolConfirmationRejectedEvent(context, eventStore, currentRun, {
        callId: runDependency.callId,
        tool: toolExecution.tool,
        waitId: input.waitId,
      })

      appendToolFailedEvent(context, eventStore, currentRun, {
        callId: runDependency.callId,
        error: errorEnvelope,
        tool: toolExecution.tool,
      })

      return ok(null)
    })

    if (!rejected.ok) {
      return rejected
    }

    return resumeOrStayWaiting(context, currentRun, runId)
  }

  if (pendingApprovalWritebacks.length > 0) {
    const reviewed = context.services.sandbox.review.reviewWritebacks(context.tenantScope, {
      decisions: pendingApprovalWritebacks.map((operation) => ({
        decision: 'approve' as const,
        id: operation.id,
      })),
      reviewedAt: resolvedAt,
      sandboxExecutionId,
    })

    if (!reviewed.ok) {
      return reviewed
    }
  }

  const committed = await context.services.sandbox.writeback.commitApprovedWritebacks(
    context.tenantScope,
    {
      committedAt: resolvedAt,
      operationIds: parsedArgs.value.operations?.map(asSandboxWritebackOperationId),
      sandboxExecutionId,
    },
  )

  if (!committed.ok) {
    return committed
  }

  const approvalResolution = {
    approved: true,
  }
  const persistedCommit = withTransaction(context.db, (tx) => {
    const txItemRepository = createItemRepository(tx)
    const txToolExecutionRepository = createToolExecutionRepository(tx)
    const txRunDependencyRepository = createRunDependencyRepository(tx)
    const eventStore = createEventStore(tx)
    const completedAt = context.services.clock.nowIso()
    const output = toCommitSandboxWritebackOutput({
      applied: committed.value.applied,
      executionId: committed.value.executionId,
      skipped: committed.value.skipped,
    })
    const toolAppsMetaPayload = getToolAppsMetaPayload(context, toolExecution.tool, output)
    const nextSequence = unwrapOrThrow(txItemRepository.getNextSequence(context.tenantScope, runId))

    persistCompletedToolExecutionWithOutput({
      callId: runDependency.callId,
      completedAt,
      durationMs: null,
      itemId: asItemId(context.services.ids.create('itm')),
      itemRepository: txItemRepository,
      output,
      runId,
      scope: context.tenantScope,
      sequence: nextSequence,
      tool: toolExecution.tool,
      toolExecutionRepository: txToolExecutionRepository,
    })

    appendToolConfirmationGrantedEvent(context, eventStore, currentRun, {
      callId: runDependency.callId,
      tool: toolExecution.tool,
      waitId: input.waitId,
    })

    unwrapOrThrow(
      txRunDependencyRepository.resolve(context.tenantScope, {
        id: input.waitId,
        resolutionJson: approvalResolution,
        resolvedAt: completedAt,
        status: 'resolved',
      }),
    )

    appendToolCompletedEvent(context, eventStore, currentRun, {
      ...(toolAppsMetaPayload ? { appsMeta: toolAppsMetaPayload } : {}),
      callId: runDependency.callId,
      outcome: output,
      tool: toolExecution.tool,
    })

    return ok(null)
  })

  if (!persistedCommit.ok) {
    return persistedCommit
  }

  return resumeOrStayWaiting(context, currentRun, runId)
}
