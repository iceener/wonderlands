import assert from 'node:assert/strict'
import { test } from 'vitest'

import { domainEvents, eventOutbox, tenants } from '../src/db/schema'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const seedOutboxEntry = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    attempts: number
    availableAt: string
    createdAt: string
    eventId: string
    eventNo: number
    lastError?: string | null
    outboxId: string
    processedAt?: string | null
    status: 'delivered' | 'failed' | 'pending' | 'processing' | 'quarantined'
    tenantId: string
    topic: 'background' | 'observability' | 'projection' | 'realtime'
  },
) => {
  runtime.db
    .insert(domainEvents)
    .values({
      actorAccountId: null,
      aggregateId: `agg_${input.eventId}`,
      aggregateType: 'run',
      category: 'domain',
      causationId: null,
      createdAt: input.createdAt,
      eventNo: input.eventNo,
      id: input.eventId,
      payload: {
        runId: `run_${input.eventId}`,
      },
      tenantId: input.tenantId,
      traceId: null,
      type: 'run.completed',
    })
    .run()

  runtime.db
    .insert(eventOutbox)
    .values({
      attempts: input.attempts,
      availableAt: input.availableAt,
      createdAt: input.createdAt,
      eventId: input.eventId,
      id: input.outboxId,
      lastError: input.lastError ?? null,
      processedAt: input.processedAt ?? null,
      status: input.status,
      tenantId: input.tenantId,
      topic: input.topic,
    })
    .run()
}

test('system observability endpoint requires an authenticated tenant scope', async () => {
  const { app } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })

  const response = await app.request('http://local/v1/system/observability')
  const body = await response.json()

  assert.equal(response.status, 403)
  assert.equal(body.ok, false)
  assert.equal(body.error.type, 'permission')
})

