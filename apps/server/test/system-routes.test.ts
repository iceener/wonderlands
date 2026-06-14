import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'

import { domainEvents, eventOutbox, runs, tenants, workSessions } from '../src/db/schema'
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

test('system observability quarantine routes list quarantined entries and replay them', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers, tenantId } = seedApiKeyAuth(runtime)
  let wakeCalls = 0
  runtime.services.observability.worker.wake = () => {
    wakeCalls += 1
  }

  seedOutboxEntry(runtime, {
    attempts: 3,
    availableAt: '2026-03-30T08:00:00.000Z',
    createdAt: '2026-03-30T08:00:00.000Z',
    eventId: 'evt_quarantine_list',
    eventNo: 201,
    lastError: 'Langfuse returned 400 Invalid request data',
    outboxId: 'obx_quarantine_list',
    processedAt: '2026-03-30T08:01:00.000Z',
    status: 'quarantined',
    tenantId,
    topic: 'observability',
  })

  const listResponse = await app.request('http://local/v1/system/observability/quarantine', {
    headers,
    method: 'GET',
  })
  const listBody = await listResponse.json()

  assert.equal(listResponse.status, 200)
  assert.equal(listBody.ok, true)
  assert.equal(listBody.data.total, 1)
  assert.deepEqual(listBody.data.entries[0], {
    attempts: 3,
    availableAt: '2026-03-30T08:00:00.000Z',
    createdAt: '2026-03-30T08:00:00.000Z',
    event: {
      aggregateId: 'agg_evt_quarantine_list',
      aggregateType: 'run',
      createdAt: '2026-03-30T08:00:00.000Z',
      eventNo: 201,
      id: 'evt_quarantine_list',
      type: 'run.completed',
    },
    lastError: 'Langfuse returned 400 Invalid request data',
    outboxId: 'obx_quarantine_list',
    payloadIdentity: {
      runId: 'run_evt_quarantine_list',
    },
    quarantinedAt: '2026-03-30T08:01:00.000Z',
    topic: 'observability',
  })

  const replayResponse = await app.request(
    'http://local/v1/system/observability/quarantine/obx_quarantine_list/replay',
    {
      headers,
      method: 'POST',
    },
  )
  const replayBody = await replayResponse.json()

  assert.equal(replayResponse.status, 200)
  assert.equal(replayBody.ok, true)
  assert.equal(replayBody.data.outboxId, 'obx_quarantine_list')
  assert.equal(replayBody.data.eventId, 'evt_quarantine_list')
  assert.equal(replayBody.data.status, 'pending')
  assert.equal(replayBody.data.topic, 'observability')
  assert.equal(wakeCalls, 1)

  const replayedRow = runtime.db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.id, 'obx_quarantine_list'))
    .get()

  assert.equal(replayedRow?.status, 'pending')
  assert.equal(replayedRow?.lastError, null)
  assert.equal(replayedRow?.processedAt, null)
})

