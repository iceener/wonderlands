import type { AppConfig } from '../../../app/config'
import type { AppDatabase } from '../../../db/client'
import type { DomainError } from '../../../shared/errors'
import { ok, type Result } from '../../../shared/result'
import { firstFilteredUnskipped } from './readiness/candidate-selection'
import { listJobRunDecisions } from './readiness/job-readiness'

export { readinessDecisionKey } from './readiness/candidate-selection'
export type {
  JobRunReadinessDecision,
  ReadinessDecision,
  ReadinessDecisionKind,
  ReadinessDecisionMode,
  ReadinessEngine,
  RunRole,
  WaitingRunResumeReason,
} from './readiness/types'

import type {
  ReadinessDecision,
  ReadinessDecisionKind,
  ReadinessDecisionMode,
  ReadinessEngine,
  RunRole,
} from './readiness/types'
import { listPendingWaitReadinessDecisions } from './readiness/wait-readiness'

export const createReadinessEngine = (input: {
  config: AppConfig
  db: AppDatabase
}): ReadinessEngine => {
  const listDueDecisions = (inputValue: {
    mode?: ReadinessDecisionMode
    now: string
  }): Result<ReadinessDecision[], DomainError> => {
    const ancillaryDecisions = listPendingWaitReadinessDecisions(input.db, inputValue.now)

    if (!ancillaryDecisions.ok) {
      return ancillaryDecisions
    }

    const jobDecisions =
      (inputValue.mode ?? 'worker') === 'startup'
        ? listJobRunDecisions({
            config: input.config,
            db: input.db,
            kinds: ['requeue_waiting_job', 'resume_waiting_run', 'requeue_stale_running_run'],
            now: inputValue.now,
            resumeReason: 'process_restarted',
            staleRunRecoveryReasons: {
              child: 'claim_expired',
              root: 'process_restarted',
            },
          })
        : listJobRunDecisions({
            config: input.config,
            db: input.db,
            now: inputValue.now,
            resumeReason: 'dependencies_satisfied',
          })

    if (!jobDecisions.ok) {
      return jobDecisions
    }

    return ok([...ancillaryDecisions.value, ...jobDecisions.value])
  }

  return {
    pickNextDecision: (inputValue: {
      kinds?: readonly ReadinessDecisionKind[]
      mode?: ReadinessDecisionMode
      now: string
      runRoles?: readonly RunRole[]
      skipKeys?: ReadonlySet<string>
    }): Result<ReadinessDecision | null, DomainError> => {
      const skipKeys = inputValue.skipKeys ?? new Set<string>()
      const dueDecisions = listDueDecisions({
        mode: inputValue.mode,
        now: inputValue.now,
      })

      if (!dueDecisions.ok) {
        return dueDecisions
      }

      const decision = firstFilteredUnskipped(dueDecisions.value, {
        kinds: inputValue.kinds,
        runRoles: inputValue.runRoles,
        skipKeys,
      })

      if (decision) {
        return ok(decision)
      }

      return ok(null)
    },
  }
}
