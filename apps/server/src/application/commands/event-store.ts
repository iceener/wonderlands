import { sql } from 'drizzle-orm'

import { domainEvents, eventOutbox } from '../../db/schema'
import type { RepositoryDatabase } from '../../domain/database-port'
import {
  type CanonicalCommittedEventType,
  type EventOutboxTopic,
  getCanonicalCommittedEventContract,
  resolveCanonicalCommittedEventOutboxTopics,
} from '../../domain/events/committed-event-contract'
import type { DomainEventCategory, DomainEventEnvelope } from '../../domain/events/domain-event'
import {
  createEventPayloadSidecarRepository,
  splitEventPayloadForStorage,
} from '../../domain/events/event-payload-sidecar-repository'
import type { DomainError } from '../../shared/errors'
import type { AccountId, TenantId } from '../../shared/ids'
import { asEventId, createPrefixedId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import { signalOutboxPending } from '../events/outbox-signal'

export interface AppendDomainEventInput<TPayload> {
  actorAccountId?: AccountId
  aggregateId: string
  aggregateType: string
  category?: DomainEventCategory
  causationId?: string
  outboxTopics?: string[]
  payload: TPayload
  tenantId?: TenantId
  traceId?: string
  type: CanonicalCommittedEventType
}

const isEventOutboxTopic = (topic: string): topic is EventOutboxTopic =>
  topic === 'background' ||
  topic === 'observability' ||
  topic === 'projection' ||
  topic === 'realtime'

const normalizeOutboxTopics = (topics: string[]): EventOutboxTopic[] =>
  Array.from(new Set(topics)).sort().filter(isEventOutboxTopic)

export const createEventStore = (db: RepositoryDatabase) => ({
  append: <TPayload>(
    input: AppendDomainEventInput<TPayload>,
  ): Result<DomainEventEnvelope<TPayload>, DomainError> => {
    try {
      const contract = getCanonicalCommittedEventContract(input.type)

      if (!contract) {
        return err({
          message: `committed event type "${input.type}" is not registered in the canonical event contract`,
          type: 'conflict',
        })
      }

      const category = input.category ?? contract.category

      if (category !== contract.category) {
        return err({
          message: `committed event type "${input.type}" must use category "${contract.category}"`,
          type: 'conflict',
        })
      }

      if (input.outboxTopics?.some((topic) => !isEventOutboxTopic(topic))) {
        return err({
          message: `committed event type "${input.type}" requested an unknown outbox topic`,
          type: 'conflict',
        })
      }

      const outboxTopics =
        input.outboxTopics === undefined
          ? [...(resolveCanonicalCommittedEventOutboxTopics(input.type, input.payload) ?? [])]
          : normalizeOutboxTopics(input.outboxTopics)

      if (outboxTopics.some((topic) => !contract.outboxTopics.includes(topic))) {
        return err({
          message: `committed event type "${input.type}" does not support the requested outbox topics`,
          type: 'conflict',
        })
      }

      const event = {
        actorAccountId: input.actorAccountId,
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        category,
        causationId: input.causationId,
        createdAt: new Date().toISOString(),
        id: asEventId(createPrefixedId('evt')),
        payload: input.payload,
        tenantId: input.tenantId,
        traceId: input.traceId,
        type: input.type,
      }

      const payloadStorage = splitEventPayloadForStorage(event.type, event.payload)
      const sidecars = createEventPayloadSidecarRepository(db)
      const writeEvent = () => {
        db.insert(domainEvents)
          .values({
            actorAccountId: event.actorAccountId,
            aggregateId: event.aggregateId,
            aggregateType: event.aggregateType,
            category: event.category,
            causationId: event.causationId,
            createdAt: event.createdAt,
            eventNo: sql<number>`(select coalesce(max(${domainEvents.eventNo}), 0) + 1 from ${domainEvents})`,
            id: event.id,
            payload: payloadStorage.primaryPayload,
            tenantId: event.tenantId,
            traceId: event.traceId,
            type: event.type,
          })
          .run()

        if (payloadStorage.sidecarPayload) {
          const sidecarStored = sidecars.create({
            createdAt: event.createdAt,
            eventId: event.id,
            payload: payloadStorage.sidecarPayload,
          })

          if (!sidecarStored.ok) {
            throw new Error(sidecarStored.error.message)
          }
        }

        if (outboxTopics.length > 0) {
          db.insert(eventOutbox)
            .values(
              outboxTopics.map((topic) => ({
                availableAt: event.createdAt,
                createdAt: event.createdAt,
                eventId: event.id,
                id: createPrefixedId('obx'),
                status: 'pending' as const,
                tenantId: event.tenantId,
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

      if (outboxTopics.length > 0) {
        signalOutboxPending()
      }

      return ok(event)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown event write failure'

      return err({
        message: `failed to append domain event: ${message}`,
        type: 'conflict',
      })
    }
  },
})
