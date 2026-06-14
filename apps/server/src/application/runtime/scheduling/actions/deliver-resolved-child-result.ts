import { createInternalCommandContext } from '../../../commands/internal-command-context'
import { deliverChildResultToParentWaits } from '../../waits/child-run-delivery'
import type { ReadinessDecision } from '../readiness-engine'
import type { ReadinessActionSupport } from './action-support'

export const deliverResolvedChildResult = async (
  support: ReadinessActionSupport,
  decision: Extract<ReadinessDecision, { kind: 'deliver_resolved_child_result' }>,
): Promise<boolean> =>
  support.withRunTarget({
    execute: async ({ run, scope }) => {
      const delivered = await deliverChildResultToParentWaits(
        createInternalCommandContext(support, scope),
        run,
      )

      if (!delivered.ok) {
        support.logger.warn('Failed to deliver child run update to parent wait', {
          childRunId: decision.childRunId,
          message: delivered.error.message,
          tenantId: decision.tenantId,
        })
        return false
      }

      return delivered.value.deliveredWaitIds.length > 0
    },
    logLoadFailure: {
      message: 'Failed to load child run for parent update delivery',
      runId: decision.childRunId,
      runIdField: 'childRunId',
      tenantId: decision.tenantId,
    },
    logScopeFailure: {
      message: 'Failed to resolve child run update delivery scope',
      runId: decision.childRunId,
      runIdField: 'childRunId',
      tenantId: decision.tenantId,
    },
    target: {
      expectedRunRole: 'child',
      expectedStatuses: ['completed', 'failed', 'cancelled', 'waiting'],
      runId: decision.childRunId,
      sessionId: decision.sessionId,
      tenantId: decision.tenantId,
    },
  })
