import { and, asc, eq, gt, or, sql } from 'drizzle-orm'

import { domainEvents } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import { asAccountId, asEventId, asTenantId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'
import { DEFAULT_REPLAY_EVENT_CATEGORY } from './committed-event-contract'
import type { DomainEventCategory, DomainEventEnvelope } from './domain-event'
import {
  createEventPayloadSidecarRepository,
  hydrateStoredEventPayload,
} from './event-payload-sidecar-repository'

export interface ListDomainEventsInput {
  category?: DomainEventCategory | 'all'
  cursor?: number
  limit?: number
  runId?: string
  sessionId?: string
  threadId?: string
}

const jsonStringAt = (path: '$.runId' | '$.sessionId' | '$.threadId') =>
  sql<string | null>`json_extract(${domainEvents.payload}, ${path})`

export const createDomainEventRepository = (db: RepositoryDatabase) => ({
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
