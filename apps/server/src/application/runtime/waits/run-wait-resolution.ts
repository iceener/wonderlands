import { createTenantMembershipRepository } from '../../../adapters/persistence/sqlite/tenancy/tenant-membership-repository'
import { withTransaction } from '../../../db/transaction'
import { createRunDependencyRepository } from '../../../adapters/persistence/sqlite/runtime/run-dependency-repository'
import { createRunRepository } from '../../../adapters/persistence/sqlite/runtime/run-repository'
import { createToolExecutionRepository } from '../../../adapters/persistence/sqlite/runtime/tool-execution-repository'
import { DomainErrorException } from '../../../shared/errors'
import type { RunId } from '../../../shared/ids'
import { err } from '../../../shared/result'
import { createResourceAccessService } from '../../access/resource-access'
import type { CommandContext, CommandResult } from '../../commands/command-context'
import { resolveExecuteMcpConfirmationWait } from './handlers/resolve-execute-mcp-confirmation-wait'
import { resolveExecuteSandboxDeleteConfirmationWait } from './handlers/resolve-execute-sandbox-delete-confirmation-wait'
import { resolveMcpConfirmationWait } from './handlers/resolve-mcp-confirmation-wait'
import { resolveSandboxWritebackWait } from './handlers/resolve-sandbox-writeback-wait'
import { resolveToolResultWait } from './handlers/resolve-tool-result-wait'
import {
  type RunWaitResolutionInput,
  type RunWaitResolutionState,
  requiresApprovalForWait,
  toConfigSnapshot,
} from './handlers/wait-resolution-support'
import {
  isExecuteMcpConfirmationWait,
  isExecuteSandboxDeleteConfirmationWait,
  isSandboxWritebackConfirmationWait,
} from './tool-confirmation'

export type {
  RunWaitResolutionInput,
  RunWaitResolutionState,
} from './handlers/wait-resolution-support'

export const resolveRunWait = async (
  context: CommandContext,
  runId: RunId,
  input: RunWaitResolutionInput,
): Promise<CommandResult<RunWaitResolutionState>> => {
  try {
    const membershipRepository = createTenantMembershipRepository(context.db)
    const membership = membershipRepository.requireMembership(context.tenantScope)

    if (!membership.ok) {
      return membership
    }

    const currentRun = createResourceAccessService(context.db).requireRunAccess(
      context.tenantScope,
      runId,
    )

    if (!currentRun.ok) {
      return currentRun
    }

    let currentRunRecord = currentRun.value.run

    if (currentRunRecord.status !== 'waiting') {
      return err({
        message: `run ${runId} must be waiting before resuming`,
        type: 'conflict',
      })
    }

    if (
      input.maxOutputTokens !== undefined ||
      input.model !== undefined ||
      input.modelAlias !== undefined ||
      input.provider !== undefined ||
      input.temperature !== undefined
    ) {
      const configuredRun = withTransaction(context.db, (tx) =>
        createRunRepository(tx).updateConfigSnapshot(context.tenantScope, {
          configSnapshot: toConfigSnapshot(context, input, currentRunRecord.configSnapshot),
          expectedStatus: 'waiting',
          expectedVersion: currentRunRecord.version,
          runId,
          updatedAt: context.services.clock.nowIso(),
        }),
      )

      if (!configuredRun.ok) {
        return configuredRun
      }

      currentRunRecord = configuredRun.value
    }

    const runDependencyRepository = createRunDependencyRepository(context.db)
    const runDependency = runDependencyRepository.getById(context.tenantScope, input.waitId)

    if (!runDependency.ok) {
      return runDependency
    }

    if (runDependency.value.runId !== runId) {
      return err({
        message: `wait ${input.waitId} does not belong to run ${runId}`,
        type: 'conflict',
      })
    }

    if (runDependency.value.status !== 'pending') {
      return err({
        message: `wait ${input.waitId} is not pending`,
        type: 'conflict',
      })
    }

    const resolvedAt = context.services.clock.nowIso()
    const toolExecutionRepository = createToolExecutionRepository(context.db)
    const toolExecution = toolExecutionRepository.getById(
      context.tenantScope,
      runDependency.value.callId,
    )

    if (!toolExecution.ok) {
      return toolExecution
    }

    const loaded = {
      context,
      currentRun: currentRunRecord,
      input,
      resolvedAt,
      runDependency: runDependency.value,
      runId,
      toolExecution: toolExecution.value,
    }

    if (requiresApprovalForWait(runDependency.value, toolExecution.value)) {
      if (input.approve === undefined) {
        return err({
          message: `wait ${input.waitId} requires an explicit approve decision`,
          type: 'validation',
        })
      }

      if (isSandboxWritebackConfirmationWait(runDependency.value, toolExecution.value)) {
        return resolveSandboxWritebackWait(loaded)
      }

      if (isExecuteSandboxDeleteConfirmationWait(runDependency.value, toolExecution.value)) {
        return resolveExecuteSandboxDeleteConfirmationWait(loaded)
      }

      if (isExecuteMcpConfirmationWait(runDependency.value, toolExecution.value)) {
        return resolveExecuteMcpConfirmationWait(loaded)
      }

      return resolveMcpConfirmationWait(loaded)
    }

    return resolveToolResultWait(loaded)
  } catch (error) {
    if (error instanceof DomainErrorException) {
      return err(error.domainError)
    }

    const message = error instanceof Error ? error.message : 'Unknown run wait resolution failure'

    return err({
      message: `failed to resolve wait for run ${runId}: ${message}`,
      type: 'conflict',
    })
  }
}
