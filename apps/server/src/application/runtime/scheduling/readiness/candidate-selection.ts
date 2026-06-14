import type {
  JobRunReadinessSnapshot,
  PendingWaitReadinessSnapshot,
  ReadinessDecision,
  ReadinessDecisionKind,
  RunRole,
} from './types'

export const readinessDecisionKey = (decision: ReadinessDecision): string => {
  switch (decision.kind) {
    case 'deliver_resolved_child_result':
      return `${decision.kind}:${decision.childRunId}`
    case 'recover_timed_out_wait':
      return `${decision.kind}:${decision.waitId}`
    default:
      return `${decision.kind}:${decision.jobId}:${decision.runId}`
  }
}

const matchesDecisionFilter = (
  decision: ReadinessDecision,
  input: {
    kinds?: readonly ReadinessDecisionKind[]
    runRoles?: readonly RunRole[]
  },
): boolean => {
  if (input.kinds && !input.kinds.includes(decision.kind)) {
    return false
  }

  if ('runRole' in decision && input.runRoles && !input.runRoles.includes(decision.runRole)) {
    return false
  }

  return true
}

const firstUnskipped = (
  decisions: ReadinessDecision[],
  skipKeys: ReadonlySet<string>,
): ReadinessDecision | null => {
  for (const decision of decisions) {
    if (!skipKeys.has(readinessDecisionKey(decision))) {
      return decision
    }
  }

  return null
}

export const firstFilteredUnskipped = (
  decisions: ReadinessDecision[],
  input: {
    kinds?: readonly ReadinessDecisionKind[]
    runRoles?: readonly RunRole[]
    skipKeys: ReadonlySet<string>
  },
): ReadinessDecision | null =>
  firstUnskipped(
    decisions.filter((decision) => matchesDecisionFilter(decision, input)),
    input.skipKeys,
  )

export const isHeartbeatPast = (value: string | null, threshold: string): boolean =>
  typeof value === 'string' && value.length > 0 && value <= threshold

export const isDue = (value: string | null, now: string): boolean =>
  typeof value === 'string' && value.length > 0 && value <= now

const compareNullableAsc = (left: string | null, right: string | null): number => {
  if (left === right) {
    return 0
  }

  if (left === null) {
    return -1
  }

  if (right === null) {
    return 1
  }

  return left.localeCompare(right)
}

const compareNumberAsc = (left: number, right: number): number => left - right

const compareStringAsc = (left: string, right: string): number => left.localeCompare(right)

export const compareWaitingSnapshots = (
  left: JobRunReadinessSnapshot,
  right: JobRunReadinessSnapshot,
): number =>
  compareStringAsc(left.jobUpdatedAt, right.jobUpdatedAt) ||
  compareStringAsc(left.jobId, right.jobId)

export const compareStaleSnapshots = (
  left: JobRunReadinessSnapshot,
  right: JobRunReadinessSnapshot,
): number =>
  compareNullableAsc(left.nextSchedulerCheckAt, right.nextSchedulerCheckAt) ||
  compareNullableAsc(left.lastHeartbeatAt, right.lastHeartbeatAt) ||
  compareNullableAsc(left.lastProgressAt, right.lastProgressAt) ||
  compareStringAsc(left.runId, right.runId)

export const compareReadySnapshots = (
  left: JobRunReadinessSnapshot,
  right: JobRunReadinessSnapshot,
): number =>
  compareNumberAsc(left.priority, right.priority) ||
  compareNullableAsc(left.queuedAt, right.queuedAt) ||
  compareStringAsc(left.runCreatedAt, right.runCreatedAt) ||
  compareStringAsc(left.runId, right.runId)

export const compareResolvedWaitSnapshots = (
  left: PendingWaitReadinessSnapshot,
  right: PendingWaitReadinessSnapshot,
): number =>
  compareStringAsc(left.waitCreatedAt, right.waitCreatedAt) ||
  compareStringAsc(left.waitId, right.waitId)

export const compareTimedOutWaitSnapshots = (
  left: PendingWaitReadinessSnapshot,
  right: PendingWaitReadinessSnapshot,
): number =>
  compareNullableAsc(left.timeoutAt, right.timeoutAt) ||
  compareStringAsc(left.waitCreatedAt, right.waitCreatedAt) ||
  compareStringAsc(left.waitId, right.waitId)
