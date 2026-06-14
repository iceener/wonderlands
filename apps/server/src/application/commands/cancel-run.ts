import { z } from 'zod'
import { withTransaction } from '../../db/transaction'
import { createRunDependencyRepository } from '../../domain/runtime/run-dependency-repository'
import { createRunRepository } from '../../domain/runtime/run-repository'
import { createToolExecutionRepository } from '../../domain/runtime/tool-execution-repository'
import { createTenantMembershipRepository } from '../../domain/tenancy/tenant-membership-repository'
import { DomainErrorException } from '../../shared/errors'
import type { RunId } from '../../shared/ids'
import { err, ok } from '../../shared/result'
import { createResourceAccessService } from '../access/resource-access'
import {
  type CancelRunResponseStatus,
  cancelRunSubtree,
  classifyRunForCancelCommand,
  finalizeRunCancellation,
} from '../runtime/persistence/run-cancellation'
import type { CommandContext, CommandResult } from './command-context'
import { createEventStore } from './event-store'

const cancelRunInputSchema = z.object({
  reason: z.string().trim().min(1).max(10_000).optional(),
})

export interface CancelRunOutput {
  runId: RunId
  status: CancelRunResponseStatus
}

export const parseCancelRunInput = (
  input: unknown,
): CommandResult<z.infer<typeof cancelRunInputSchema>> => {
  const parsed = cancelRunInputSchema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export const createCancelRunCommand = () => ({
  execute: (
    context: CommandContext,
    runId: RunId,
    input: z.infer<typeof cancelRunInputSchema>,
  ): CommandResult<CancelRunOutput> => {
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

      if (currentRun.value.run.status === 'cancelling') {
        if (context.services.activeRuns.get(runId)) {
          return ok({
            runId,
            status: 'cancelling',
          })
        }

        const finalized = finalizeRunCancellation(context, {
          cancelledAt: context.services.clock.nowIso(),
          db: context.db,
          reason: input.reason ?? null,
          runId,
        })

        if (!finalized.ok) {
          return finalized
        }

        return ok({
          runId,
          status: 'cancelled',
        })
      }

      const disposition = classifyRunForCancelCommand(runId, currentRun.value.run)

      if (!disposition.ok) {
        return disposition
      }

      if (disposition.value === 'already_cancelling') {
        return ok({
          runId,
          status: 'cancelling',
        })
      }

      const cancelledAt = context.services.clock.nowIso()
      const abortedRunIds = new Set<RunId>()
      const cancelled = withTransaction(context.db, (tx) => {
        const txRunRepository = createRunRepository(tx)
        const txRunDependencyRepository = createRunDependencyRepository(tx)
        const txToolExecutionRepository = createToolExecutionRepository(tx)
        const eventStore = createEventStore(tx)
        const cancelledRun = cancelRunSubtree(
          context,
          {
            abortedRunIds,
            cancelledAt,
            db: tx,
            eventStore,
            reason: input.reason ?? null,
            run: currentRun.value.run,
            runRepository: txRunRepository,
            toolExecutionRepository: txToolExecutionRepository,
            runDependencyRepository: txRunDependencyRepository,
          },
          new Set<RunId>(),
        )

        return ok(cancelledRun)
      })

      if (!cancelled.ok) {
        return cancelled
      }

      for (const abortedRunId of abortedRunIds) {
        context.services.activeRuns.abort(abortedRunId, input.reason ?? 'Run cancelled')
      }

      return ok({
        runId,
        status: cancelled.value.responseStatus,
      })
    } catch (error) {
      if (error instanceof DomainErrorException) {
        return err(error.domainError)
      }

      const message = error instanceof Error ? error.message : 'Unknown cancel run failure'

      return err({
        message: `failed to cancel run ${runId}: ${message}`,
        type: 'conflict',
      })
    }
  },
})
