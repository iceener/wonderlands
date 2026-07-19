import type { LangfuseExporter } from '../../adapters/observability/langfuse/exporter'
import type { AppConfig } from '../../app/config'
import type { RepositoryDatabase } from '../../db/repository-database'
import type { EventOutboxRecord } from '../../domain/events/event-outbox-repository'
import type { DomainError } from '../../shared/errors'
import type { AppLogger } from '../../shared/logger'
import { ok, type Result } from '../../shared/result'
import type { Clock } from '../../shared/time'
import { createEventOutboxRepository } from '../persistence/repositories'
import { createPollingWorker } from '../polling-worker'
import { type BackgroundDispatchRuntime, dispatchBackgroundEvent } from './background-dispatcher'
import { dispatchLangfuseEvent } from './langfuse-dispatcher'
import { dispatchProjectionEvent, type ProjectionDispatchRuntime } from './projection-dispatcher'
import type { RealtimeEventRelay } from './realtime-relay'

export interface EventOutboxWorker {
  processOnce: () => Promise<boolean>
  reconcileProcessingEntries: () => Result<number, DomainError>
  start: () => void
  stop: () => Promise<void>
  wake: () => void
}

interface EventOutboxDispatcherContext {
  backgroundRuntime: BackgroundDispatchRuntime
  observability: {
    langfuse: LangfuseExporter
  }
  projectionRuntime: ProjectionDispatchRuntime
  realtime: RealtimeEventRelay
}

type EventOutboxDispatcher = (
  entry: EventOutboxRecord,
  context: EventOutboxDispatcherContext,
) => Promise<Result<null, DomainError>> | Result<null, DomainError>

interface EventOutboxLane {
  processOnce: () => Promise<boolean>
  start: () => void
  stop: () => Promise<void>
  wake: () => void
}

const PROCESS_BATCH_LIMIT = 100
const RETRY_DELAY_MS = 1_000
const WAIT_TIMEOUT_MS = 30_000
const OBSERVABILITY_MAX_RETRY_ATTEMPTS = 3
const RECOVERED_PROCESSING_ERROR =
  'Recovered abandoned processing outbox entry during startup reconciliation'

const addMilliseconds = (value: string, milliseconds: number): string =>
  new Date(Date.parse(value) + milliseconds).toISOString()

const shouldQuarantineObservabilityFailure = (
  entry: EventOutboxRecord,
  error: DomainError,
): boolean => {
  if (entry.topic !== 'observability') {
    return false
  }

  if (error.type === 'validation') {
    return true
  }

  if (error.type === 'provider' && error.provider === 'langfuse' && error.retryable === false) {
    return true
  }

  return entry.attempts >= OBSERVABILITY_MAX_RETRY_ATTEMPTS
}

const createDispatchers = (): Record<string, EventOutboxDispatcher> => ({
  background: (entry, context) => dispatchBackgroundEvent(context.backgroundRuntime, entry),
  observability: (entry, context) => dispatchLangfuseEvent(context.observability.langfuse, entry),
  projection: (entry, context) => dispatchProjectionEvent(context.projectionRuntime, entry),
  realtime: (entry, context) => {
    context.realtime.publish(entry.event)
    return ok(null)
  },
})

