import { z } from 'zod'
import { withTransaction } from '../../db/transaction'
import { createRunRepository } from '../../domain/runtime/run-repository'
import { createTenantMembershipRepository } from '../../domain/tenancy/tenant-membership-repository'
import { DomainErrorException } from '../../shared/errors'
import type { RunId } from '../../shared/ids'
import { err, ok } from '../../shared/result'
import { createResourceAccessService } from '../access/resource-access'
import type { RunExecutionOutput } from '../runtime/execution/drive-run'
import { waitForRunToReachDurableState } from '../runtime/run-execution-convergence'
import { queueLinkedJob } from '../runtime/scheduling/job-sync'
import type { CommandContext, CommandResult } from './command-context'
import { unwrapCommandResultOrThrow } from './command-result'

const executeRunInputSchema = z.object({
  maxOutputTokens: z.number().int().positive().max(100_000).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  modelAlias: z.string().trim().min(1).max(200).optional(),
  provider: z.enum(['openai', 'google', 'openrouter']).optional(),
  reasoning: z
    .object({
      effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
      summary: z.enum(['auto', 'concise', 'detailed']).optional(),
    })
    .optional(),
  temperature: z.number().min(0).max(2).optional(),
})

export type ExecuteRunInput = z.infer<typeof executeRunInputSchema>
export type ExecuteRunOutput = RunExecutionOutput

const resolveConfigSnapshotReasoning = (
  input: ExecuteRunInput,
  currentSnapshot: Record<string, unknown>,
): Record<string, unknown> | null => {
  if (input.reasoning !== undefined) {
    return input.reasoning
  }

  if (input.model !== undefined || input.modelAlias !== undefined || input.provider !== undefined) {
    return null
  }

  return (currentSnapshot.reasoning as Record<string, unknown> | null | undefined) ?? null
}

const toConfigSnapshot = (
  context: CommandContext,
  input: ExecuteRunInput,
  currentSnapshot: Record<string, unknown>,
): Record<string, unknown> => ({
  ...currentSnapshot,
  apiBasePath: context.config.api.basePath,
  maxOutputTokens: input.maxOutputTokens ?? currentSnapshot.maxOutputTokens ?? null,
  model: input.model ?? currentSnapshot.model ?? null,
  modelAlias: input.modelAlias ?? currentSnapshot.modelAlias ?? null,
  provider: input.provider ?? currentSnapshot.provider ?? context.config.ai.defaults.provider,
  reasoning: resolveConfigSnapshotReasoning(input, currentSnapshot),
  temperature: input.temperature ?? currentSnapshot.temperature ?? null,
  version: context.config.api.version,
})

export const parseExecuteRunInput = (input: unknown): CommandResult<ExecuteRunInput> => {
  const parsed = executeRunInputSchema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export const createExecuteRunCommand = () => ({
  execute: async (
    context: CommandContext,
    runId: RunId,
    input: ExecuteRunInput,
  ): Promise<CommandResult<ExecuteRunOutput>> => {
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

      if (currentRun.value.run.status !== 'pending') {
        return err({
          message: `run ${runId} must be pending before execution`,
          type: 'conflict',
        })
      }

      if (!currentRun.value.run.threadId && currentRun.value.run.parentRunId === null) {
        return err({
          message: `run ${runId} is missing a thread binding`,
          type: 'conflict',
        })
      }

      const preparedAt = context.services.clock.nowIso()
      const preparedRun = withTransaction(context.db, (tx) => {
        const txRunRepository = createRunRepository(tx)
        const updatedRun = unwrapCommandResultOrThrow(
          txRunRepository.updateConfigSnapshot(context.tenantScope, {
            configSnapshot: toConfigSnapshot(context, input, currentRun.value.run.configSnapshot),
            expectedStatus: 'pending',
            expectedVersion: currentRun.value.run.version,
            runId,
            updatedAt: preparedAt,
          }),
        )

        unwrapCommandResultOrThrow(
          queueLinkedJob(tx, context.tenantScope, updatedRun, {
            reason: 'manual.execute',
            updatedAt: preparedAt,
          }),
        )

        return ok(updatedRun)
      })

      if (!preparedRun.ok) {
        return preparedRun
      }

      return waitForRunToReachDurableState(context, preparedRun.value.id, {
        message: `run ${runId} did not start executing after being queued`,
        type: 'conflict',
      })
    } catch (error) {
      if (error instanceof DomainErrorException) {
        return err(error.domainError)
      }

      const message = error instanceof Error ? error.message : 'Unknown execute run failure'

      return err({
        message: `failed to execute run ${runId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
