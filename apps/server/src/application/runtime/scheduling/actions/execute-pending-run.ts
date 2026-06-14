import type { ReadinessDecision } from '../readiness-engine'
import type { ReadinessActionSupport } from './action-support'

export const executePendingRun = async (
  support: ReadinessActionSupport,
  decision: Extract<ReadinessDecision, { kind: 'execute_pending_run' }>,
): Promise<boolean> =>
  support.withRunTarget({
    execute: ({ run, scope }) =>
      support.claimRunAndExecute({
        runRole: decision.runRole,
        event: {
          payload: {
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
          type: 'run.started',
        },
        expectedStatus: 'pending',
        failureLogMessage: `${decision.runRole === 'root' ? 'Root' : 'Child'} run failed to transition from pending to running`,
        run,
        scope,
      }),
    logScopeFailure: {
      message: 'Failed to resolve pending run execution scope',
      runId: decision.runId,
      tenantId: decision.tenantId,
    },
    target: {
      expectedRunRole: decision.runRole,
      expectedStatuses: ['pending'],
      runId: decision.runId,
      sessionId: decision.sessionId,
      tenantId: decision.tenantId,
    },
  })
