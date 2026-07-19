import type { RepositoryDatabase } from '../../db/repository-database'
import {
  type CanonicalCommittedEventType,
  type EventOutboxTopic,
  getCanonicalCommittedEventContract,
  resolveCanonicalCommittedEventOutboxTopics,
} from '../../domain/events/committed-event-contract'
import type { DomainEventCategory, DomainEventEnvelope } from '../../domain/events/domain-event'
import { splitEventPayloadForStorage } from '../../domain/events/event-payload-sidecar-repository'
import type { DomainError } from '../../shared/errors'
import type { AccountId, TenantId } from '../../shared/ids'
import { asEventId, createPrefixedId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import { signalOutboxPending } from '../events/outbox-signal'
import { createDomainEventRepository } from '../persistence/repositories'

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

      const createdAt = new Date().toISOString()
      const id = asEventId(createPrefixedId('evt'))
      const payloadStorage = splitEventPayloadForStorage(input.type, input.payload)

      const appended = createDomainEventRepository(db).append({
        actorAccountId: input.actorAccountId,
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        category,
        causationId: input.causationId,
        createdAt,
        id,
        outboxTopics,
        primaryPayload: payloadStorage.primaryPayload,
        sidecarPayload: payloadStorage.sidecarPayload,
        tenantId: input.tenantId,
        traceId: input.traceId,
        type: input.type,
      })

      if (!appended.ok) {
        return appended
      }

      if (outboxTopics.length > 0) {
        signalOutboxPending()
      }

      return ok(appended.value as DomainEventEnvelope<TPayload>)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown event write failure'

      return err({
        message: `failed to append domain event: ${message}`,
        type: 'conflict',
      })
    }
  },
})