test('system observability replay routes requeue root-run exports from run and session scope', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers, tenantId, accountId, assistantToolProfileId } = seedApiKeyAuth(runtime)
  let wakeCalls = 0
  runtime.services.observability.worker.wake = () => {
    wakeCalls += 1
  }

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: '2026-03-30T09:00:00.000Z',
      createdByAccountId: accountId,
      deletedAt: null,
      id: 'ses_observability_replay',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId,
      title: 'Observability Replay Session',
      updatedAt: '2026-03-30T09:10:00.000Z',
      workspaceId: null,
      workspaceRef: null,
    })
    .run()

  runtime.db
    .insert(runs)
    .values([
      {
        actorAccountId: accountId,
        agentId: null,
        agentRevisionId: null,
        completedAt: '2026-03-30T09:01:00.000Z',
        configSnapshot: {},
        createdAt: '2026-03-30T09:00:00.000Z',
        errorJson: null,
        id: 'run_root_replay_a',
        jobId: null,
        lastProgressAt: '2026-03-30T09:01:00.000Z',
        parentRunId: null,
        resultJson: { outputText: 'root replay a' },
        rootRunId: 'run_root_replay_a',
        sessionId: 'ses_observability_replay',
        sourceCallId: null,
        startedAt: '2026-03-30T09:00:00.000Z',
        status: 'completed',
        targetKind: 'agent',
        task: 'Replay root run A',
        tenantId,
        threadId: null,
        toolProfileId: assistantToolProfileId,
        turnCount: 1,
        updatedAt: '2026-03-30T09:01:00.000Z',
        version: 1,
        workspaceId: null,
        workspaceRef: null,
      },
      {
        actorAccountId: accountId,
        agentId: null,
        agentRevisionId: null,
        completedAt: '2026-03-30T09:01:30.000Z',
        configSnapshot: {},
        createdAt: '2026-03-30T09:00:20.000Z',
        errorJson: null,
        id: 'run_child_replay_a',
        jobId: null,
        lastProgressAt: '2026-03-30T09:01:30.000Z',
        parentRunId: 'run_root_replay_a',
        resultJson: { outputText: 'child replay a' },
        rootRunId: 'run_root_replay_a',
        sessionId: 'ses_observability_replay',
        sourceCallId: 'call_replay_a',
        startedAt: '2026-03-30T09:00:20.000Z',
        status: 'completed',
        targetKind: 'agent',
        task: 'Replay child run A',
        tenantId,
        threadId: null,
        toolProfileId: assistantToolProfileId,
        turnCount: 0,
        updatedAt: '2026-03-30T09:01:30.000Z',
        version: 1,
        workspaceId: null,
        workspaceRef: null,
      },
      {
        actorAccountId: accountId,
        agentId: null,
        agentRevisionId: null,
        completedAt: '2026-03-30T09:02:00.000Z',
        configSnapshot: {},
        createdAt: '2026-03-30T09:00:40.000Z',
        errorJson: { message: 'failed' },
        id: 'run_root_replay_b',
        jobId: null,
        lastProgressAt: '2026-03-30T09:02:00.000Z',
        parentRunId: null,
        resultJson: null,
        rootRunId: 'run_root_replay_b',
        sessionId: 'ses_observability_replay',
        sourceCallId: null,
        startedAt: '2026-03-30T09:00:40.000Z',
        status: 'failed',
        targetKind: 'agent',
        task: 'Replay root run B',
        tenantId,
        threadId: null,
        toolProfileId: assistantToolProfileId,
        turnCount: 1,
        updatedAt: '2026-03-30T09:02:00.000Z',
        version: 1,
        workspaceId: null,
        workspaceRef: null,
      },
    ])
    .run()

  runtime.db
    .update(workSessions)
    .set({
      rootRunId: 'run_root_replay_a',
    })
    .where(eq(workSessions.id, 'ses_observability_replay'))
    .run()

  runtime.db
    .insert(domainEvents)
    .values([
      {
        actorAccountId: accountId,
        aggregateId: 'run_root_replay_a',
        aggregateType: 'run',
        category: 'domain',
        causationId: null,
        createdAt: '2026-03-30T09:01:00.000Z',
        eventNo: 301,
        id: 'evt_root_replay_a_completed',
        payload: {
          rootRunId: 'run_root_replay_a',
          runId: 'run_root_replay_a',
          sessionId: 'ses_observability_replay',
          status: 'completed',
          threadId: 'thr_observability_replay',
        },
        tenantId,
        traceId: null,
        type: 'run.completed',
      },
      {
        actorAccountId: accountId,
        aggregateId: 'run_child_replay_a',
        aggregateType: 'run',
        category: 'domain',
        causationId: null,
        createdAt: '2026-03-30T09:01:30.000Z',
        eventNo: 302,
        id: 'evt_child_replay_a_completed',
        payload: {
          rootRunId: 'run_root_replay_a',
          runId: 'run_child_replay_a',
          sessionId: 'ses_observability_replay',
          sourceCallId: 'call_replay_a',
          status: 'completed',
          threadId: 'thr_observability_replay',
        },
        tenantId,
        traceId: null,
        type: 'run.completed',
      },
      {
        actorAccountId: accountId,
        aggregateId: 'run_root_replay_b',
        aggregateType: 'run',
        category: 'domain',
        causationId: null,
        createdAt: '2026-03-30T09:02:00.000Z',
        eventNo: 303,
        id: 'evt_root_replay_b_failed',
        payload: {
          rootRunId: 'run_root_replay_b',
          runId: 'run_root_replay_b',
          sessionId: 'ses_observability_replay',
          status: 'failed',
          threadId: 'thr_observability_replay',
        },
        tenantId,
        traceId: null,
        type: 'run.failed',
      },
    ])
    .run()

  runtime.db
    .insert(eventOutbox)
    .values({
      attempts: 4,
      availableAt: '2026-03-30T09:01:00.000Z',
      createdAt: '2026-03-30T09:01:00.000Z',
      eventId: 'evt_root_replay_a_completed',
      id: 'obx_root_replay_a_existing',
      lastError: 'old error',
      processedAt: '2026-03-30T09:01:02.000Z',
      status: 'delivered',
      tenantId,
      topic: 'observability',
    })
    .run()

  const runReplayResponse = await app.request(
    'http://local/v1/system/observability/replay/run/run_child_replay_a',
    {
      headers,
      method: 'POST',
    },
  )
  const runReplayBody = await runReplayResponse.json()

  assert.equal(runReplayResponse.status, 200)
  assert.equal(runReplayBody.ok, true)
  assert.equal(runReplayBody.data.requestedRunId, 'run_child_replay_a')
  assert.equal(runReplayBody.data.rootRunId, 'run_root_replay_a')
  assert.equal(runReplayBody.data.eventId, 'evt_root_replay_a_completed')
  assert.equal(runReplayBody.data.outboxId, 'obx_root_replay_a_existing')
  assert.equal(runReplayBody.data.status, 'pending')
  assert.equal(wakeCalls, 1)

  const replayedExistingRow = runtime.db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.id, 'obx_root_replay_a_existing'))
    .get()

  assert.equal(replayedExistingRow?.status, 'pending')
  assert.equal(replayedExistingRow?.attempts, 0)
  assert.equal(replayedExistingRow?.lastError, null)
  assert.equal(replayedExistingRow?.processedAt, null)

  const sessionReplayResponse = await app.request(
    'http://local/v1/system/observability/replay/session/ses_observability_replay',
    {
      headers,
      method: 'POST',
    },
  )
  const sessionReplayBody = await sessionReplayResponse.json()

  assert.equal(sessionReplayResponse.status, 200)
  assert.equal(sessionReplayBody.ok, true)
  assert.equal(sessionReplayBody.data.sessionId, 'ses_observability_replay')
  assert.equal(sessionReplayBody.data.total, 2)
  assert.deepEqual(
    sessionReplayBody.data.entries.map(
      (entry: (typeof sessionReplayBody.data.entries)[number]) => ({
        eventId: entry.eventId,
        rootRunId: entry.rootRunId,
        status: entry.status,
        topic: entry.topic,
      }),
    ),
    [
      {
        eventId: 'evt_root_replay_a_completed',
        rootRunId: 'run_root_replay_a',
        status: 'pending',
        topic: 'observability',
      },
      {
        eventId: 'evt_root_replay_b_failed',
        rootRunId: 'run_root_replay_b',
        status: 'pending',
        topic: 'observability',
      },
    ],
  )
  assert.equal(wakeCalls, 2)

  const observabilityRows = runtime.db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.topic, 'observability'))
    .all()

  assert.equal(
    observabilityRows.filter((row) => row.eventId === 'evt_root_replay_a_completed').length,
    1,
  )
  assert.equal(
    observabilityRows.some(
      (row) =>
        row.eventId === 'evt_root_replay_b_failed' &&
        row.status === 'pending' &&
        row.attempts === 0 &&
        row.lastError === null &&
        row.processedAt === null,
    ),
    true,
  )
})
