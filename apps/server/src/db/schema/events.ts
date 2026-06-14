import {
  blob,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { accounts, tenants } from './identity'

const domainEventCategoryValues = ['domain', 'telemetry'] as const
const outboxStatusValues = ['pending', 'processing', 'delivered', 'failed', 'quarantined'] as const
const httpIdempotencyStatusValues = ['in_progress', 'completed'] as const

export const domainEvents = sqliteTable(
  'domain_events',
  {
    actorAccountId: text('actor_account_id').references(() => accounts.id),
    aggregateId: text('aggregate_id').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    category: text('category', { enum: domainEventCategoryValues }).notNull().default('domain'),
    causationId: text('causation_id'),
    createdAt: text('created_at').notNull(),
    eventNo: integer('event_no').notNull(),
    id: text('id').primaryKey(),
    payload: text('payload', { mode: 'json' }).notNull(),
    tenantId: text('tenant_id').references(() => tenants.id),
    traceId: text('trace_id'),
    type: text('type').notNull(),
  },
  (table) => [
    uniqueIndex('domain_events_event_no_unique').on(table.eventNo),
    uniqueIndex('domain_events_id_tenant_unique').on(table.id, table.tenantId),
    index('domain_events_aggregate_idx').on(table.aggregateType, table.aggregateId),
    index('domain_events_tenant_category_event_no_idx').on(
      table.tenantId,
      table.category,
      table.eventNo,
    ),
    index('domain_events_tenant_event_no_idx').on(table.tenantId, table.eventNo),
    index('domain_events_type_idx').on(table.type),
  ],
)

export const eventOutbox = sqliteTable(
  'event_outbox',
  {
    attempts: integer('attempts').notNull().default(0),
    availableAt: text('available_at').notNull(),
    createdAt: text('created_at').notNull(),
    eventId: text('event_id')
      .notNull()
      .references(() => domainEvents.id),
    id: text('id').primaryKey(),
    lastError: text('last_error'),
    processedAt: text('processed_at'),
    status: text('status', { enum: outboxStatusValues }).notNull(),
    tenantId: text('tenant_id').references(() => tenants.id),
    topic: text('topic').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId, table.tenantId],
      foreignColumns: [domainEvents.id, domainEvents.tenantId],
      name: 'event_outbox_event_tenant_fk',
    }),
    index('event_outbox_status_available_at_idx').on(table.status, table.availableAt),
    index('event_outbox_tenant_status_available_at_idx').on(
      table.tenantId,
      table.status,
      table.availableAt,
    ),
    uniqueIndex('event_outbox_event_topic_unique').on(table.eventId, table.topic),
  ],
)

export const eventPayloadSidecars = sqliteTable(
  'event_payload_sidecars',
  {
    createdAt: text('created_at').notNull(),
    encoding: text('encoding').notNull(),
    eventId: text('event_id')
      .primaryKey()
      .references(() => domainEvents.id),
    payloadCompressed: blob('payload_compressed', { mode: 'buffer' }).notNull(),
  },
  (table) => [index('event_payload_sidecars_created_at_idx').on(table.createdAt)],
)

export const httpIdempotencyKeys = sqliteTable(
  'http_idempotency_keys',
  {
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at'),
    id: text('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseDataJson: text('response_data_json', { mode: 'json' }),
    scope: text('scope').notNull(),
    status: text('status', { enum: httpIdempotencyStatusValues }).notNull(),
    statusCode: integer('status_code'),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('http_idempotency_keys_tenant_scope_key_unique').on(
      table.tenantId,
      table.scope,
      table.idempotencyKey,
    ),
    index('http_idempotency_keys_status_expires_at_idx').on(table.status, table.expiresAt),
    index('http_idempotency_keys_tenant_created_at_idx').on(table.tenantId, table.createdAt),
  ],
)
