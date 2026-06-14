import { withTransaction } from '../../../../db/transaction'
import { ok } from '../../../../shared/result'
import { createEventStore } from '../../../commands/event-store'
import { queueLinkedJob } from '../job-sync'
import type { ReadinessDecision } from '../readiness-engine'
import type { ReadinessActionSupport } from './action-support'

export const requeueWaitingJob = async (
  support: ReadinessActionSupport,
  decision: Extract<ReadinessDecision, { kind: 'requeue_waiting_job' }>,
): Promise<boolean> =>
  support.withRunTarget({
    execute: async ({ run, scope }) => {
      const pendingWaits = support.listPendingWaitsForRun(scope, run.id)

      if (!pendingWaits.ok || pendingWaits.value.length > 0) {
        return false
      }

      const reopenedAt = support.services.clock.nowIso()
      const reopened = withTransaction(support.db, (tx) => {
        const eventStore = createEventStore(tx)
        const syncedJob = queueLinkedJob(tx, scope, run, {
          eventContext: {
            eventStore,
          },
          reason: 'dependencies_satisfied',
          updatedAt: reopenedAt,
        })

        if (!syncedJob.ok) {
          return syncedJob
        }

        return ok(null)
      })

      if (!reopened.ok) {
        support.logger.warn('Failed to requeue waiting job', {
          message: reopened.error.message,
          runId: decision.runId,
          tenantId: decision.tenantId,
        })
        return false
      }

      return true
    },
    logScopeFailure: {
      message: 'Failed to resolve waiting job requeue scope',
      runId: decision.runId,
      tenantId: decision.tenantId,
    },
    target: {
      expectedStatuses: ['waiting'],
      runId: decision.runId,
      sessionId: decision.sessionId,
      tenantId: decision.tenantId,
    },
  })
