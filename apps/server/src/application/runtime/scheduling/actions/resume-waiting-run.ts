import type { ReadinessDecision } from '../readiness-engine'
import type { ReadinessActionSupport } from './action-support'

export const resumeRunAfterWaits = async (
  support: ReadinessActionSupport,
  decision: Extract<ReadinessDecision, { kind: 'resume_waiting_run' }>,
): Promise<boolean> =>
  support.withRunTarget({
    execute: async ({ run, scope }) => {
      const pendingWaits = support.listPendingWaitsForRun(scope, run.id)

      if (!pendingWaits.ok) {
        support.logger.warn('Failed to inspect recovered waiting run before execution', {
          message: pendingWaits.error.message,
          runId: decision.runId,
          tenantId: decision.tenantId,
        })
        return false
      }

      if (pendingWaits.value.length > 0) {
        return false
      }

      return support.claimRunAndExecute({
        runRole: decision.runRole,
        event: {
          payload: {
            ...(decision.resumeReason === 'process_restarted'
              ? {
                  reason: 'process_restarted',
                  recoveredFromStatus: 'waiting',
                }
              : {
                  reason: 'dependencies_satisfied',
                }),
            ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
            ...(run.sourceCallId ? { sourceCallId: run.sourceCallId } : {}),
            rootRunId: run.rootRunId,
            runId: run.id,
            sessionId: run.sessionId,
            status: 'running',
            targetKind: run.targetKind,
            task: run.task,
            threadId: run.threadId,
          },
          type: 'run.resumed',
        },
        expectedStatus: 'waiting',
        failureLogMessage:
          decision.resumeReason === 'process_restarted'
            ? 'Failed to resume recovered waiting run'
            : 'Failed to resume waiting run after dependencies were satisfied',
        run,
        scope,
      })
    },
    logScopeFailure: {
      message: 'Failed to resolve recovered waiting run scope',
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
