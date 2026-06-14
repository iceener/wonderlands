import type { AccountId, EventId, TenantId } from '../../shared/ids'

export type DomainEventCategory = 'domain' | 'telemetry'

export interface DomainEventEnvelope<TPayload> {
  actorAccountId?: AccountId
  aggregateId: string
  aggregateType: string
  category: DomainEventCategory
  causationId?: string
  createdAt: string
  id: EventId
  payload: TPayload
  tenantId?: TenantId
  traceId?: string
  type: string
}
