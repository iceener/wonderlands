import { and, asc, eq, gt, or, sql } from 'drizzle-orm'

import { domainEvents, eventOutbox } from '../../../../db/schema'
import { DEFAULT_REPLAY_EVENT_CATEGORY } from '../../../../domain/events/committed-event-contract'
import type { DomainEventEnvelope } from '../../../../domain/events/domain-event'
import type {
  AppendDomainEventRecordInput,
  DomainEventRepository,
  ListDomainEventsInput,
} from '../../../../domain/events/domain-event-repository'
import { hydrateStoredEventPayload } from '../../../../domain/events/event-payload-sidecar-repository'
import type { DomainError } from '../../../../shared/errors'
import { asAccountId, asEventId, asTenantId, createPrefixedId } from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import type { RepositoryDatabase } from '../repository-database'
import { createEventPayloadSidecarRepository } from './event-payload-sidecar-repository'

const jsonStringAt = (path: '$.runId' | '$.sessionId' | '$.threadId') =>
  sql<string | null>`json_extract(${domainEvents.payload}, ${path})`

export const createDomainEventRepository = (db: RepositoryDatabase): DomainEventRepository => ({
  append: (
    input: AppendDomainEventRecordInput,
  ): Result<DomainEventEnvelope<unknown>, DomainError> => {
    try {
      const sidecars = createEventPayloadSidecarRepository(db)
      const writeEvent = () => {
        db.insert(domainEvents)
          .values({
            actorAccountId: input.actorAccountId,
            aggregateId: input.aggregateId,
            aggregateType: input.aggregateType,
            category: input.category,
            causationId: input.causationId,
            createdAt: input.createdAt,
            eventNo: sql<number>`(select coalesce(max(${domainEvents.eventNo}), 0) + 1 from ${domainEvents})`,
            id: input.id,
            payload: input.primaryPayload,
            tenantId: input.tenantId,
            traceId: input.traceId,
            type: input.type,
          })
          .run()

        if (input.sidecarPayload) {
          const sidecarStored = sidecars.create({
            createdAt: input.createdAt,
            eventId: input.id,
            payload: input.sidecarPayload,
          })

          if (!sidecarStored.ok) {
            throw new Error(sidecarStored.error.message)
          }
        }

        if (input.outboxTopics.length > 0) {
          db.insert(eventOutbox)
            .values(
              input.outboxTopics.map((topic) => ({
                availableAt: input.createdAt,
                createdAt: input.createdAt,
                eventId: input.id,
                id: createPrefixedId('obx'),
                status: 'pending' as const,
                tenantId: input.tenantId,
                topic,
              })),
            )
            .run()
        }
      }

      if (db.sqlite) {
        db.sqlite.transaction(writeEvent)()
      } else {
        writeEvent()
      }

      return ok({
        actorAccountId: input.actorAccountId,
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        category: input.category,
        causationId: input.causationId,
        createdAt: input.createdAt,
        id: asEventId(input.id),
        payload: hydrateStoredEventPayload(input.primaryPayload, input.sidecarPayload ?? undefined),
        tenantId: input.tenantId,
        traceId: input.traceId,
        type: input.type,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown event write failure'

      return err({
        message: `failed to append domain event: ${message}`,
        type: 'conflict',
      })
    }
  },
  listAfterCursor: (
    scope: TenantScope,
    input: ListDomainEventsInput,
  ): Result<Array<DomainEventEnvelope<unknown> & { eventNo: number }>, DomainError> => {
    try {
      const conditions = [
        eq(domainEvents.tenantId, scope.tenantId),
        input.category && input.category !== 'all'
          ? eq(domainEvents.category, input.category)
          : input.category === 'all'
            ? undefined
            : eq(domainEvents.category, DEFAULT_REPLAY_EVENT_CATEGORY),
        input.cursor === undefined ? undefined : gt(domainEvents.eventNo, input.cursor),
        input.sessionId
          ? or(
              and(
                eq(domainEvents.aggregateType, 'work_session'),
                eq(domainEvents.aggregateId, input.sessionId),
              ),
              eq(jsonStringAt('$.sessionId'), input.sessionId),
            )
          : undefined,
        input.threadId
          ? or(
              and(
                eq(domainEvents.aggregateType, 'session_thread'),
                eq(domainEvents.aggregateId, input.threadId),
              ),
              eq(jsonStringAt('$.threadId'), input.threadId),
            )
          : undefined,
        input.runId
          ? or(
              and(eq(domainEvents.aggregateType, 'run'), eq(domainEvents.aggregateId, input.runId)),
              eq(jsonStringAt('$.runId'), input.runId),
            )
          : undefined,
      ]

      const query = db
        .select()
        .from(domainEvents)
        .where(and(...conditions))
        .orderBy(asc(domainEvents.eventNo))

      const rows = input.limit === undefined ? query.all() : query.limit(input.limit).all()
      const sidecarPayloads = createEventPayloadSidecarRepository(db).listByEventIds(
        rows.map((row) => row.id),
      )

      if (!sidecarPayloads.ok) {
        return err(sidecarPayloads.error)
      }

      return ok(
        rows.map((row) => ({
          actorAccountId: row.actorAccountId ? asAccountId(row.actorAccountId) : undefined,
          aggregateId: row.aggregateId,
          aggregateType: row.aggregateType,
          category: row.category,
          causationId: row.causationId ?? undefined,
          createdAt: row.createdAt,
          eventNo: row.eventNo,
          id: asEventId(row.id),
          payload: hydrateStoredEventPayload(row.payload, sidecarPayloads.value.get(row.id)),
          tenantId: row.tenantId ? asTenantId(row.tenantId) : undefined,
          traceId: row.traceId ?? undefined,
          type: row.type,
        })),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown domain event query failure'

      return err({
        message: `failed to query domain events: ${message}`,
        type: 'conflict',
      })
    }
  },
})