const createEventOutboxLane = (input: {
  backgroundRuntime: BackgroundDispatchRuntime
  config: AppConfig
  db: RepositoryDatabase
  dispatchers: Record<string, EventOutboxDispatcher>
  filters?: {
    excludeTopics?: readonly string[]
    includeTopics?: readonly string[]
  }
  lane: string
  logger: AppLogger
  observability: {
    langfuse: LangfuseExporter
  }
  projectionRuntime: ProjectionDispatchRuntime
  realtime: RealtimeEventRelay
  clock: Clock
}): EventOutboxLane => {
  const repository = createEventOutboxRepository(input.db)
  const logger = input.logger.child({
    lane: input.lane,
    subsystem: 'event_outbox_worker',
  })
  const dispatchOne = async (): Promise<boolean> => {
    const now = input.clock.nowIso()
    const claimed = repository.claimNext(now, input.filters)

    if (!claimed.ok) {
      logger.warn('Failed to claim event outbox entry', {
        message: claimed.error.message,
      })
      return false
    }

    if (!claimed.value) {
      return false
    }

    const dispatcher = input.dispatchers[claimed.value.topic]

    if (!dispatcher) {
      const retried = repository.retry({
        availableAt: addMilliseconds(now, RETRY_DELAY_MS),
        id: claimed.value.id,
        lastError: `No outbox dispatcher is registered for topic "${claimed.value.topic}"`,
      })

      if (!retried.ok) {
        logger.warn('Failed to retry unhandled outbox entry', {
          message: retried.error.message,
          outboxId: claimed.value.id,
          topic: claimed.value.topic,
        })
      }

      return true
    }

    const dispatched = await dispatcher(claimed.value, {
      backgroundRuntime: input.backgroundRuntime,
      observability: input.observability,
      projectionRuntime: input.projectionRuntime,
      realtime: input.realtime,
    })

    if (!dispatched.ok) {
      if (shouldQuarantineObservabilityFailure(claimed.value, dispatched.error)) {
        const quarantined = repository.quarantine({
          id: claimed.value.id,
          lastError: dispatched.error.message,
          processedAt: input.clock.nowIso(),
        })

        if (!quarantined.ok) {
          logger.warn('Failed to quarantine outbox entry after dispatcher error', {
            attempts: claimed.value.attempts,
            message: quarantined.error.message,
            outboxId: claimed.value.id,
            topic: claimed.value.topic,
          })
        } else {
          logger.warn('Quarantined outbox entry after dispatcher error', {
            attempts: claimed.value.attempts,
            message: dispatched.error.message,
            outboxId: claimed.value.id,
            topic: claimed.value.topic,
          })
        }

        return true
      }

      const retried = repository.retry({
        availableAt: addMilliseconds(now, RETRY_DELAY_MS),
        id: claimed.value.id,
        lastError: dispatched.error.message,
      })

      if (!retried.ok) {
        logger.warn('Failed to retry outbox entry after dispatcher error', {
          message: retried.error.message,
          outboxId: claimed.value.id,
          topic: claimed.value.topic,
        })
      }

      return true
    }

    const completed = repository.complete({
      id: claimed.value.id,
      processedAt: input.clock.nowIso(),
    })

    if (!completed.ok) {
      logger.warn('Failed to finalize processed outbox entry', {
        message: completed.error.message,
        outboxId: claimed.value.id,
        topic: claimed.value.topic,
      })
    }

    return true
  }

  const processOnce = async (): Promise<boolean> => {
    let madeProgress = false

    for (let index = 0; index < PROCESS_BATCH_LIMIT; index += 1) {
      const processed = await dispatchOne()

      if (!processed) {
        break
      }

      madeProgress = true
    }

    return madeProgress
  }

  const lifecycle = createPollingWorker<boolean>({
    computeNextDelay: ({ result, wakeRequested }) =>
      wakeRequested || result
        ? 0
        : Math.min(input.config.multiagent.worker.pollIntervalMs, WAIT_TIMEOUT_MS),
    onError: (error) => {
      logger.error('Unhandled event outbox worker failure', {
        message: error instanceof Error ? error.message : 'Unknown event outbox worker failure',
      })
    },
    runOnce: processOnce,
    supportsWake: true,
  })

  return {
    processOnce,
    start: lifecycle.start,
    stop: lifecycle.stop,
    wake: lifecycle.wake,
  }
}

const createLaneBackedEventOutboxWorker = (input: {
  backgroundRuntime: BackgroundDispatchRuntime
  config: AppConfig
  db: RepositoryDatabase
  lanes: EventOutboxLane[]
  logger: AppLogger
  observability: {
    langfuse: LangfuseExporter
  }
  projectionRuntime: ProjectionDispatchRuntime
  realtime: RealtimeEventRelay
  clock: Clock
}): EventOutboxWorker => {
  const repository = createEventOutboxRepository(input.db)
  const logger = input.logger.child({
    subsystem: 'event_outbox_worker',
  })

  const reconcileProcessingEntries = (): Result<number, DomainError> => {
    const recovered = repository.recoverProcessing({
      availableAt: input.clock.nowIso(),
      lastError: RECOVERED_PROCESSING_ERROR,
    })

    if (recovered.ok && recovered.value > 0) {
      logger.warn('Recovered abandoned processing outbox entries', {
        recoveredCount: recovered.value,
      })
    }

    return recovered
  }

  return {
    processOnce: async () => {
      const results = await Promise.all(input.lanes.map((lane) => lane.processOnce()))
      return results.some(Boolean)
    },
    reconcileProcessingEntries,
    start: () => {
      for (const lane of input.lanes) {
        lane.start()
      }
    },
    stop: async () => {
      await Promise.all(input.lanes.map((lane) => lane.stop()))
    },
    wake: () => {
      for (const lane of input.lanes) {
        lane.wake()
      }
    },
  }
}

export const createEventOutboxWorker = (input: {
  backgroundRuntime: BackgroundDispatchRuntime
  config: AppConfig
  db: RepositoryDatabase
  logger: AppLogger
  observability: {
    langfuse: LangfuseExporter
  }
  projectionRuntime: ProjectionDispatchRuntime
  realtime: RealtimeEventRelay
  clock: Clock
}): EventOutboxWorker => {
  const dispatchers = createDispatchers()

  return createLaneBackedEventOutboxWorker({
    ...input,
    lanes: [
      createEventOutboxLane({
        ...input,
        dispatchers,
        filters: {
          includeTopics: ['realtime'],
        },
        lane: 'realtime',
      }),
      createEventOutboxLane({
        ...input,
        dispatchers,
        filters: {
          excludeTopics: ['observability', 'realtime'],
        },
        lane: 'durable',
      }),
    ],
  })
}

export const createObservabilityOutboxWorker = (input: {
  backgroundRuntime: BackgroundDispatchRuntime
  config: AppConfig
  db: RepositoryDatabase
  logger: AppLogger
  observability: {
    langfuse: LangfuseExporter
  }
  projectionRuntime: ProjectionDispatchRuntime
  realtime: RealtimeEventRelay
  clock: Clock
}): EventOutboxWorker => {
  const dispatchers = createDispatchers()

  return createLaneBackedEventOutboxWorker({
    ...input,
    lanes: [
      createEventOutboxLane({
        ...input,
        dispatchers,
        filters: {
          includeTopics: ['observability'],
        },
        lane: 'observability',
      }),
    ],
  })
}
