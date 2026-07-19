import type { AppConfig } from '../../app/config'
import type { RepositoryDatabase } from '../../db/repository-database'
import type { EventOutboxTopic } from '../../domain/events/committed-event-contract'
import { createEventOutboxRepository } from '../persistence/repositories'
import type { DomainError } from '../../shared/errors'
import { ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export type ObservabilityWorkerName = 'events' | 'observability'
export type ObservabilityWorkerLane = 'durable' | 'observability' | 'realtime'

export interface ObservabilityRetryBucket {
  attempts: number
  count: number
}

export interface ObservabilityTopicStatus {
  backlogCount: number
  failedCount: number
  lane: ObservabilityWorkerLane
  oldestFailedAvailableAt: string | null
  oldestFailedCreatedAt: string | null
  oldestPendingAvailableAt: string | null
  oldestPendingCreatedAt: string | null
  oldestProcessingCreatedAt: string | null
  oldestQuarantinedAt: string | null
  pendingCount: number
  processingCount: number
  quarantinedCount: number
  retryCountDistribution: ObservabilityRetryBucket[]
  topic: EventOutboxTopic
  worker: ObservabilityWorkerName
}

export interface ObservabilityWorkerStatus {
  backlogCount: number
  failedCount: number
  lanes: ObservabilityWorkerLane[]
  oldestFailedAvailableAt: string | null
  oldestFailedCreatedAt: string | null
  oldestPendingAvailableAt: string | null
  oldestPendingCreatedAt: string | null
  oldestProcessingCreatedAt: string | null
  oldestQuarantinedAt: string | null
  pendingCount: number
  processingCount: number
  quarantinedCount: number
  retryCountDistribution: ObservabilityRetryBucket[]
  topics: EventOutboxTopic[]
  worker: ObservabilityWorkerName
}

export interface ObservabilityStatusSnapshot {
  generatedAt: string
  langfuse: {
    baseUrl: string | null
    enabled: boolean
    environment: string
  }
  totals: {
    backlogCount: number
    failedCount: number
    pendingCount: number
    processingCount: number
    quarantinedCount: number
  }
  topics: ObservabilityTopicStatus[]
  workers: ObservabilityWorkerStatus[]
}

const CANONICAL_TOPICS = [
  'realtime',
  'projection',
  'background',
  'observability',
] as const satisfies readonly EventOutboxTopic[]

const resolveWorkerTarget = (
  topic: EventOutboxTopic,
): { lane: ObservabilityWorkerLane; worker: ObservabilityWorkerName } => {
  if (topic === 'observability') {
    return {
      lane: 'observability',
      worker: 'observability',
    }
  }

  if (topic === 'realtime') {
    return {
      lane: 'realtime',
      worker: 'events',
    }
  }

  return {
    lane: 'durable',
    worker: 'events',
  }
}

const minIsoTimestamp = (...values: Array<string | null | undefined>): string | null => {
  const filtered = values.filter((value): value is string => typeof value === 'string')

  if (filtered.length === 0) {
    return null
  }

  return filtered.reduce((oldest, value) => (value < oldest ? value : oldest))
}

const mergeRetryBuckets = (
  buckets: ReadonlyArray<ObservabilityRetryBucket>,
): ObservabilityRetryBucket[] => {
  const countsByAttempt = new Map<number, number>()

  for (const bucket of buckets) {
    countsByAttempt.set(bucket.attempts, (countsByAttempt.get(bucket.attempts) ?? 0) + bucket.count)
  }

  return [...countsByAttempt.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([attempts, count]) => ({ attempts, count }))
}

const emptyTopicStatus = (topic: EventOutboxTopic): ObservabilityTopicStatus => {
  const target = resolveWorkerTarget(topic)

  return {
    backlogCount: 0,
    failedCount: 0,
    lane: target.lane,
    oldestFailedAvailableAt: null,
    oldestFailedCreatedAt: null,
    oldestPendingAvailableAt: null,
    oldestPendingCreatedAt: null,
    oldestProcessingCreatedAt: null,
    oldestQuarantinedAt: null,
    pendingCount: 0,
    processingCount: 0,
    quarantinedCount: 0,
    retryCountDistribution: [],
    topic,
    worker: target.worker,
  }
}

const toWorkerStatuses = (
  topicStatuses: ReadonlyArray<ObservabilityTopicStatus>,
): ObservabilityWorkerStatus[] => {
  const grouped = new Map<ObservabilityWorkerName, ObservabilityTopicStatus[]>()

  for (const topicStatus of topicStatuses) {
    const existing = grouped.get(topicStatus.worker)

    if (existing) {
      existing.push(topicStatus)
      continue
    }

    grouped.set(topicStatus.worker, [topicStatus])
  }

  return (['events', 'observability'] as const).map((worker) => {
    const topics = grouped.get(worker) ?? []
    const lanes = [...new Set(topics.map((topic) => topic.lane))].sort()

    return {
      backlogCount: topics.reduce((total, topic) => total + topic.backlogCount, 0),
      failedCount: topics.reduce((total, topic) => total + topic.failedCount, 0),
      lanes,
      oldestFailedAvailableAt: minIsoTimestamp(
        ...topics.map((topic) => topic.oldestFailedAvailableAt),
      ),
      oldestFailedCreatedAt: minIsoTimestamp(...topics.map((topic) => topic.oldestFailedCreatedAt)),
      oldestPendingAvailableAt: minIsoTimestamp(
        ...topics.map((topic) => topic.oldestPendingAvailableAt),
      ),
      oldestPendingCreatedAt: minIsoTimestamp(
        ...topics.map((topic) => topic.oldestPendingCreatedAt),
      ),
      oldestProcessingCreatedAt: minIsoTimestamp(
        ...topics.map((topic) => topic.oldestProcessingCreatedAt),
      ),
      oldestQuarantinedAt: minIsoTimestamp(...topics.map((topic) => topic.oldestQuarantinedAt)),
      pendingCount: topics.reduce((total, topic) => total + topic.pendingCount, 0),
      processingCount: topics.reduce((total, topic) => total + topic.processingCount, 0),
      quarantinedCount: topics.reduce((total, topic) => total + topic.quarantinedCount, 0),
      retryCountDistribution: mergeRetryBuckets(
        topics.flatMap((topic) => topic.retryCountDistribution),
      ),
      topics: topics.map((topic) => topic.topic),
      worker,
    }
  })
}

export const buildObservabilityStatus = (input: {
  config: AppConfig
  db: RepositoryDatabase
  generatedAt: string
  tenantScope: TenantScope
}): Result<ObservabilityStatusSnapshot, DomainError> => {
  const backlog = createEventOutboxRepository(input.db).inspectBacklog({
    includeTopics: CANONICAL_TOPICS,
    tenantId: input.tenantScope.tenantId,
  })

  if (!backlog.ok) {
    return backlog
  }

  const quarantine = createEventOutboxRepository(input.db).inspectQuarantine({
    includeTopics: CANONICAL_TOPICS,
    tenantId: input.tenantScope.tenantId,
  })

  if (!quarantine.ok) {
    return quarantine
  }

  const retryBucketsByTopic = new Map<EventOutboxTopic, ObservabilityRetryBucket[]>()

  for (const bucket of backlog.value.retryBuckets) {
    if (!CANONICAL_TOPICS.includes(bucket.topic as EventOutboxTopic)) {
      continue
    }

    const topic = bucket.topic as EventOutboxTopic
    const existing = retryBucketsByTopic.get(topic)
    const normalized = {
      attempts: bucket.attempts,
      count: bucket.count,
    }

    if (existing) {
      existing.push(normalized)
      continue
    }

    retryBucketsByTopic.set(topic, [normalized])
  }

  const topicRowsByTopic = new Map(
    backlog.value.topics
      .filter((row): row is typeof row & { topic: EventOutboxTopic } =>
        CANONICAL_TOPICS.includes(row.topic as EventOutboxTopic),
      )
      .map((row) => [row.topic as EventOutboxTopic, row]),
  )
  const quarantineRowsByTopic = new Map(
    quarantine.value
      .filter((row): row is typeof row & { topic: EventOutboxTopic } =>
        CANONICAL_TOPICS.includes(row.topic as EventOutboxTopic),
      )
      .map((row) => [row.topic as EventOutboxTopic, row]),
  )

  const topics = CANONICAL_TOPICS.map((topic) => {
    const row = topicRowsByTopic.get(topic)
    const quarantinedRow = quarantineRowsByTopic.get(topic)

    if (!row) {
      return {
        ...emptyTopicStatus(topic),
        oldestQuarantinedAt: quarantinedRow?.oldestQuarantinedAt ?? null,
        quarantinedCount: quarantinedRow?.quarantinedCount ?? 0,
      }
    }

    const target = resolveWorkerTarget(topic)
    const retryCountDistribution = (retryBucketsByTopic.get(topic) ?? []).sort(
      (left, right) => left.attempts - right.attempts,
    )

    return {
      backlogCount: row.pendingCount + row.failedCount + row.processingCount,
      failedCount: row.failedCount,
      lane: target.lane,
      oldestFailedAvailableAt: row.oldestFailedAvailableAt,
      oldestFailedCreatedAt: row.oldestFailedCreatedAt,
      oldestPendingAvailableAt: row.oldestPendingAvailableAt,
      oldestPendingCreatedAt: row.oldestPendingCreatedAt,
      oldestProcessingCreatedAt: row.oldestProcessingCreatedAt,
      oldestQuarantinedAt: quarantinedRow?.oldestQuarantinedAt ?? null,
      pendingCount: row.pendingCount,
      processingCount: row.processingCount,
      quarantinedCount: quarantinedRow?.quarantinedCount ?? 0,
      retryCountDistribution,
      topic,
      worker: target.worker,
    }
  })

  const workers = toWorkerStatuses(topics)

  return ok({
    generatedAt: input.generatedAt,
    langfuse: {
      baseUrl: input.config.observability.langfuse.baseUrl,
      enabled: input.config.observability.langfuse.enabled,
      environment: input.config.observability.langfuse.environment,
    },
    totals: {
      backlogCount: topics.reduce((total, topic) => total + topic.backlogCount, 0),
      failedCount: topics.reduce((total, topic) => total + topic.failedCount, 0),
      pendingCount: topics.reduce((total, topic) => total + topic.pendingCount, 0),
      processingCount: topics.reduce((total, topic) => total + topic.processingCount, 0),
      quarantinedCount: topics.reduce((total, topic) => total + topic.quarantinedCount, 0),
    },
    topics,
    workers,
  })
}
