import { and, asc, eq, inArray, lte, notInArray, or, sql } from 'drizzle-orm'

import { domainEvents, eventOutbox } from '../../../../db/schema'
import type {
  ClaimNextEventOutboxFilters,
  CompleteEventOutboxInput,
  EnqueueReplayInput,
  EventOutboxBacklogSnapshot,
  EventOutboxQuarantineTopicStats,
  EventOutboxRecord,
  EventOutboxRepository,
  EventOutboxReplayRecord,
  GetQuarantinedEventOutboxByIdInput,
  InspectEventOutboxBacklogInput,
  InspectEventOutboxQuarantineInput,
  ListQuarantinedEventOutboxInput,
  QuarantineEventOutboxInput,
  RecoverProcessingEventOutboxInput,
  ReplayQuarantinedEventOutboxInput,
  RetryEventOutboxInput,
} from '../../../../domain/events/event-outbox-repository'
import type { DomainError } from '../../../../shared/errors'
import { asAccountId, asEventId, asTenantId, createPrefixedId } from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { RepositoryDatabase } from '../repository-database'
import { createEventPayloadSidecarRepository } from './event-payload-sidecar-repository'
import { hydrateStoredEventPayload } from '../../../../domain/events/event-payload-sidecar-repository'

const toOutboxRecord = (
  row: {
    attempts: number
    availableAt: string
    createdAt: string
    eventActorAccountId: string | null
    eventAggregateId: string
    eventAggregateType: string
    eventCategory: 'domain' | 'telemetry'
    eventCausationId: string | null
    eventCreatedAt: string
    eventEventNo: number
    eventId: string
    eventPayload: unknown
    eventTenantId: string | null
    eventTraceId: string | null
    eventType: string
    lastError: string | null
    outboxId: string
    processedAt: string | null
    status: typeof eventOutbox.$inferSelect.status
    topic: string
  },
  sidecarPayload?: Record<string, unknown> | null,
): EventOutboxRecord => ({
  attempts: row.attempts,
  availableAt: row.availableAt,
  createdAt: row.createdAt,
  event: {
    actorAccountId: row.eventActorAccountId ? asAccountId(row.eventActorAccountId) : undefined,
    aggregateId: row.eventAggregateId,
    aggregateType: row.eventAggregateType,
    category: row.eventCategory,
    causationId: row.eventCausationId ?? undefined,
    createdAt: row.eventCreatedAt,
    eventNo: row.eventEventNo,
    id: asEventId(row.eventId),
    payload: hydrateStoredEventPayload(row.eventPayload, sidecarPayload),
    tenantId: row.eventTenantId ? asTenantId(row.eventTenantId) : undefined,
    traceId: row.eventTraceId ?? undefined,
    type: row.eventType,
  },
  eventId: asEventId(row.eventId),
  id: row.outboxId,
  lastError: row.lastError,
  processedAt: row.processedAt,
  status: row.status,
  tenantId: row.eventTenantId ? asTenantId(row.eventTenantId) : undefined,
  topic: row.topic,
})

