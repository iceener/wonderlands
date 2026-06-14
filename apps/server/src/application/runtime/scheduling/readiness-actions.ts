import type { AppConfig } from '../../../app/config'
import type { AppServices } from '../../../app/runtime'
import type { AppDatabase } from '../../../db/client'
import type { AppLogger } from '../../../shared/logger'
import { createReadinessActionSupport } from './actions/action-support'
import { deliverResolvedChildResult } from './actions/deliver-resolved-child-result'
import { executePendingRun } from './actions/execute-pending-run'
import { recoverTimedOutWait } from './actions/recover-timed-out-wait'
import { requeueStaleRunningRun } from './actions/requeue-stale-running-run'
import { requeueWaitingJob } from './actions/requeue-waiting-job'
import { resumeRunAfterWaits } from './actions/resume-waiting-run'
import type { ReadinessDecision } from './readiness-engine'

export interface ReadinessActions {
  deliverResolvedChildResult: (
    decision: Extract<ReadinessDecision, { kind: 'deliver_resolved_child_result' }>,
  ) => Promise<boolean>
  executePendingRun: (
    decision: Extract<ReadinessDecision, { kind: 'execute_pending_run' }>,
  ) => Promise<boolean>
  processDecision: (decision: ReadinessDecision) => Promise<boolean>
  recoverTimedOutWait: (
    decision: Extract<ReadinessDecision, { kind: 'recover_timed_out_wait' }>,
  ) => Promise<boolean>
  requeueWaitingJob: (
    decision: Extract<ReadinessDecision, { kind: 'requeue_waiting_job' }>,
  ) => Promise<boolean>
  requeueStaleRunningRun: (
    decision: Extract<ReadinessDecision, { kind: 'requeue_stale_running_run' }>,
  ) => Promise<boolean>
  resumeRunAfterWaits: (
    decision: Extract<ReadinessDecision, { kind: 'resume_waiting_run' }>,
  ) => Promise<boolean>
}

export const createReadinessActions = (input: {
  config: AppConfig
  db: AppDatabase
  logger: AppLogger
  services: AppServices
  workerId: string
}): ReadinessActions => {
  const support = createReadinessActionSupport(input)

  return {
    deliverResolvedChildResult: (decision) => deliverResolvedChildResult(support, decision),
    executePendingRun: (decision) => executePendingRun(support, decision),
    processDecision: async (decision) => {
      switch (decision.kind) {
        case 'deliver_resolved_child_result':
          return deliverResolvedChildResult(support, decision)
        case 'recover_timed_out_wait':
          return recoverTimedOutWait(support, decision)
        case 'requeue_waiting_job':
          return requeueWaitingJob(support, decision)
        case 'resume_waiting_run':
          return resumeRunAfterWaits(support, decision)
        case 'requeue_stale_running_run':
          return requeueStaleRunningRun(support, decision)
        case 'execute_pending_run':
          return executePendingRun(support, decision)
      }
    },
    recoverTimedOutWait: (decision) => recoverTimedOutWait(support, decision),
    requeueWaitingJob: (decision) => requeueWaitingJob(support, decision),
    requeueStaleRunningRun: (decision) => requeueStaleRunningRun(support, decision),
    resumeRunAfterWaits: (decision) => resumeRunAfterWaits(support, decision),
  }
}
