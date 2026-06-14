import type { AppConfig } from '../../../app/config'
import type { AppServices } from '../../../app/runtime'
import type { AppDatabase } from '../../../db/client'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { createPollingWorker } from '../../polling-worker'
import { createReadinessActions } from './readiness-actions'
import {
  createReadinessEngine,
  type ReadinessDecision,
  type RunRole,
  readinessDecisionKey,
} from './readiness-engine'

export interface MultiagentWorker {
  processAvailableDecisions: () => Promise<boolean>
  processOneDecision: () => Promise<boolean>
  reconcileDecisions: (input?: {
    runRoles?: readonly RunRole[]
    kinds?: readonly ReadinessDecision['kind'][]
    mode?: 'startup' | 'worker'
  }) => Promise<Result<number, DomainError>>
  start: () => void
  stop: () => Promise<void>
  wake: () => void
}

export const createMultiagentWorker = (input: {
  config: AppConfig
  db: AppDatabase
  services: AppServices
}): MultiagentWorker => {
  const logger = input.services.logger.child({
    subsystem: 'multiagent_worker',
  })
  const readinessEngine = createReadinessEngine({
    config: input.config,
    db: input.db,
  })
  const workerId = input.services.ids.create('wrk')
  const readinessActions = createReadinessActions({
    config: input.config,
    db: input.db,
    logger,
    services: input.services,
    workerId,
  })
  const processDecision = async (
    decision: Parameters<typeof readinessActions.processDecision>[0],
  ) => readinessActions.processDecision(decision)

  const drainDecisionSource = async (inputValue: {
    maxProcessed?: number
    pickNextDecision: (input: {
      runRoles?: readonly RunRole[]
      kinds?: readonly ReadinessDecision['kind'][]
      mode?: 'startup' | 'worker'
      now: string
      skipKeys?: ReadonlySet<string>
    }) => Result<Parameters<typeof readinessActions.processDecision>[0] | null, DomainError>
    options?: {
      runRoles?: readonly RunRole[]
      kinds?: readonly ReadinessDecision['kind'][]
      mode?: 'startup' | 'worker'
    }
  }): Promise<number> => {
    let processedCount = 0
    const maxProcessed = inputValue.maxProcessed ?? 100

    for (let index = 0; index < maxProcessed; index += 1) {
      const skippedKeys = new Set<string>()

      while (true) {
        const pickedDecision = inputValue.pickNextDecision({
          runRoles: inputValue.options?.runRoles,
          kinds: inputValue.options?.kinds,
          mode: inputValue.options?.mode,
          now: input.services.clock.nowIso(),
          skipKeys: skippedKeys,
        })

        if (!pickedDecision.ok) {
          throw new Error(pickedDecision.error.message)
        }

        if (!pickedDecision.value) {
          return processedCount
        }

        const progressed = await processDecision(pickedDecision.value)

        if (progressed) {
          processedCount += 1
          break
        }

        skippedKeys.add(readinessDecisionKey(pickedDecision.value))
      }
    }

    return processedCount
  }

  const processOneDecision = async (): Promise<boolean> =>
    (await drainDecisionSource({
      maxProcessed: 1,
      pickNextDecision: readinessEngine.pickNextDecision,
    })) > 0

  const processAvailableDecisions = async (): Promise<boolean> =>
    (await drainDecisionSource({
      pickNextDecision: readinessEngine.pickNextDecision,
    })) > 0

  const reconcileDecisions = async (inputValue?: {
    runRoles?: readonly RunRole[]
    kinds?: readonly ReadinessDecision['kind'][]
    mode?: 'startup' | 'worker'
  }): Promise<Result<number, DomainError>> => {
    try {
      const mode = inputValue?.mode ?? 'worker'
      const processedCount = await drainDecisionSource({
        pickNextDecision: readinessEngine.pickNextDecision,
        options: {
          runRoles: inputValue?.runRoles,
          kinds: inputValue?.kinds,
          mode,
        },
      })

      if (processedCount > 0) {
        logger.warn('Processed multiagent decisions', {
          runRoles: inputValue?.runRoles,
          kinds: inputValue?.kinds,
          mode,
          processedCount,
        })
      }

      return ok(processedCount)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown decision reconciliation failure'

      return err({
        message: `failed to reconcile multiagent decisions: ${message}`,
        type: 'conflict',
      })
    }
  }

  const lifecycle = createPollingWorker<boolean>({
    computeNextDelay: ({ result, wakeRequested }) =>
      wakeRequested || result ? 0 : input.config.multiagent.worker.pollIntervalMs,
    onError: (error) => {
      logger.error('Unhandled multiagent worker failure', {
        message: error instanceof Error ? error.message : 'Unknown worker failure',
      })
    },
    runOnce: processAvailableDecisions,
    supportsWake: true,
  })

  return {
    processAvailableDecisions,
    processOneDecision,
    reconcileDecisions,
    start: lifecycle.start,
    stop: lifecycle.stop,
    wake: lifecycle.wake,
  }
}