export const createEventOutboxRepository = (db: RepositoryDatabase): EventOutboxRepository => ({
  enqueueReplay: (input: EnqueueReplayInput): Result<EventOutboxReplayRecord, DomainError> => {
    try {
      const whereClauses = [
        eq(eventOutbox.eventId, input.eventId),
        eq(eventOutbox.topic, input.topic),
      ]

      if (input.tenantId) {
        whereClauses.push(eq(eventOutbox.tenantId, input.tenantId))
      }

      const existing = db
        .select({
          id: eventOutbox.id,
          status: eventOutbox.status,
        })
        .from(eventOutbox)
        .where(and(...whereClauses))
        .get()

      if (!existing) {
        const id = createPrefixedId('obx')

        db.insert(eventOutbox)
          .values({
            attempts: 0,
            availableAt: input.availableAt,
            createdAt: input.availableAt,
            eventId: input.eventId,
            id,
            lastError: null,
            processedAt: null,
            status: 'pending',
            tenantId: input.tenantId,
            topic: input.topic,
          })
          .run()

        return ok({
          id,
          status: 'pending',
          topic: input.topic,
        })
      }

      if (existing.status === 'processing') {
        return ok({
          id: existing.id,
          status: 'processing',
          topic: input.topic,
        })
      }

      db.update(eventOutbox)
        .set({
          attempts: 0,
          availableAt: input.availableAt,
          lastError: null,
          processedAt: null,
          status: 'pending',
        })
        .where(and(eq(eventOutbox.id, existing.id), eq(eventOutbox.topic, input.topic)))
        .run()

      return ok({
        id: existing.id,
        status: 'pending',
        topic: input.topic,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown event outbox replay enqueue failure'

      return err({
        message: `failed to enqueue replay for event ${input.eventId}: ${message}`,
        type: 'conflict',
      })
    }
  },
  claimNext: (
    now: string,
    filters?: ClaimNextEventOutboxFilters,
  ): Result<EventOutboxRecord | null, DomainError> => {
    try {
      const whereClauses = [
        or(eq(eventOutbox.status, 'pending'), eq(eventOutbox.status, 'failed')),
        lte(eventOutbox.availableAt, now),
      ]

      if (filters?.includeTopics && filters.includeTopics.length > 0) {
        whereClauses.push(inArray(eventOutbox.topic, [...filters.includeTopics]))
      }

      if (filters?.excludeTopics && filters.excludeTopics.length > 0) {
        whereClauses.push(notInArray(eventOutbox.topic, [...filters.excludeTopics]))
      }

      const candidates = db
        .select({
          attempts: eventOutbox.attempts,
          availableAt: eventOutbox.availableAt,
          createdAt: eventOutbox.createdAt,
          eventActorAccountId: domainEvents.actorAccountId,
          eventAggregateId: domainEvents.aggregateId,
          eventAggregateType: domainEvents.aggregateType,
          eventCategory: domainEvents.category,
          eventCausationId: domainEvents.causationId,
          eventCreatedAt: domainEvents.createdAt,
          eventEventNo: domainEvents.eventNo,
          eventId: domainEvents.id,
          eventPayload: domainEvents.payload,
          eventTenantId: domainEvents.tenantId,
          eventTraceId: domainEvents.traceId,
          eventType: domainEvents.type,
          lastError: eventOutbox.lastError,
          outboxId: eventOutbox.id,
          processedAt: eventOutbox.processedAt,
          status: eventOutbox.status,
          topic: eventOutbox.topic,
        })
        .from(eventOutbox)
        .innerJoin(domainEvents, eq(eventOutbox.eventId, domainEvents.id))
        .where(and(...whereClauses))
        .orderBy(
          asc(domainEvents.eventNo),
          asc(eventOutbox.availableAt),
          asc(eventOutbox.createdAt),
          asc(eventOutbox.id),
        )
        .limit(25)
        .all()
      const sidecarPayloads = createEventPayloadSidecarRepository(db).listByEventIds(
        candidates.map((candidate) => candidate.eventId),
      )

      if (!sidecarPayloads.ok) {
        return err(sidecarPayloads.error)
      }

      for (const candidate of candidates) {
        const claimed = db
          .update(eventOutbox)
          .set({
            attempts: sql`${eventOutbox.attempts} + 1`,
            lastError: null,
            processedAt: null,
            status: 'processing',
          })
          .where(
            and(
              eq(eventOutbox.id, candidate.outboxId),
              eq(eventOutbox.status, candidate.status),
              lte(eventOutbox.availableAt, now),
            ),
          )
          .run()

        if (claimed.changes === 0) {
          continue
        }

        return ok(
          toOutboxRecord(
            {
              ...candidate,
              attempts: candidate.attempts + 1,
              lastError: null,
              processedAt: null,
              status: 'processing',
            },
            sidecarPayloads.value.get(candidate.eventId),
          ),
        )
      }

      return ok(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown event outbox claim failure'

      return err({
        message: `failed to claim event outbox entry: ${message}`,
        type: 'conflict',
      })
    }
  },
  complete: (input: CompleteEventOutboxInput): Result<null, DomainError> => {
    try {
      void input.processedAt

      const completed = db
        .delete(eventOutbox)
        .where(and(eq(eventOutbox.id, input.id), eq(eventOutbox.status, 'processing')))
        .run()

      if (completed.changes === 0) {
        return err({
          message: `event outbox entry ${input.id} is not currently processing`,
          type: 'conflict',
        })
      }

      return ok(null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown event outbox completion failure'

      return err({
        message: `failed to complete event outbox entry ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  retry: (input: RetryEventOutboxInput): Result<null, DomainError> => {
    try {
      const retried = db
        .update(eventOutbox)
        .set({
          availableAt: input.availableAt,
          lastError: input.lastError,
          processedAt: null,
          status: 'failed',
        })
        .where(and(eq(eventOutbox.id, input.id), eq(eventOutbox.status, 'processing')))
        .run()

      if (retried.changes === 0) {
        return err({
          message: `event outbox entry ${input.id} is not currently processing`,
          type: 'conflict',
        })
      }

      return ok(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown event outbox retry failure'

      return err({
        message: `failed to retry event outbox entry ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  recoverProcessing: (input: RecoverProcessingEventOutboxInput): Result<number, DomainError> => {
    try {
      const recovered = db
        .update(eventOutbox)
        .set({
          availableAt: input.availableAt,
          lastError: input.lastError,
          processedAt: null,
          status: 'failed',
        })
        .where(eq(eventOutbox.status, 'processing'))
        .run()

      return ok(recovered.changes)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown event outbox recovery failure'

      return err({
        message: `failed to recover processing event outbox entries: ${message}`,
        type: 'conflict',
      })
    }
  },
  quarantine: (input: QuarantineEventOutboxInput): Result<null, DomainError> => {
    try {
      const quarantined = db
        .update(eventOutbox)
        .set({
          lastError: input.lastError,
          processedAt: input.processedAt,
          status: 'quarantined',
        })
        .where(and(eq(eventOutbox.id, input.id), eq(eventOutbox.status, 'processing')))
        .run()

      if (quarantined.changes === 0) {
        return err({
          message: `event outbox entry ${input.id} is not currently processing`,
          type: 'conflict',
        })
      }

      return ok(null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown event outbox quarantine failure'

      return err({
        message: `failed to quarantine event outbox entry ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  getQuarantinedById: (
    input: GetQuarantinedEventOutboxByIdInput,
  ): Result<EventOutboxRecord | null, DomainError> => {
    try {
      const whereClauses = [eq(eventOutbox.id, input.id), eq(eventOutbox.status, 'quarantined')]

      if (input.tenantId) {
        whereClauses.push(eq(eventOutbox.tenantId, input.tenantId))
      }

      const row = db
        .select({
          attempts: eventOutbox.attempts,
          availableAt: eventOutbox.availableAt,
          createdAt: eventOutbox.createdAt,
          eventActorAccountId: domainEvents.actorAccountId,
          eventAggregateId: domainEvents.aggregateId,
          eventAggregateType: domainEvents.aggregateType,
          eventCategory: domainEvents.category,
          eventCausationId: domainEvents.causationId,
          eventCreatedAt: domainEvents.createdAt,
          eventEventNo: domainEvents.eventNo,
          eventId: domainEvents.id,
          eventPayload: domainEvents.payload,
          eventTenantId: domainEvents.tenantId,
          eventTraceId: domainEvents.traceId,
          eventType: domainEvents.type,
          lastError: eventOutbox.lastError,
          outboxId: eventOutbox.id,
          processedAt: eventOutbox.processedAt,
          status: eventOutbox.status,
          topic: eventOutbox.topic,
        })
        .from(eventOutbox)
        .innerJoin(domainEvents, eq(eventOutbox.eventId, domainEvents.id))
        .where(and(...whereClauses))
        .get()

      return ok(row ? toOutboxRecord(row) : null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown quarantined event outbox lookup failure'

      return err({
        message: `failed to load quarantined event outbox entry ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  listQuarantined: (
    input?: ListQuarantinedEventOutboxInput,
  ): Result<EventOutboxRecord[], DomainError> => {
    try {
      const whereClauses = [eq(eventOutbox.status, 'quarantined')]

      if (input?.tenantId) {
        whereClauses.push(eq(eventOutbox.tenantId, input.tenantId))
      }

      if (input?.includeTopics && input.includeTopics.length > 0) {
        whereClauses.push(inArray(eventOutbox.topic, [...input.includeTopics]))
      }

      const rows = db
        .select({
          attempts: eventOutbox.attempts,
          availableAt: eventOutbox.availableAt,
          createdAt: eventOutbox.createdAt,
          eventActorAccountId: domainEvents.actorAccountId,
          eventAggregateId: domainEvents.aggregateId,
          eventAggregateType: domainEvents.aggregateType,
          eventCategory: domainEvents.category,
          eventCausationId: domainEvents.causationId,
          eventCreatedAt: domainEvents.createdAt,
          eventEventNo: domainEvents.eventNo,
          eventId: domainEvents.id,
          eventPayload: domainEvents.payload,
          eventTenantId: domainEvents.tenantId,
          eventTraceId: domainEvents.traceId,
          eventType: domainEvents.type,
          lastError: eventOutbox.lastError,
          outboxId: eventOutbox.id,
          processedAt: eventOutbox.processedAt,
          status: eventOutbox.status,
          topic: eventOutbox.topic,
        })
        .from(eventOutbox)
        .innerJoin(domainEvents, eq(eventOutbox.eventId, domainEvents.id))
        .where(and(...whereClauses))
        .orderBy(
          asc(eventOutbox.processedAt),
          asc(domainEvents.eventNo),
          asc(eventOutbox.createdAt),
          asc(eventOutbox.id),
        )
        .all()

      return ok(rows.map((row) => toOutboxRecord(row)))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown quarantined event outbox listing failure'

      return err({
        message: `failed to list quarantined event outbox entries: ${message}`,
        type: 'conflict',
      })
    }
  },
  replayQuarantined: (input: ReplayQuarantinedEventOutboxInput): Result<null, DomainError> => {
    try {
      const whereClauses = [eq(eventOutbox.id, input.id), eq(eventOutbox.status, 'quarantined')]

      if (input.tenantId) {
        whereClauses.push(eq(eventOutbox.tenantId, input.tenantId))
      }

      const replayed = db
        .update(eventOutbox)
        .set({
          attempts: 0,
          availableAt: input.availableAt,
          lastError: null,
          processedAt: null,
          status: 'pending',
        })
        .where(and(...whereClauses))
        .run()

      if (replayed.changes === 0) {
        return err({
          message: `event outbox entry ${input.id} is not quarantined`,
          type: 'not_found',
        })
      }

      return ok(null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown quarantined event outbox replay failure'

      return err({
        message: `failed to replay quarantined event outbox entry ${input.id}: ${message}`,
        type: 'conflict',
      })
    }
  },
  inspectBacklog: (
    input?: InspectEventOutboxBacklogInput,
  ): Result<EventOutboxBacklogSnapshot, DomainError> => {
    try {
      const whereClauses = [inArray(eventOutbox.status, ['pending', 'processing', 'failed'])]

      if (input?.tenantId) {
        whereClauses.push(eq(eventOutbox.tenantId, input.tenantId))
      }

      if (input?.includeTopics && input.includeTopics.length > 0) {
        whereClauses.push(inArray(eventOutbox.topic, [...input.includeTopics]))
      }

      const where = and(...whereClauses)

      const topics = db
        .select({
          failedCount: sql<number>`coalesce(sum(case when ${eventOutbox.status} = 'failed' then 1 else 0 end), 0)`,
          oldestFailedAvailableAt: sql<
            string | null
          >`min(case when ${eventOutbox.status} = 'failed' then ${eventOutbox.availableAt} end)`,
          oldestFailedCreatedAt: sql<
            string | null
          >`min(case when ${eventOutbox.status} = 'failed' then ${eventOutbox.createdAt} end)`,
          oldestPendingAvailableAt: sql<
            string | null
          >`min(case when ${eventOutbox.status} = 'pending' then ${eventOutbox.availableAt} end)`,
          oldestPendingCreatedAt: sql<
            string | null
          >`min(case when ${eventOutbox.status} = 'pending' then ${eventOutbox.createdAt} end)`,
          oldestProcessingCreatedAt: sql<
            string | null
          >`min(case when ${eventOutbox.status} = 'processing' then ${eventOutbox.createdAt} end)`,
          pendingCount: sql<number>`coalesce(sum(case when ${eventOutbox.status} = 'pending' then 1 else 0 end), 0)`,
          processingCount: sql<number>`coalesce(sum(case when ${eventOutbox.status} = 'processing' then 1 else 0 end), 0)`,
          topic: eventOutbox.topic,
        })
        .from(eventOutbox)
        .where(where)
        .groupBy(eventOutbox.topic)
        .orderBy(asc(eventOutbox.topic))
        .all()

      const retryBuckets = db
        .select({
          attempts: eventOutbox.attempts,
          count: sql<number>`count(*)`,
          topic: eventOutbox.topic,
        })
        .from(eventOutbox)
        .where(where)
        .groupBy(eventOutbox.topic, eventOutbox.attempts)
        .orderBy(asc(eventOutbox.topic), asc(eventOutbox.attempts))
        .all()

      return ok({
        retryBuckets,
        topics,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown event outbox backlog inspection failure'

      return err({
        message: `failed to inspect event outbox backlog: ${message}`,
        type: 'conflict',
      })
    }
  },
  inspectQuarantine: (
    input?: InspectEventOutboxQuarantineInput,
  ): Result<EventOutboxQuarantineTopicStats[], DomainError> => {
    try {
      const whereClauses = [eq(eventOutbox.status, 'quarantined')]

      if (input?.tenantId) {
        whereClauses.push(eq(eventOutbox.tenantId, input.tenantId))
      }

      if (input?.includeTopics && input.includeTopics.length > 0) {
        whereClauses.push(inArray(eventOutbox.topic, [...input.includeTopics]))
      }

      const rows = db
        .select({
          oldestQuarantinedAt: sql<string | null>`min(${eventOutbox.processedAt})`,
          quarantinedCount: sql<number>`count(*)`,
          topic: eventOutbox.topic,
        })
        .from(eventOutbox)
        .where(and(...whereClauses))
        .groupBy(eventOutbox.topic)
        .orderBy(asc(eventOutbox.topic))
        .all()

      return ok(rows)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown quarantined event outbox inspection failure'

      return err({
        message: `failed to inspect quarantined event outbox entries: ${message}`,
        type: 'conflict',
      })
    }
  },
})
