import type { AppConfig } from '../../../../app/config'
import type { AppServices } from '../../../../app/runtime'
import type { AppDatabase } from '../../../../db/client'
import { withTransaction } from '../../../../db/transaction'
import { createRunClaimRepository } from '../../../../adapters/persistence/sqlite/runtime/run-claim-repository'
import { createRunDependencyRepository } from '../../../../adapters/persistence/sqlite/runtime/run-dependency-repository'
import type { RunRecord } from '../../../../domain/runtime/run-repository'
import { createRunRepository } from '../../../../adapters/persistence/sqlite/runtime/run-repository'
import type { DomainError } from '../../../../shared/errors'
import { asRunId, asTenantId, asWorkSessionId } from '../../../../shared/ids'
import type { AppLogger } from '../../../../shared/logger'
import { ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import { createEventStore } from '../../../commands/event-store'
import { createInternalCommandContext } from '../../../commands/internal-command-context'
import { executeRunTurnLoop } from '../../execution/drive-run'
import { appendRunEvent } from '../../run-events'
import { resolveExecutionScopeForSession } from '../../run-execution-scope'
import { markLinkedJobRunning, markRunJobBlocked, recordLinkedJobHeartbeat } from '../job-sync'
import type { ReadinessDecision, RunRole } from '../readiness-engine'

const addMilliseconds = (value: string, milliseconds: number): string =>
  new Date(Date.parse(value) + milliseconds).toISOString()

type RunScopedDecision = Extract<
  ReadinessDecision,
  {
    runId: string
    sessionId: string
    tenantId: string
  }
>

interface ReadinessActionsInput {
  config: AppConfig
  db: AppDatabase
  logger: AppLogger
  services: AppServices
  workerId: string
}

export interface ReadinessActionSupport {
  config: AppConfig
  db: AppDatabase
  logger: AppLogger
  services: AppServices
  workerId: string
  runDependencyRepository: ReturnType<typeof createRunDependencyRepository>
  runRepository: ReturnType<typeof createRunRepository>
  waitTimeoutMessage: string
  nextStaleRecoveryCheckAt: (updatedAt: string, staleRecoveryCount: number) => string | null
  failStaleRunningRun: (input: {
    decision: Extract<ReadinessDecision, { kind: 'requeue_stale_running_run' }>
    run: RunRecord
    scope: TenantScope
  }) => Promise<boolean>
  listPendingWaitsForRun: (
    scope: TenantScope,
    runId: RunRecord['id'],
  ) => ReturnType<ReturnType<typeof createRunDependencyRepository>['listPendingByRunId']>
  withRunTarget: (input: {
    execute: (context: { run: RunRecord; scope: TenantScope }) => Promise<boolean>
    logLoadFailure?: {
      message: string
      runId: string
      runIdField?: 'childRunId' | 'runId'
      tenantId: string
    }
    logScopeFailure: {
      message: string
      runId: string
      runIdField?: 'childRunId' | 'runId'
      tenantId: string
    }
    target: {
      expectedRunRole?: RunRole
      expectedStatuses?: readonly RunRecord['status'][]
      runId: string
      sessionId: string
      tenantId: string
    }
  }) => Promise<boolean>
  claimRunAndExecute: (input: {
    runRole: RunRole
    event: {
      payload: Record<string, unknown>
      type: 'run.resumed' | 'run.started'
    }
    expectedStatus: 'pending' | 'waiting'
    failureLogMessage: string
    run: RunRecord
    scope: TenantScope
  }) => Promise<boolean>
}

export const createReadinessActionSupport = (
  input: ReadinessActionsInput,
): ReadinessActionSupport => {
  const runRepository = createRunRepository(input.db)
  const runDependencyRepository = createRunDependencyRepository(input.db)
  const claimHeartbeatIntervalMs = Math.max(25, Math.floor(input.config.multiagent.leaseTtlMs / 3))
  const waitTimeoutMessage = 'Wait timed out before external input arrived'

  const matchesRunRole = (run: Pick<RunRecord, 'parentRunId'>, runRole: RunRole): boolean =>
    runRole === 'root' ? run.parentRunId === null : run.parentRunId !== null

  const toRunRoleLabel = (runRole: RunRole): 'Child' | 'Root' =>
    runRole === 'root' ? 'Root' : 'Child'

  const staleRecoveryDelayMs = (staleRecoveryCount: number): number => {
    if (staleRecoveryCount <= 1) {
      return 0
    }

    return input.config.multiagent.staleRecoveryBaseDelayMs * 2 ** (staleRecoveryCount - 2)
  }

  const nextStaleRecoveryCheckAt = (
    updatedAt: string,
    staleRecoveryCount: number,
  ): string | null => {
    const delayMs = staleRecoveryDelayMs(staleRecoveryCount)

    return delayMs > 0 ? addMilliseconds(updatedAt, delayMs) : null
  }

  const failStaleRunningRun = async (inputValue: {
    decision: Extract<ReadinessDecision, { kind: 'requeue_stale_running_run' }>
    run: RunRecord
    scope: TenantScope
  }): Promise<boolean> => {
    const failedAt = input.services.clock.nowIso()
    const context = createInternalCommandContext(input, inputValue.scope)
    const error = {
      message: `run ${inputValue.run.id} exceeded the configured maximum of ${input.config.multiagent.maxStaleRecoveries} stale recovery attempts`,
      type: 'timeout' as const,
    }
    const failed = withTransaction(input.db, (tx) => {
      const txRunRepository = createRunRepository(tx)
      const eventStore = createEventStore(tx)
      const failedRun = txRunRepository.fail(inputValue.scope, {
        completedAt: failedAt,
        errorJson: error,
        expectedStatus: 'running',
        expectedVersion: inputValue.run.version,
        lastProgressAt: failedAt,
        resultJson: inputValue.run.resultJson ?? null,
        runId: inputValue.run.id,
        turnCount: inputValue.run.turnCount,
        updatedAt: failedAt,
      })

      if (!failedRun.ok) {
        return failedRun
      }

      appendRunEvent(context, eventStore, failedRun.value, 'run.failed', {
        error,
      })

      const blocked = markRunJobBlocked(tx, inputValue.scope, failedRun.value, {
        eventContext: {
          eventStore,
          traceId: context.traceId,
        },
        error,
        updatedAt: failedAt,
      })

      if (!blocked.ok) {
        return blocked
      }

      return ok(failedRun.value)
    })

    if (!failed.ok) {
      input.logger.warn(
        `Failed to stop stale ${inputValue.decision.runRole} run after recovery limit`,
        {
          message: failed.error.message,
          runId: inputValue.decision.runId,
          tenantId: inputValue.decision.tenantId,
        },
      )
      return false
    }

    input.logger.warn(
      `Stopped stale ${inputValue.decision.runRole} run after exhausting recovery attempts`,
      {
        recoveryReason: inputValue.decision.recoveryReason,
        runId: inputValue.decision.runId,
        staleRecoveryCount: inputValue.run.staleRecoveryCount,
        tenantId: inputValue.decision.tenantId,
      },
    )

    return true
  }

  const resolveDecisionScope = (decision: Pick<RunScopedDecision, 'sessionId' | 'tenantId'>) =>
    resolveExecutionScopeForSession(input.db, {
      sessionId: asWorkSessionId(decision.sessionId),
      tenantId: asTenantId(decision.tenantId),
    })

  const loadRunTarget = (inputValue: {
    expectedRunRole?: RunRole
    expectedStatuses?: readonly RunRecord['status'][]
    runId: string
    sessionId: string
    tenantId: string
  }): Result<
    | {
        run: RunRecord
        scope: TenantScope
        status: 'loaded'
      }
    | {
        status: 'missing'
      },
    DomainError
  > => {
    const scope = resolveDecisionScope(inputValue)

    if (!scope.ok) {
      return scope
    }

    const run = runRepository.getById(scope.value, asRunId(inputValue.runId))

    if (!run.ok) {
      return ok({
        status: 'missing',
      })
    }

    if (inputValue.expectedStatuses && !inputValue.expectedStatuses.includes(run.value.status)) {
      return ok({
        status: 'missing',
      })
    }

    if (inputValue.expectedRunRole && !matchesRunRole(run.value, inputValue.expectedRunRole)) {
      return ok({
        status: 'missing',
      })
    }

    return ok({
      run: run.value,
      scope: scope.value,
      status: 'loaded',
    })
  }

  const withRunTarget: ReadinessActionSupport['withRunTarget'] = async (inputValue) => {
    const loaded = loadRunTarget({
      expectedRunRole: inputValue.target.expectedRunRole,
      expectedStatuses: inputValue.target.expectedStatuses,
      runId: inputValue.target.runId,
      sessionId: inputValue.target.sessionId,
      tenantId: inputValue.target.tenantId,
    })

    if (!loaded.ok) {
      input.logger.warn(inputValue.logScopeFailure.message, {
        message: loaded.error.message,
        [inputValue.logScopeFailure.runIdField ?? 'runId']: inputValue.logScopeFailure.runId,
        tenantId: inputValue.logScopeFailure.tenantId,
      })
      return false
    }

    if (loaded.value.status === 'missing') {
      if (inputValue.logLoadFailure) {
        input.logger.warn(inputValue.logLoadFailure.message, {
          [inputValue.logLoadFailure.runIdField ?? 'runId']: inputValue.logLoadFailure.runId,
          tenantId: inputValue.logLoadFailure.tenantId,
        })
      }

      return false
    }

    return inputValue.execute({
      run: loaded.value.run,
      scope: loaded.value.scope,
    })
  }

  const listPendingWaitsForRun = (scope: TenantScope, runId: RunRecord['id']) =>
    runDependencyRepository.listPendingByRunId(scope, runId)

  const syncClaimHeartbeat = (scope: TenantScope, run: RunRecord, heartbeatAt: string) => {
    const synced = recordLinkedJobHeartbeat(input.db, scope, run, {
      heartbeatAt,
      nextSchedulerCheckAt: addMilliseconds(heartbeatAt, input.config.multiagent.leaseTtlMs),
    })

    if (!synced.ok) {
      input.logger.warn('Failed to record job heartbeat from a run claim heartbeat', {
        message: synced.error.message,
        runId: run.id,
        tenantId: scope.tenantId,
      })
    }
  }

  const claimRunAndExecute: ReadinessActionSupport['claimRunAndExecute'] = async (inputValue) => {
    const claimedAt = input.services.clock.nowIso()
    const claimRepository = createRunClaimRepository(input.db)
    const claim = claimRepository.claim(inputValue.scope, {
      acquiredAt: claimedAt,
      expiresAt: addMilliseconds(claimedAt, input.config.multiagent.leaseTtlMs),
      renewedAt: claimedAt,
      runId: inputValue.run.id,
      workerId: input.workerId,
    })

    if (!claim.ok) {
      return false
    }

    syncClaimHeartbeat(inputValue.scope, inputValue.run, claimedAt)

    const heartbeat = setInterval(() => {
      const renewedAt = input.services.clock.nowIso()
      const renewed = claimRepository.heartbeatClaim(inputValue.scope, {
        expiresAt: addMilliseconds(renewedAt, input.config.multiagent.leaseTtlMs),
        renewedAt,
        runId: inputValue.run.id,
        workerId: input.workerId,
      })

      if (!renewed.ok) {
        input.logger.warn(`Failed to heartbeat ${inputValue.runRole} run claim`, {
          message: renewed.error.message,
          runId: inputValue.run.id,
          tenantId: inputValue.scope.tenantId,
          workerId: input.workerId,
        })
        return
      }

      syncClaimHeartbeat(inputValue.scope, inputValue.run, renewedAt)
    }, claimHeartbeatIntervalMs)

    try {
      const runningAt = input.services.clock.nowIso()
      const runningRun = withTransaction(input.db, (tx) => {
        const txRunRepository = createRunRepository(tx)
        const eventStore = createEventStore(tx)
        const updatedRun = txRunRepository.markRunning(inputValue.scope, {
          configSnapshot: inputValue.run.configSnapshot,
          expectedStatus: inputValue.expectedStatus,
          expectedVersion: inputValue.run.version,
          lastProgressAt: runningAt,
          runId: inputValue.run.id,
          startedAt: inputValue.run.startedAt ?? runningAt,
          updatedAt: runningAt,
        })

        if (!updatedRun.ok) {
          return updatedRun
        }

        const appended = eventStore.append({
          actorAccountId: inputValue.scope.accountId,
          aggregateId: inputValue.run.id,
          aggregateType: 'run',
          payload: inputValue.event.payload,
          tenantId: inputValue.scope.tenantId,
          type: inputValue.event.type,
        })

        if (!appended.ok) {
          return appended
        }

        const syncedJob = markLinkedJobRunning(tx, inputValue.scope, updatedRun.value, runningAt)

        if (!syncedJob.ok) {
          return syncedJob
        }

        return ok(updatedRun.value)
      })

      if (!runningRun.ok) {
        input.logger.warn(inputValue.failureLogMessage, {
          message: runningRun.error.message,
          runId: inputValue.run.id,
          tenantId: inputValue.scope.tenantId,
        })
        return false
      }

      const execution = await executeRunTurnLoop(
        createInternalCommandContext(input, inputValue.scope),
        runningRun.value,
        {},
      )

      if (!execution.ok) {
        input.logger.warn(`${toRunRoleLabel(inputValue.runRole)} run execution returned an error`, {
          message: execution.error.message,
          runId: inputValue.run.id,
          tenantId: inputValue.scope.tenantId,
          type: execution.error.type,
        })
      }
    } finally {
      clearInterval(heartbeat)
      const released = claimRepository.releaseClaim(inputValue.scope, {
        runId: inputValue.run.id,
        workerId: input.workerId,
      })

      if (!released.ok) {
        input.logger.warn(`Failed to release ${inputValue.runRole} run claim`, {
          message: released.error.message,
          runId: inputValue.run.id,
          tenantId: inputValue.scope.tenantId,
        })
      }
    }

    return true
  }

  return {
    claimRunAndExecute,
    config: input.config,
    db: input.db,
    failStaleRunningRun,
    listPendingWaitsForRun,
    logger: input.logger,
    nextStaleRecoveryCheckAt,
    runDependencyRepository,
    runRepository,
    services: input.services,
    waitTimeoutMessage,
    withRunTarget,
    workerId: input.workerId,
  }
}
