import { withTransaction } from '../../../../db/transaction'
import { createRunRepository } from '../../../../adapters/persistence/sqlite/runtime/run-repository'
import { ok } from '../../../../shared/result'
import { createEventStore } from '../../../commands/event-store'
import { queueLinkedJob } from '../job-sync'
import type { ReadinessDecision } from '../readiness-engine'
import type { ReadinessActionSupport } from './action-support'

const toRecoveryLogLabel = (
  reason: import('../job-status-reasons').StaleRunRecoveryReason,
): string => (reason === 'process_restarted' ? 'process restart' : 'expired claim')

export const requeueStaleRunningRun = async (
  support: ReadinessActionSupport,
  decision: Extract<ReadinessDecision, { kind: 'requeue_stale_running_run' }>,
): Promise<boolean> =>
  support.withRunTarget({
    execute: async ({ run, scope }) => {
      if (
        decision.recoveryReason === 'claim_expired' &&
        run.staleRecoveryCount >= support.config.multiagent.maxStaleRecoveries
      ) {
        return support.failStaleRunningRun({
          decision,
          run,
          scope,
        })
      }

      const requeuedAt = support.services.clock.nowIso()
      const nextStaleRecoveryCount =
        decision.recoveryReason === 'claim_expired'
          ? run.staleRecoveryCount + 1
          : run.staleRecoveryCount
      const nextSchedulerCheckAt =
        decision.recoveryReason === 'claim_expired'
          ? support.nextStaleRecoveryCheckAt(requeuedAt, nextStaleRecoveryCount)
          : null
      const requeued = withTransaction(support.db, (tx) => {
        const txRunRepository = createRunRepository(tx)
        const eventStore = createEventStore(tx)
        const updatedRun = txRunRepository.markPending(scope, {
          expectedStatus: 'running',
          expectedVersion: run.version,
          lastProgressAt: requeuedAt,
          resultJson: run.resultJson,
          runId: run.id,
          staleRecoveryCount: nextStaleRecoveryCount,
          updatedAt: requeuedAt,
        })

        if (!updatedRun.ok) {
          return updatedRun
        }

        const appended = eventStore.append({
          actorAccountId: scope.accountId,
          aggregateId: run.id,
          aggregateType: 'run',
          outboxTopics: ['projection', 'realtime'],
          payload: {
            reason: decision.recoveryReason,
            recoveredFromStatus: 'running',
            runId: updatedRun.value.id,
            sessionId: updatedRun.value.sessionId,
            status: updatedRun.value.status,
            threadId: updatedRun.value.threadId,
          },
          tenantId: scope.tenantId,
          type: 'run.requeued',
        })

        if (!appended.ok) {
          return appended
        }

        const syncedJob = queueLinkedJob(tx, scope, updatedRun.value, {
          eventContext: {
            eventStore,
          },
          nextSchedulerCheckAt,
          reason: decision.recoveryReason,
          updatedAt: requeuedAt,
        })

        if (!syncedJob.ok) {
          return syncedJob
        }

        return ok(updatedRun.value)
      })

      if (!requeued.ok) {
        support.logger.warn(`Failed to requeue stale running ${decision.runRole} run`, {
          message: requeued.error.message,
          runId: decision.runId,
          tenantId: decision.tenantId,
        })
        return false
      }

      support.logger.warn(
        `Requeued ${decision.runRole} run for recovery after ${toRecoveryLogLabel(decision.recoveryReason)}`,
        {
          lastProgressAt: decision.lastProgressAt,
          ...(nextSchedulerCheckAt ? { nextSchedulerCheckAt } : {}),
          reason: decision.recoveryReason,
          runId: decision.runId,
          staleRecoveryCount: nextStaleRecoveryCount,
          tenantId: decision.tenantId,
        },
      )

      return true
    },
    logScopeFailure: {
      message: `Failed to requeue stale running ${decision.runRole} run`,
      runId: decision.runId,
      tenantId: decision.tenantId,
    },
    target: {
      expectedRunRole: decision.runRole,
      expectedStatuses: ['running'],
      runId: decision.runId,
      sessionId: decision.sessionId,
      tenantId: decision.tenantId,
    },
  })
