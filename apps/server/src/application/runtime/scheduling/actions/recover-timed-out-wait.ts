import { createInternalCommandContext } from '../../../commands/internal-command-context'
import { resolveRunWait } from '../../waits/run-wait-resolution'
import type { ReadinessDecision } from '../readiness-engine'
import type { ReadinessActionSupport } from './action-support'

export const recoverTimedOutWait = async (
  support: ReadinessActionSupport,
  decision: Extract<ReadinessDecision, { kind: 'recover_timed_out_wait' }>,
): Promise<boolean> =>
  support.withRunTarget({
    execute: async ({ run, scope }) => {
      const timedOut = await resolveRunWait(createInternalCommandContext(support, scope), run.id, {
        error: {
          message: support.waitTimeoutMessage,
          type: 'timeout',
        },
        waitId: decision.waitId,
        waitResolution: {
          resolutionJson: {
            error: support.waitTimeoutMessage,
            timeoutAt: decision.timeoutAt,
          },
          status: 'timed_out',
        },
      })

      if (timedOut.ok) {
        return true
      }

      const runDependency = support.runDependencyRepository.getById(scope, decision.waitId)

      if (runDependency.ok && runDependency.value.status !== 'pending') {
        return true
      }

      support.logger.warn('Failed to recover timed-out wait', {
        message: timedOut.error.message,
        runId: decision.runId,
        tenantId: decision.tenantId,
        waitId: decision.waitId,
      })

      return false
    },
    logScopeFailure: {
      message: 'Failed to resolve timed-out wait recovery scope',
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