test('system observability endpoint returns tenant-scoped backlog stats by topic and worker', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    LANGFUSE_BASE_URL: 'https://langfuse.local',
    LANGFUSE_PUBLIC_KEY: 'pk_test',
    LANGFUSE_SECRET_KEY: 'sk_test',
    NODE_ENV: 'test',
  })
  const { headers, tenantId } = seedApiKeyAuth(runtime)

  runtime.db
    .insert(tenants)
    .values({
      createdAt: '2026-03-30T00:00:00.000Z',
      id: 'ten_other',
      name: 'Other Tenant',
      slug: 'other-tenant',
      status: 'active',
      updatedAt: '2026-03-30T00:00:00.000Z',
    })
    .run()

  seedOutboxEntry(runtime, {
    attempts: 2,
    availableAt: '2026-03-30T01:05:00.000Z',
    createdAt: '2026-03-30T01:00:00.000Z',
    eventId: 'evt_realtime_pending',
    eventNo: 101,
    outboxId: 'obx_realtime_pending',
    status: 'pending',
    tenantId,
    topic: 'realtime',
  })
  seedOutboxEntry(runtime, {
    attempts: 4,
    availableAt: '2026-03-30T02:00:00.000Z',
    createdAt: '2026-03-30T02:00:00.000Z',
    eventId: 'evt_projection_processing',
    eventNo: 102,
    outboxId: 'obx_projection_processing',
    status: 'processing',
    tenantId,
    topic: 'projection',
  })
  seedOutboxEntry(runtime, {
    attempts: 0,
    availableAt: '2026-03-30T03:00:00.000Z',
    createdAt: '2026-03-30T03:00:00.000Z',
    eventId: 'evt_observability_pending',
    eventNo: 103,
    outboxId: 'obx_observability_pending',
    status: 'pending',
    tenantId,
    topic: 'observability',
  })
  seedOutboxEntry(runtime, {
    attempts: 1,
    availableAt: '2026-03-30T04:10:00.000Z',
    createdAt: '2026-03-30T04:00:00.000Z',
    eventId: 'evt_observability_failed_a',
    eventNo: 104,
    lastError: 'Malformed Langfuse score payload',
    outboxId: 'obx_observability_failed_a',
    status: 'failed',
    tenantId,
    topic: 'observability',
  })
  seedOutboxEntry(runtime, {
    attempts: 3,
    availableAt: '2026-03-30T05:10:00.000Z',
    createdAt: '2026-03-30T05:00:00.000Z',
    eventId: 'evt_observability_failed_b',
    eventNo: 105,
    lastError: 'Langfuse returned 400',
    outboxId: 'obx_observability_failed_b',
    status: 'failed',
    tenantId,
    topic: 'observability',
  })
  seedOutboxEntry(runtime, {
    attempts: 7,
    availableAt: '2026-03-30T06:00:00.000Z',
    createdAt: '2026-03-30T06:00:00.000Z',
    eventId: 'evt_observability_quarantined',
    eventNo: 106,
    lastError: 'Malformed Langfuse score payload',
    outboxId: 'obx_observability_quarantined',
    processedAt: '2026-03-30T06:01:00.000Z',
    status: 'quarantined',
    tenantId,
    topic: 'observability',
  })
  seedOutboxEntry(runtime, {
    attempts: 9,
    availableAt: '2026-03-30T07:00:00.000Z',
    createdAt: '2026-03-30T07:00:00.000Z',
    eventId: 'evt_other_tenant_failed',
    eventNo: 107,
    lastError: 'Should not be visible',
    outboxId: 'obx_other_tenant_failed',
    status: 'failed',
    tenantId: 'ten_other',
    topic: 'observability',
  })

  const response = await app.request('http://local/v1/system/observability', {
    headers,
    method: 'GET',
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(typeof body.data.generatedAt, 'string')
  assert.deepEqual(body.data.langfuse, {
    baseUrl: 'https://langfuse.local',
    enabled: true,
    environment: 'test',
  })
  assert.deepEqual(body.data.totals, {
    backlogCount: 5,
    failedCount: 2,
    pendingCount: 2,
    processingCount: 1,
    quarantinedCount: 1,
  })

  const topicByName = new Map(
    body.data.topics.map((topic: (typeof body.data.topics)[number]) => [topic.topic, topic]),
  )

  assert.deepEqual(topicByName.get('background'), {
    backlogCount: 0,
    failedCount: 0,
    lane: 'durable',
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
    topic: 'background',
    worker: 'events',
  })
  assert.deepEqual(topicByName.get('realtime'), {
    backlogCount: 1,
    failedCount: 0,
    lane: 'realtime',
    oldestFailedAvailableAt: null,
    oldestFailedCreatedAt: null,
    oldestPendingAvailableAt: '2026-03-30T01:05:00.000Z',
    oldestPendingCreatedAt: '2026-03-30T01:00:00.000Z',
    oldestProcessingCreatedAt: null,
    oldestQuarantinedAt: null,
    pendingCount: 1,
    processingCount: 0,
    quarantinedCount: 0,
    retryCountDistribution: [{ attempts: 2, count: 1 }],
    topic: 'realtime',
    worker: 'events',
  })
  assert.deepEqual(topicByName.get('projection'), {
    backlogCount: 1,
    failedCount: 0,
    lane: 'durable',
    oldestFailedAvailableAt: null,
    oldestFailedCreatedAt: null,
    oldestPendingAvailableAt: null,
    oldestPendingCreatedAt: null,
    oldestProcessingCreatedAt: '2026-03-30T02:00:00.000Z',
    oldestQuarantinedAt: null,
    pendingCount: 0,
    processingCount: 1,
    quarantinedCount: 0,
    retryCountDistribution: [{ attempts: 4, count: 1 }],
    topic: 'projection',
    worker: 'events',
  })
  assert.deepEqual(topicByName.get('observability'), {
    backlogCount: 3,
    failedCount: 2,
    lane: 'observability',
    oldestFailedAvailableAt: '2026-03-30T04:10:00.000Z',
    oldestFailedCreatedAt: '2026-03-30T04:00:00.000Z',
    oldestPendingAvailableAt: '2026-03-30T03:00:00.000Z',
    oldestPendingCreatedAt: '2026-03-30T03:00:00.000Z',
    oldestProcessingCreatedAt: null,
    oldestQuarantinedAt: '2026-03-30T06:01:00.000Z',
    pendingCount: 1,
    processingCount: 0,
    quarantinedCount: 1,
    retryCountDistribution: [
      { attempts: 0, count: 1 },
      { attempts: 1, count: 1 },
      { attempts: 3, count: 1 },
    ],
    topic: 'observability',
    worker: 'observability',
  })

  const workerByName = new Map(
    body.data.workers.map((worker: (typeof body.data.workers)[number]) => [worker.worker, worker]),
  )

  assert.deepEqual(workerByName.get('events'), {
    backlogCount: 2,
    failedCount: 0,
    lanes: ['durable', 'realtime'],
    oldestFailedAvailableAt: null,
    oldestFailedCreatedAt: null,
    oldestPendingAvailableAt: '2026-03-30T01:05:00.000Z',
    oldestPendingCreatedAt: '2026-03-30T01:00:00.000Z',
    oldestProcessingCreatedAt: '2026-03-30T02:00:00.000Z',
    oldestQuarantinedAt: null,
    pendingCount: 1,
    processingCount: 1,
    quarantinedCount: 0,
    retryCountDistribution: [
      { attempts: 2, count: 1 },
      { attempts: 4, count: 1 },
    ],
    topics: ['realtime', 'projection', 'background'],
    worker: 'events',
  })
  assert.deepEqual(workerByName.get('observability'), {
    backlogCount: 3,
    failedCount: 2,
    lanes: ['observability'],
    oldestFailedAvailableAt: '2026-03-30T04:10:00.000Z',
    oldestFailedCreatedAt: '2026-03-30T04:00:00.000Z',
    oldestPendingAvailableAt: '2026-03-30T03:00:00.000Z',
    oldestPendingCreatedAt: '2026-03-30T03:00:00.000Z',
    oldestProcessingCreatedAt: null,
    oldestQuarantinedAt: '2026-03-30T06:01:00.000Z',
    pendingCount: 1,
    processingCount: 0,
    quarantinedCount: 1,
    retryCountDistribution: [
      { attempts: 0, count: 1 },
      { attempts: 1, count: 1 },
      { attempts: 3, count: 1 },
    ],
    topics: ['observability'],
    worker: 'observability',
  })
})
