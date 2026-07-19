import type { AppConfig } from '../../../../app/config'
import type { AppDatabase } from '../../../../db/client'
import type { RunRecord } from '../../../../domain/runtime/run-repository'
import type { DomainError } from '../../../../shared/errors'
import { asJobId, asRunId, asTenantId, asWorkSessionId } from '../../../../shared/ids'
import { ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import {
  createJobRunReadinessRepository,
  createRunDependencyRepository,
  createRunRepository,
  createToolExecutionRepository,
} from '../../../persistence/repositories'
import { resolveExecutionScopeForSession } from '../../run-execution-scope'
import { dependenciesSatisfiedForJob } from '../job-dependencies'
import {
  isAutoExecutableQueuedRootJobReason,
  parseJobQueueReason,
  type StaleRunRecoveryReason,
} from '../job-status-reasons'
import {
  compareReadySnapshots,
  compareStaleSnapshots,
  compareWaitingSnapshots,
  isDue,
  isHeartbeatPast,
} from './candidate-selection'
import type {
  JobRunReadinessDecision,
  JobRunReadinessSnapshot,
  RunRole,
  WaitingRunResumeReason,
} from './types'

const addMilliseconds = (value: string, milliseconds: number): string =>
  new Date(Date.parse(value) + milliseconds).toISOString()

const listExecutionCapableJobSnapshots = (
  db: AppDatabase,
): Result<JobRunReadinessSnapshot[], DomainError> => {
  const snapshots = createJobRunReadinessRepository(db).listExecutionCapableJobRunSnapshots()

  if (!snapshots.ok) {
    return snapshots
  }

  return ok(
    snapshots.value.map((row) => ({
      jobId: row.jobId,
      jobStatus: row.jobStatus,
      jobUpdatedAt: row.jobUpdatedAt,
      lastHeartbeatAt: row.lastHeartbeatAt,
      lastProgressAt: row.lastProgressAt,
      leaseExpiresAt: row.leaseExpiresAt,
      nextSchedulerCheckAt: row.nextSchedulerCheckAt,
      parentRunId: row.parentRunId,
      priority: row.priority,
      queueReason: parseJobQueueReason(row.statusReasonJson),
      queuedAt: row.queuedAt,
      runCreatedAt: row.runCreatedAt,
      runId: row.runId,
      runRole: row.parentRunId ? 'child' : 'root',
      runStatus: row.runStatus,
      sessionId: row.sessionId,
      tenantId: row.tenantId,
    })),
  )
}

export const listJobRunDecisions = (input: {
  config: AppConfig
  db: AppDatabase
  kinds?: readonly JobRunReadinessDecision['kind'][]
  now: string
  resumeReason: WaitingRunResumeReason
  runRoles?: readonly RunRole[]
  staleRunRecoveryReasons?: Partial<Record<RunRole, StaleRunRecoveryReason>>
}): Result<JobRunReadinessDecision[], DomainError> => {
  const runDependencyRepository = createRunDependencyRepository(input.db)
  const snapshots = listExecutionCapableJobSnapshots(input.db)

  if (!snapshots.ok) {
    return snapshots
  }

  const staleBefore = addMilliseconds(input.now, -input.config.multiagent.leaseTtlMs)
  const scopeCache = new Map<string, Result<TenantScope, DomainError>>()
  const parentRunStatusCache = new Map<string, Result<RunRecord['status'], DomainError>>()
  const pendingWaitCountCache = new Map<string, Result<number, DomainError>>()
  const incompleteToolExecutionCountCache = new Map<string, Result<number, DomainError>>()
  const dependencySatisfiedCache = new Map<string, Result<boolean, DomainError>>()
  const allowedKinds = input.kinds ? new Set(input.kinds) : null
  const allowedRunRoles = input.runRoles ? new Set(input.runRoles) : null
  const staleRunRecoveryReasons = {
    child: input.staleRunRecoveryReasons?.child ?? 'claim_expired',
    root: input.staleRunRecoveryReasons?.root ?? 'claim_expired',
  } satisfies Record<RunRole, StaleRunRecoveryReason>

  const getScope = (snapshot: JobRunReadinessSnapshot): Result<TenantScope, DomainError> => {
    const cacheKey = `${snapshot.tenantId}:${snapshot.sessionId}`
    const cached = scopeCache.get(cacheKey)

    if (cached) {
      return cached
    }

    const resolved = resolveExecutionScopeForSession(input.db, {
      sessionId: asWorkSessionId(snapshot.sessionId),
      tenantId: asTenantId(snapshot.tenantId),
    })

    scopeCache.set(cacheKey, resolved)

    return resolved
  }

  const getPendingWaitCount = (snapshot: JobRunReadinessSnapshot): Result<number, DomainError> => {
    const cached = pendingWaitCountCache.get(snapshot.runId)

    if (cached) {
      return cached
    }

    const scope = getScope(snapshot)

    if (!scope.ok) {
      pendingWaitCountCache.set(snapshot.runId, scope)
      return scope
    }

    const pendingWaits = runDependencyRepository.listPendingByRunId(
      scope.value,
      asRunId(snapshot.runId),
    )
    const counted = pendingWaits.ok ? ok(pendingWaits.value.length) : pendingWaits
    pendingWaitCountCache.set(snapshot.runId, counted)

    return counted
  }

  const getIncompleteToolExecutionCount = (
    snapshot: JobRunReadinessSnapshot,
  ): Result<number, DomainError> => {
    const cached = incompleteToolExecutionCountCache.get(snapshot.runId)

    if (cached) {
      return cached
    }

    const scope = getScope(snapshot)

    if (!scope.ok) {
      incompleteToolExecutionCountCache.set(snapshot.runId, scope)
      return scope
    }

    const incompleteToolExecutions = createToolExecutionRepository(input.db).listIncompleteByRunId(
      scope.value,
      asRunId(snapshot.runId),
    )
    const counted = incompleteToolExecutions.ok
      ? ok(incompleteToolExecutions.value.length)
      : incompleteToolExecutions
    incompleteToolExecutionCountCache.set(snapshot.runId, counted)

    return counted
  }

  const getParentRunStatus = (
    snapshot: JobRunReadinessSnapshot,
  ): Result<RunRecord['status'] | null, DomainError> => {
    if (!snapshot.parentRunId) {
      return ok(null)
    }

    const cached = parentRunStatusCache.get(snapshot.parentRunId)

    if (cached) {
      return cached
    }

    const scope = getScope(snapshot)

    if (!scope.ok) {
      return scope
    }

    const parentRun = createRunRepository(input.db).getById(
      scope.value,
      asRunId(snapshot.parentRunId),
    )
    const resolved = parentRun.ok ? ok(parentRun.value.status) : parentRun
    parentRunStatusCache.set(snapshot.parentRunId, resolved)

    return resolved
  }

  const dependenciesSatisfied = (
    snapshot: JobRunReadinessSnapshot,
  ): Result<boolean, DomainError> => {
    const cached = dependencySatisfiedCache.get(snapshot.jobId)

    if (cached) {
      return cached
    }

    const scope = getScope(snapshot)

    if (!scope.ok) {
      dependencySatisfiedCache.set(snapshot.jobId, scope)
      return scope
    }

    const evaluated = dependenciesSatisfiedForJob(input.db, scope.value, asJobId(snapshot.jobId))

    dependencySatisfiedCache.set(snapshot.jobId, evaluated)

    return evaluated
  }

  const matchesFilter = (decision: JobRunReadinessDecision): boolean =>
    (!allowedKinds || allowedKinds.has(decision.kind)) &&
    (!allowedRunRoles || allowedRunRoles.has(decision.runRole))

  const decisionGroups = {
    pendingChildren: [] as Array<{
      decision: Extract<JobRunReadinessDecision, { runRole: 'child'; kind: 'execute_pending_run' }>
      snapshot: JobRunReadinessSnapshot
    }>,
    pendingRoots: [] as Array<{
      decision: Extract<JobRunReadinessDecision, { runRole: 'root'; kind: 'execute_pending_run' }>
      snapshot: JobRunReadinessSnapshot
    }>,
    reopenable: [] as Array<{
      decision: Extract<JobRunReadinessDecision, { kind: 'requeue_waiting_job' }>
      snapshot: JobRunReadinessSnapshot
    }>,
    resumable: [] as Array<{
      decision: Extract<JobRunReadinessDecision, { kind: 'resume_waiting_run' }>
      snapshot: JobRunReadinessSnapshot
    }>,
    staleChildren: [] as Array<{
      decision: Extract<
        JobRunReadinessDecision,
        { runRole: 'child'; kind: 'requeue_stale_running_run' }
      >
      snapshot: JobRunReadinessSnapshot
    }>,
    staleRoots: [] as Array<{
      decision: Extract<
        JobRunReadinessDecision,
        { runRole: 'root'; kind: 'requeue_stale_running_run' }
      >
      snapshot: JobRunReadinessSnapshot
    }>,
  }

  const evaluateSnapshot = (snapshot: JobRunReadinessSnapshot): Result<null, DomainError> => {
    if (snapshot.runStatus === 'waiting') {
      const pendingWaitCount = getPendingWaitCount(snapshot)

      if (!pendingWaitCount.ok) {
        return pendingWaitCount
      }

      if (pendingWaitCount.value > 0) {
        return ok(null)
      }

      const incompleteToolExecutionCount = getIncompleteToolExecutionCount(snapshot)

      if (!incompleteToolExecutionCount.ok) {
        return incompleteToolExecutionCount
      }

      if (incompleteToolExecutionCount.value > 0) {
        return ok(null)
      }

      if (snapshot.jobStatus === 'waiting') {
        const dependencies = dependenciesSatisfied(snapshot)

        if (!dependencies.ok) {
          return dependencies
        }

        if (!dependencies.value) {
          return ok(null)
        }

        const decision = {
          jobId: snapshot.jobId,
          kind: 'requeue_waiting_job' as const,
          runId: snapshot.runId,
          runRole: snapshot.runRole,
          sessionId: snapshot.sessionId,
          tenantId: snapshot.tenantId,
        }

        if (matchesFilter(decision)) {
          decisionGroups.reopenable.push({ decision, snapshot })
        }

        return ok(null)
      }

      if (snapshot.jobStatus === 'queued') {
        const decision = {
          jobId: snapshot.jobId,
          kind: 'resume_waiting_run' as const,
          resumeReason: input.resumeReason,
          runId: snapshot.runId,
          runRole: snapshot.runRole,
          sessionId: snapshot.sessionId,
          tenantId: snapshot.tenantId,
        }

        if (matchesFilter(decision)) {
          decisionGroups.resumable.push({ decision, snapshot })
        }
      }

      return ok(null)
    }

    if (snapshot.runStatus === 'running' && snapshot.jobStatus === 'running') {
      const leaseExpired = snapshot.leaseExpiresAt === null || snapshot.leaseExpiresAt <= input.now
      const stale =
        isDue(snapshot.nextSchedulerCheckAt, input.now) ||
        isHeartbeatPast(snapshot.lastHeartbeatAt ?? snapshot.lastProgressAt, staleBefore)

      if (leaseExpired && stale) {
        const recoveryReason = staleRunRecoveryReasons[snapshot.runRole]

        if (snapshot.runRole === 'root') {
          const decision = {
            jobId: snapshot.jobId,
            kind: 'requeue_stale_running_run' as const,
            lastProgressAt: snapshot.lastProgressAt,
            nextSchedulerCheckAt: snapshot.nextSchedulerCheckAt,
            recoveryReason,
            runId: snapshot.runId,
            runRole: 'root' as const,
            sessionId: snapshot.sessionId,
            tenantId: snapshot.tenantId,
          }

          if (matchesFilter(decision)) {
            decisionGroups.staleRoots.push({ decision, snapshot })
          }
        } else {
          const decision = {
            jobId: snapshot.jobId,
            kind: 'requeue_stale_running_run' as const,
            lastProgressAt: snapshot.lastProgressAt,
            nextSchedulerCheckAt: snapshot.nextSchedulerCheckAt,
            recoveryReason,
            runId: snapshot.runId,
            runRole: 'child' as const,
            sessionId: snapshot.sessionId,
            tenantId: snapshot.tenantId,
          }

          if (matchesFilter(decision)) {
            decisionGroups.staleChildren.push({ decision, snapshot })
          }
        }
      }

      return ok(null)
    }

    if (snapshot.runStatus === 'pending' && snapshot.jobStatus === 'queued') {
      if (snapshot.nextSchedulerCheckAt && !isDue(snapshot.nextSchedulerCheckAt, input.now)) {
        return ok(null)
      }

      if (
        snapshot.runRole === 'root' &&
        !isAutoExecutableQueuedRootJobReason(snapshot.queueReason)
      ) {
        return ok(null)
      }

      if (snapshot.runRole === 'child') {
        const parentRunStatus = getParentRunStatus(snapshot)

        if (!parentRunStatus.ok) {
          return parentRunStatus
        }

        if (parentRunStatus.value === 'pending' || parentRunStatus.value === 'running') {
          return ok(null)
        }
      }

      if (snapshot.runRole === 'root') {
        const decision = {
          jobId: snapshot.jobId,
          kind: 'execute_pending_run' as const,
          runId: snapshot.runId,
          runRole: 'root' as const,
          sessionId: snapshot.sessionId,
          tenantId: snapshot.tenantId,
        }

        if (matchesFilter(decision)) {
          decisionGroups.pendingRoots.push({ decision, snapshot })
        }
      } else {
        const decision = {
          jobId: snapshot.jobId,
          kind: 'execute_pending_run' as const,
          runId: snapshot.runId,
          runRole: 'child' as const,
          sessionId: snapshot.sessionId,
          tenantId: snapshot.tenantId,
        }

        if (matchesFilter(decision)) {
          decisionGroups.pendingChildren.push({ decision, snapshot })
        }
      }
    }

    return ok(null)
  }

  for (const snapshot of snapshots.value) {
    const evaluated = evaluateSnapshot(snapshot)

    if (!evaluated.ok) {
      return evaluated
    }
  }

  const ordered = [
    ...decisionGroups.reopenable.sort((left, right) =>
      compareWaitingSnapshots(left.snapshot, right.snapshot),
    ),
    ...decisionGroups.resumable.sort((left, right) =>
      compareWaitingSnapshots(left.snapshot, right.snapshot),
    ),
    ...decisionGroups.staleRoots.sort((left, right) =>
      compareStaleSnapshots(left.snapshot, right.snapshot),
    ),
    ...decisionGroups.staleChildren.sort((left, right) =>
      compareStaleSnapshots(left.snapshot, right.snapshot),
    ),
    ...decisionGroups.pendingRoots.sort((left, right) =>
      compareReadySnapshots(left.snapshot, right.snapshot),
    ),
    ...decisionGroups.pendingChildren.sort((left, right) =>
      compareReadySnapshots(left.snapshot, right.snapshot),
    ),
  ]

  return ok(ordered.map((entry) => entry.decision))
}
