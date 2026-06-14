import type { DomainError } from '../../../../shared/errors'
import type { Result } from '../../../../shared/result'
import type { StaleRunRecoveryReason } from '../job-status-reasons'

export type RunRole = 'child' | 'root'

interface JobRunDecisionBase<TRunRole extends RunRole> {
  jobId: string
  runId: string
  runRole: TRunRole
  sessionId: string
  tenantId: string
}

type ExecutePendingRunDecision =
  | (JobRunDecisionBase<'child'> & {
      kind: 'execute_pending_run'
    })
  | (JobRunDecisionBase<'root'> & {
      kind: 'execute_pending_run'
    })

export type WaitingRunResumeReason = 'dependencies_satisfied' | 'process_restarted'

type ResumeWaitingRunDecision =
  | (JobRunDecisionBase<'child'> & {
      kind: 'resume_waiting_run'
      resumeReason: WaitingRunResumeReason
    })
  | (JobRunDecisionBase<'root'> & {
      kind: 'resume_waiting_run'
      resumeReason: WaitingRunResumeReason
    })

type RequeueWaitingJobDecision =
  | (JobRunDecisionBase<'child'> & {
      kind: 'requeue_waiting_job'
    })
  | (JobRunDecisionBase<'root'> & {
      kind: 'requeue_waiting_job'
    })

type RequeueStaleRunningRunDecision =
  | (JobRunDecisionBase<'child'> & {
      kind: 'requeue_stale_running_run'
      lastProgressAt: string | null
      nextSchedulerCheckAt: string | null
      recoveryReason: StaleRunRecoveryReason
    })
  | (JobRunDecisionBase<'root'> & {
      kind: 'requeue_stale_running_run'
      lastProgressAt: string | null
      nextSchedulerCheckAt: string | null
      recoveryReason: StaleRunRecoveryReason
    })

export type JobRunReadinessDecision =
  | ExecutePendingRunDecision
  | ResumeWaitingRunDecision
  | RequeueWaitingJobDecision
  | RequeueStaleRunningRunDecision

export type ReadinessDecision =
  | {
      childRunId: string
      kind: 'deliver_resolved_child_result'
      sessionId: string
      tenantId: string
    }
  | {
      kind: 'recover_timed_out_wait'
      runId: string
      sessionId: string
      tenantId: string
      timeoutAt: string | null
      waitId: string
    }
  | JobRunReadinessDecision

export type ReadinessDecisionKind = ReadinessDecision['kind']
export type ReadinessDecisionMode = 'startup' | 'worker'

export interface ReadinessEngine {
  pickNextDecision: (input: {
    kinds?: readonly ReadinessDecisionKind[]
    mode?: ReadinessDecisionMode
    now: string
    runRoles?: readonly RunRole[]
    skipKeys?: ReadonlySet<string>
  }) => Result<ReadinessDecision | null, DomainError>
}

export interface JobRunReadinessSnapshot {
  jobId: string
  jobStatus: 'queued' | 'running' | 'waiting' | 'blocked' | 'completed' | 'cancelled' | 'superseded'
  jobUpdatedAt: string
  lastHeartbeatAt: string | null
  lastProgressAt: string | null
  leaseExpiresAt: string | null
  nextSchedulerCheckAt: string | null
  parentRunId: string | null
  priority: number
  queueReason: import('../job-status-reasons').ParsedJobQueueReason | null
  queuedAt: string | null
  runCreatedAt: string
  runId: string
  runRole: RunRole
  runStatus: 'pending' | 'running' | 'cancelling' | 'waiting' | 'completed' | 'failed' | 'cancelled'
  sessionId: string
  tenantId: string
}

export interface PendingWaitReadinessSnapshot {
  ownerRunId: string
  ownerRunStatus:
    | 'pending'
    | 'running'
    | 'cancelling'
    | 'waiting'
    | 'completed'
    | 'failed'
    | 'cancelled'
  sessionId: string
  targetRunId: string | null
  targetRunStatus:
    | 'pending'
    | 'running'
    | 'cancelling'
    | 'waiting'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | null
  tenantId: string
  timeoutAt: string | null
  waitCreatedAt: string
  waitId: string
  waitTargetKind: string
  waitType: string
}
