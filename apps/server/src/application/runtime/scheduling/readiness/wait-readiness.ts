import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '../../../../db/client'
import { runDependencies, runs } from '../../../../db/schema'
import { createRunDependencyRepository } from '../../../../domain/runtime/run-dependency-repository'
import { createRunRepository, type RunRecord } from '../../../../domain/runtime/run-repository'
import type { DomainError } from '../../../../shared/errors'
import { asRunId, asTenantId, asWorkSessionId } from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import { resolveExecutionScopeForSession } from '../../run-execution-scope'
import { isParentDeliverableChildWait } from '../../waits/delegated-child-waits'
import {
  compareResolvedWaitSnapshots,
  compareTimedOutWaitSnapshots,
  isDue,
} from './candidate-selection'
import type { PendingWaitReadinessSnapshot, ReadinessDecision } from './types'

export const listPendingWaitReadinessDecisions = (
  db: AppDatabase,
  now: string,
): Result<
  Array<
    Extract<ReadinessDecision, { kind: 'deliver_resolved_child_result' | 'recover_timed_out_wait' }>
  >,
  DomainError
> => {
  const runDependencyRepository = createRunDependencyRepository(db)

  try {
    const rows = db
      .select({
        ownerRunId: runs.id,
        ownerRunStatus: runs.status,
        sessionId: runs.sessionId,
        targetRunId: runDependencies.targetRunId,
        tenantId: runs.tenantId,
        timeoutAt: runDependencies.timeoutAt,
        waitCreatedAt: runDependencies.createdAt,
        waitId: runDependencies.id,
        waitTargetKind: runDependencies.targetKind,
        waitType: runDependencies.type,
      })
      .from(runDependencies)
      .innerJoin(
        runs,
        and(eq(runDependencies.runId, runs.id), eq(runDependencies.tenantId, runs.tenantId)),
      )
      .where(eq(runDependencies.status, 'pending'))
      .all()

    const snapshots = rows.map((row) => ({
      ownerRunId: row.ownerRunId,
      ownerRunStatus: row.ownerRunStatus,
      sessionId: row.sessionId,
      targetRunId: row.targetRunId,
      targetRunStatus: null,
      tenantId: row.tenantId,
      timeoutAt: row.timeoutAt,
      waitCreatedAt: row.waitCreatedAt,
      waitId: row.waitId,
      waitTargetKind: row.waitTargetKind,
      waitType: row.waitType,
    })) satisfies PendingWaitReadinessSnapshot[]

    const resolvedChildDeliveries: Array<{
      decision: Extract<ReadinessDecision, { kind: 'deliver_resolved_child_result' }>
      snapshot: PendingWaitReadinessSnapshot
    }> = []
    const timedOutWaits: Array<{
      decision: Extract<ReadinessDecision, { kind: 'recover_timed_out_wait' }>
      snapshot: PendingWaitReadinessSnapshot
    }> = []
    const scopeCache = new Map<string, Result<TenantScope, DomainError>>()
    const targetRunStatusCache = new Map<string, Result<RunRecord['status'], DomainError>>()
    const targetRunDeliverableWaitCache = new Map<string, Result<boolean, DomainError>>()

    const getScope = (snapshot: PendingWaitReadinessSnapshot): Result<TenantScope, DomainError> => {
      const cacheKey = `${snapshot.tenantId}:${snapshot.sessionId}`
      const cached = scopeCache.get(cacheKey)

      if (cached) {
        return cached
      }

      const resolved = resolveExecutionScopeForSession(db, {
        sessionId: asWorkSessionId(snapshot.sessionId),
        tenantId: asTenantId(snapshot.tenantId),
      })

      scopeCache.set(cacheKey, resolved)

      return resolved
    }

    const getTargetRunStatus = (
      snapshot: PendingWaitReadinessSnapshot,
    ): Result<RunRecord['status'] | null, DomainError> => {
      if (!snapshot.targetRunId) {
        return ok(null)
      }

      const cached = targetRunStatusCache.get(snapshot.targetRunId)

      if (cached) {
        return cached
      }

      const scope = getScope(snapshot)

      if (!scope.ok) {
        return scope
      }

      const targetRun = createRunRepository(db).getById(scope.value, asRunId(snapshot.targetRunId))
      const resolved = targetRun.ok ? ok(targetRun.value.status) : targetRun

      targetRunStatusCache.set(snapshot.targetRunId, resolved)

      return resolved
    }

    const targetRunHasDeliverablePendingWaits = (
      snapshot: PendingWaitReadinessSnapshot,
    ): Result<boolean, DomainError> => {
      if (!snapshot.targetRunId) {
        return ok(false)
      }

      const cached = targetRunDeliverableWaitCache.get(snapshot.targetRunId)

      if (cached) {
        return cached
      }

      const scope = getScope(snapshot)

      if (!scope.ok) {
        targetRunDeliverableWaitCache.set(snapshot.targetRunId, scope)
        return scope
      }

      const pendingWaits = runDependencyRepository.listPendingByRunId(
        scope.value,
        asRunId(snapshot.targetRunId),
      )
      const resolved = pendingWaits.ok
        ? ok(pendingWaits.value.some(isParentDeliverableChildWait))
        : pendingWaits

      targetRunDeliverableWaitCache.set(snapshot.targetRunId, resolved)

      return resolved
    }

    for (const snapshot of snapshots) {
      if (
        snapshot.waitType === 'agent' &&
        snapshot.waitTargetKind === 'run' &&
        snapshot.targetRunId
      ) {
        const targetRunStatus = getTargetRunStatus(snapshot)

        if (!targetRunStatus.ok) {
          return targetRunStatus
        }

        if (
          targetRunStatus.value === 'completed' ||
          targetRunStatus.value === 'failed' ||
          targetRunStatus.value === 'cancelled'
        ) {
          resolvedChildDeliveries.push({
            decision: {
              childRunId: snapshot.targetRunId,
              kind: 'deliver_resolved_child_result',
              sessionId: snapshot.sessionId,
              tenantId: snapshot.tenantId,
            },
            snapshot,
          })
          continue
        }

        if (targetRunStatus.value === 'waiting') {
          const deliverablePendingWaits = targetRunHasDeliverablePendingWaits(snapshot)

          if (!deliverablePendingWaits.ok) {
            return deliverablePendingWaits
          }

          if (deliverablePendingWaits.value) {
            resolvedChildDeliveries.push({
              decision: {
                childRunId: snapshot.targetRunId,
                kind: 'deliver_resolved_child_result',
                sessionId: snapshot.sessionId,
                tenantId: snapshot.tenantId,
              },
              snapshot,
            })
            continue
          }
        }
      }

      if (snapshot.ownerRunStatus === 'waiting' && isDue(snapshot.timeoutAt, now)) {
        timedOutWaits.push({
          decision: {
            kind: 'recover_timed_out_wait',
            runId: snapshot.ownerRunId,
            sessionId: snapshot.sessionId,
            tenantId: snapshot.tenantId,
            timeoutAt: snapshot.timeoutAt,
            waitId: snapshot.waitId,
          },
          snapshot,
        })
      }
    }

    return ok([
      ...resolvedChildDeliveries
        .sort((left, right) => compareResolvedWaitSnapshots(left.snapshot, right.snapshot))
        .map((entry) => entry.decision),
      ...timedOutWaits
        .sort((left, right) => compareTimedOutWaitSnapshots(left.snapshot, right.snapshot))
        .map((entry) => entry.decision),
    ])
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown pending wait readiness failure'

    return err({
      message: `failed to list pending-wait readiness decisions: ${message}`,
      type: 'conflict',
    })
  }
}
