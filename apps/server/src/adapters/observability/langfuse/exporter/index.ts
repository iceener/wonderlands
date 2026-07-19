import { LangfuseAPIClient } from '@langfuse/core'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { propagateAttributes, setLangfuseTracerProvider } from '@langfuse/tracing'
import type { TracerProvider } from '@opentelemetry/api'
import { NodeSDK } from '@opentelemetry/sdk-node'
import type { SpanExporter } from '@opentelemetry/sdk-trace-base'
import type { EventOutboxRecord } from '../../../../domain/events/event-outbox-repository'
import type { DomainError } from '../../../../shared/errors'
import type { AppLogger } from '../../../../shared/logger'
import { err, ok, type Result } from '../../../../shared/result'
import type { RepositoryDatabase } from '../../../persistence/sqlite/repository-database'
import { toLangfuseProviderError } from './errors'
import { DeterministicIdGenerator } from './ids'
import { normalizeBaseUrl } from './normalization'
import { exportRunObservation } from './otel-emission'
import { appendScores } from './scoring'
import { collectObservationKeys, isTerminalRootRunEvent } from './snapshot/run-events'
import { loadTraceSnapshot } from './snapshot/trace-snapshot'

export interface LangfuseExporterConfig {
  baseUrl: string | null
  enabled: boolean
  environment: string
  publicKey: string | null
  secretKey: string | null
  timeoutMs: number
}

export interface LangfuseExporter {
  enabled: boolean
  environment: string
  exportOutboxEntry: (entry: EventOutboxRecord) => Promise<Result<null, DomainError>>
  shutdown: () => Promise<void>
}

export const createLangfuseExporter = (input: {
  config: LangfuseExporterConfig
  db: RepositoryDatabase
  logger: AppLogger
  spanExporter?: SpanExporter
}): LangfuseExporter => {
  if (
    !input.config.enabled ||
    !input.config.baseUrl ||
    !input.config.publicKey ||
    !input.config.secretKey
  ) {
    return {
      enabled: false,
      environment: input.config.environment,
      exportOutboxEntry: async () => ok(null),
      shutdown: async () => {},
    }
  }

  const logger = input.logger.child({
    subsystem: 'langfuse_exporter',
  })
  const idGenerator = new DeterministicIdGenerator()
  const processor = new LangfuseSpanProcessor({
    baseUrl: normalizeBaseUrl(input.config.baseUrl),
    environment: input.config.environment,
    ...(input.spanExporter ? { exporter: input.spanExporter } : {}),
    exportMode: 'immediate',
    publicKey: input.config.publicKey,
    secretKey: input.config.secretKey,
    timeout: Math.max(1, Math.ceil(input.config.timeoutMs / 1000)),
  })
  const sdk = new NodeSDK({
    autoDetectResources: false,
    idGenerator,
    instrumentations: [],
    serviceName: '05_04_api',
    spanProcessors: [processor],
  })

  sdk.start()
  const tracerProvider = Reflect.get(sdk, '_tracerProvider') as TracerProvider | null
  setLangfuseTracerProvider(tracerProvider)

  const apiClient = new LangfuseAPIClient({
    baseUrl: () => normalizeBaseUrl(input.config.baseUrl!),
    environment: () => input.config.environment,
    password: () => input.config.secretKey!,
    username: () => input.config.publicKey!,
    xLangfuseSdkName: () => '05_04_api',
    xLangfuseSdkVersion: () => 'local',
  })

  let exportQueue = Promise.resolve()

  const serializeExport = async <TValue>(fn: () => Promise<TValue>): Promise<TValue> => {
    const next = exportQueue.then(fn, fn)
    exportQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  return {
    enabled: true,
    environment: input.config.environment,
    exportOutboxEntry: async (entry) =>
      serializeExport(async () => {
        if (!isTerminalRootRunEvent(entry)) {
          return ok(null)
        }

        const trace = loadTraceSnapshot(input.db, entry, logger)

        if (!trace.ok) {
          return trace
        }

        const observationKeys = collectObservationKeys(trace.value.rootRun)

        idGenerator.begin(trace.value.traceKey, observationKeys)

        try {
          await propagateAttributes(
            {
              ...(trace.value.metadata ? { metadata: trace.value.metadata } : {}),
              ...(trace.value.name ? { traceName: trace.value.name } : {}),
              ...(trace.value.sessionId ? { sessionId: trace.value.sessionId } : {}),
              ...(trace.value.tags ? { tags: trace.value.tags } : {}),
              ...(trace.value.userId ? { userId: trace.value.userId } : {}),
            },
            async () => {
              exportRunObservation(trace.value.rootRun)
            },
          )

          await processor.forceFlush()

          const scores = await appendScores({
            apiClient,
            environment: input.config.environment,
            timeoutMs: input.config.timeoutMs,
            trace: trace.value,
          })

          if (!scores.ok) {
            return scores
          }

          return ok(null)
        } catch (error) {
          return err(toLangfuseProviderError('Langfuse OTEL export failed', error))
        } finally {
          idGenerator.end()
        }
      }),
    shutdown: async () => {
      await serializeExport(async () => {
        await processor.forceFlush()
        await sdk.shutdown()
        setLangfuseTracerProvider(null)
      })
    },
  }
}
