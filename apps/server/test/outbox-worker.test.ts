import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { onTestFinished, test } from 'vitest'

import { closeAppRuntime } from '../src/app/runtime'
import { createEventStore } from '../src/application/commands/event-store'
import { dispatchProjectionEvent } from '../src/application/events/projection-dispatcher'
import { domainEvents, eventOutbox, items } from '../src/db/schema'
import { err, ok } from '../src/shared/result'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const readStreamChunk = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
) => {
  const timeout = setTimeout(() => {
    void reader.cancel('timeout')
  }, timeoutMs)

  try {
    return await reader.read()
  } finally {
    clearTimeout(timeout)
  }
}

const createManagedHarness = (env: NodeJS.ProcessEnv = {}) => {
  const harness = createTestHarness(env)

  onTestFinished(async () => {
    await closeAppRuntime(harness.runtime)
  })

  return harness
}

test('event outbox worker delivers realtime entries and removes claimed rows on success', async () => {
  const { app, runtime } = createManagedHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const response = await app.request('http://local/v1/sessions', {
    body: JSON.stringify({
      title: 'Outbox delivery',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 201)

  const subscription = runtime.services.events.realtime.subscribe({
    afterCursor: 0,
    category: 'all',
  })

  try {
    const processed = await runtime.services.events.outbox.processOnce()

    assert.equal(processed, true)

    const outboxRows = runtime.db
      .select()
      .from(eventOutbox)
      .orderBy(eventOutbox.createdAt, eventOutbox.id)
      .all()

    assert.equal(outboxRows.length, 0)

    const delivered = [
      await subscription.next(10),
      await subscription.next(10),
      await subscription.next(10),
    ]

    assert.deepEqual(
      delivered.map((event) => event?.type),
      ['workspace.created', 'workspace.resolved', 'session.created'],
    )
    assert.deepEqual(
      delivered.map((event) => event?.category),
      ['domain', 'domain', 'domain'],
    )
  } finally {
    subscription.close()
  }
})

test('event outbox worker retries entries when no dispatcher exists for the topic', async () => {
  const { runtime } = createManagedHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const now = '2026-03-30T00:00:00.000Z'
  const appended = createEventStore(runtime.db).append({
    actorAccountId: accountId,
    aggregateId: 'ses_outbox_retry',
    aggregateType: 'work_session',
    outboxTopics: [],
    payload: {
      sessionId: 'ses_outbox_retry',
    },
    tenantId,
    type: 'session.created',
  })

  assert.equal(appended.ok, true)

  if (!appended.ok) {
    throw new Error(appended.error.message)
  }

  runtime.db
    .insert(eventOutbox)
    .values({
      attempts: 0,
      availableAt: now,
      createdAt: now,
      eventId: appended.value.id,
      id: 'obx_missing_dispatcher',
      lastError: null,
      processedAt: null,
      status: 'pending',
      tenantId,
      topic: 'unknown_topic',
    })
    .run()

  const processed = await runtime.services.events.outbox.processOnce()

  assert.equal(processed, true)

  const retried = runtime.db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.id, 'obx_missing_dispatcher'))
    .get()

  assert.equal(retried?.status, 'failed')
  assert.equal(retried?.attempts, 1)
  assert.match(retried?.lastError ?? '', /No outbox dispatcher is registered/)
  assert.notEqual(retried?.availableAt, now)
  assert.equal(retried?.processedAt, null)
})

test('observability worker quarantines permanent Langfuse failures instead of retrying them', async () => {
  const { runtime } = createManagedHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const appended = createEventStore(runtime.db).append({
    actorAccountId: accountId,
    aggregateId: 'run_quarantine_validation',
    aggregateType: 'run',
    outboxTopics: ['observability'],
    payload: {
      rootRunId: 'run_quarantine_validation',
      runId: 'run_quarantine_validation',
      status: 'completed',
    },
    tenantId,
    type: 'run.completed',
  })

  assert.equal(appended.ok, true)

  runtime.services.observability.langfuse.exportOutboxEntry = async () =>
    err({
      message: 'Langfuse export requires a root run id',
      type: 'validation',
    })

  const processed = await runtime.services.observability.worker.processOnce()

  assert.equal(processed, true)

  const row = runtime.db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.eventId, appended.ok ? appended.value.id : 'evt_missing'))
    .get()

  assert.equal(row?.status, 'quarantined')
  assert.equal(row?.attempts, 1)
  assert.equal(row?.lastError, 'Langfuse export requires a root run id')
  assert.equal(typeof row?.processedAt, 'string')
})

test('observability worker quarantines transient Langfuse failures after the retry bound is reached', async () => {
  const { runtime } = createManagedHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const now = '2026-03-30T00:00:00.000Z'
  const appended = createEventStore(runtime.db).append({
    actorAccountId: accountId,
    aggregateId: 'run_quarantine_retry_bound',
    aggregateType: 'run',
    outboxTopics: [],
    payload: {
      rootRunId: 'run_quarantine_retry_bound',
      runId: 'run_quarantine_retry_bound',
      status: 'completed',
    },
    tenantId,
    type: 'run.completed',
  })

  assert.equal(appended.ok, true)

  if (!appended.ok) {
    throw new Error(appended.error.message)
  }

  runtime.db
    .insert(eventOutbox)
    .values({
      attempts: 2,
      availableAt: now,
      createdAt: now,
      eventId: appended.value.id,
      id: 'obx_observability_retry_bound',
      lastError: 'Langfuse timeout',
      processedAt: null,
      status: 'failed',
      tenantId,
      topic: 'observability',
    })
    .run()

  runtime.services.observability.langfuse.exportOutboxEntry = async () =>
    err({
      message: 'Langfuse request timed out',
      provider: 'langfuse',
      retryable: true,
      type: 'provider',
    })

  const processed = await runtime.services.observability.worker.processOnce()

  assert.equal(processed, true)

  const row = runtime.db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.id, 'obx_observability_retry_bound'))
    .get()

  assert.equal(row?.status, 'quarantined')
  assert.equal(row?.attempts, 3)
  assert.equal(row?.lastError, 'Langfuse request timed out')
  assert.equal(typeof row?.processedAt, 'string')
})

test('event stream follow mode emits outbox-delivered events after the initial replay', async () => {
  const { app, runtime } = createManagedHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const sessionResponse = await app.request('http://local/v1/sessions', {
    body: JSON.stringify({
      title: 'Parent session',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const sessionBody = await sessionResponse.json()

  assert.equal(sessionResponse.status, 201)

  const latestCursor =
    runtime.db.select().from(domainEvents).orderBy(domainEvents.eventNo).all().at(-1)?.eventNo ?? 0

  const sseResponse = await app.request(
    `http://local/v1/events/stream?follow=true&cursor=${latestCursor}&sessionId=${sessionBody.data.id}`,
    {
      headers,
      method: 'GET',
    },
  )

  assert.equal(sseResponse.status, 200)

  const reader = sseResponse.body?.getReader()

  assert.ok(reader)

  try {
    const threadResponse = await app.request(
      `http://local/v1/sessions/${sessionBody.data.id}/threads`,
      {
        body: JSON.stringify({
          title: 'Delivered thread',
        }),
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    assert.equal(threadResponse.status, 201)

    await runtime.services.events.outbox.processOnce()

    const firstChunk = await readStreamChunk(reader, 1_000)

    assert.equal(firstChunk.done, false)

    const text = new TextDecoder().decode(firstChunk.value)

    assert.match(text, /event: thread\.created/)
    assert.match(text, /"category":"domain"/)
  } finally {
    await reader.cancel()
  }
})

test('projection outbox dispatch precomputes initial run items on run.created', async () => {
  const { app, runtime } = createManagedHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const bootstrapResponse = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Project the initial thread context',
      title: 'Projected bootstrap',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const bootstrapBody = await bootstrapResponse.json()

  assert.equal(bootstrapResponse.status, 201)
  assert.equal(
    runtime.db
      .select()
      .from(items)
      .all()
      .filter((item) => item.runId === bootstrapBody.data.runId).length,
    0,
  )

  const processed = await runtime.services.events.outbox.processOnce()

  assert.equal(processed, true)

  const projectedItems = runtime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.runId === bootstrapBody.data.runId)

  assert.equal(projectedItems.length, 1)
  assert.equal(projectedItems[0]?.type, 'message')
  assert.equal(projectedItems[0]?.role, 'user')
  assert.deepEqual(projectedItems[0]?.content, [
    {
      text: 'Project the initial thread context',
      type: 'text',
    },
  ])
  assert.deepEqual(projectedItems[0]?.providerPayload, {
    providerMessageId: null,
    responseId: null,
    sessionMessageId: bootstrapBody.data.messageId,
    source: 'session_message_projection',
  })
})

test('projection dispatcher seeds initial run items from job.queued', async () => {
  const { app, runtime } = createManagedHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const bootstrapResponse = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Project from graph readiness',
      title: 'Projected from work item',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const bootstrapBody = await bootstrapResponse.json()

  assert.equal(bootstrapResponse.status, 201)

  const readyEvent = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .find((event) => event.type === 'job.queued')
  const readyOutbox = runtime.db
    .select()
    .from(eventOutbox)
    .all()
    .find((entry) => entry.eventId === readyEvent?.id && entry.topic === 'projection')

  assert.ok(readyEvent)
  assert.ok(readyOutbox)

  const projected = dispatchProjectionEvent(runtime, {
    attempts: readyOutbox?.attempts ?? 0,
    availableAt: readyOutbox?.availableAt ?? readyEvent?.createdAt ?? '',
    createdAt: readyOutbox?.createdAt ?? readyEvent?.createdAt ?? '',
    event: {
      actorAccountId: readyEvent?.actorAccountId ?? undefined,
      aggregateId: readyEvent?.aggregateId ?? '',
      aggregateType: readyEvent?.aggregateType ?? '',
      category: readyEvent?.category ?? 'domain',
      causationId: readyEvent?.causationId ?? undefined,
      createdAt: readyEvent?.createdAt ?? '',
      eventNo: readyEvent?.eventNo ?? 0,
      id: readyEvent?.id ?? ('evt_missing' as never),
      payload: readyEvent?.payload ?? null,
      tenantId: readyEvent?.tenantId ?? undefined,
      traceId: readyEvent?.traceId ?? undefined,
      type: readyEvent?.type ?? 'job.queued',
    },
    eventId: readyOutbox?.eventId ?? (readyEvent?.id as never),
    id: readyOutbox?.id ?? 'obx_missing',
    lastError: readyOutbox?.lastError ?? null,
    processedAt: readyOutbox?.processedAt ?? null,
    status: readyOutbox?.status ?? 'pending',
    tenantId: readyOutbox?.tenantId ?? undefined,
    topic: readyOutbox?.topic ?? 'projection',
  })

  assert.equal(projected.ok, true, projected.ok ? undefined : projected.error.message)

  const projectedItems = runtime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.runId === bootstrapBody.data.runId)

  assert.equal(projectedItems.length, 1)
  assert.equal(projectedItems[0]?.type, 'message')
  assert.equal(projectedItems[0]?.role, 'user')
  assert.deepEqual(projectedItems[0]?.content, [
    {
      text: 'Project from graph readiness',
      type: 'text',
    },
  ])
})

test('projection delivery keeps pending root run context current across outbox ordering races', async () => {
  const { app, runtime } = createManagedHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const bootstrapResponse = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'First projected message',
      title: 'Projection ordering race',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const bootstrapBody = await bootstrapResponse.json()

  assert.equal(bootstrapResponse.status, 201)

  const secondMessageResponse = await app.request(
    `http://local/v1/threads/${bootstrapBody.data.threadId}/messages`,
    {
      body: JSON.stringify({
        text: 'Second projected message',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const secondMessageBody = await secondMessageResponse.json()

  assert.equal(secondMessageResponse.status, 201)

  const processed = await runtime.services.events.outbox.processOnce()

  assert.equal(processed, true)

  const projectedItems = runtime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.runId === bootstrapBody.data.runId)

  assert.equal(projectedItems.length, 2)
  assert.deepEqual(
    projectedItems.map((item) => item.content),
    [
      [{ text: 'First projected message', type: 'text' }],
      [{ text: 'Second projected message', type: 'text' }],
    ],
  )
  assert.deepEqual(
    projectedItems.map((item) => item.providerPayload),
    [
      {
        providerMessageId: null,
        responseId: null,
        sessionMessageId: bootstrapBody.data.messageId,
        source: 'session_message_projection',
      },
      {
        providerMessageId: null,
        responseId: null,
        sessionMessageId: secondMessageBody.data.messageId,
        source: 'session_message_projection',
      },
    ],
  )
})

test('event stream follow mode keeps live scope filters when realtime delivery starts', async () => {
  const { app, runtime } = createManagedHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const firstSessionResponse = await app.request('http://local/v1/sessions', {
    body: JSON.stringify({
      title: 'Scoped session',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const firstSessionBody = await firstSessionResponse.json()

  const secondSessionResponse = await app.request('http://local/v1/sessions', {
    body: JSON.stringify({
      title: 'Unrelated session',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const secondSessionBody = await secondSessionResponse.json()

  assert.equal(firstSessionResponse.status, 201)
  assert.equal(secondSessionResponse.status, 201)

  const latestCursor =
    runtime.db.select().from(domainEvents).orderBy(domainEvents.eventNo).all().at(-1)?.eventNo ?? 0

  const sseResponse = await app.request(
    `http://local/v1/events/stream?follow=true&cursor=${latestCursor}&sessionId=${firstSessionBody.data.id}`,
    {
      headers,
      method: 'GET',
    },
  )

  assert.equal(sseResponse.status, 200)

  const reader = sseResponse.body?.getReader()

  assert.ok(reader)

  try {
    const unrelatedThreadResponse = await app.request(
      `http://local/v1/sessions/${secondSessionBody.data.id}/threads`,
      {
        body: JSON.stringify({
          title: 'Unrelated thread',
        }),
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    const relatedThreadResponse = await app.request(
      `http://local/v1/sessions/${firstSessionBody.data.id}/threads`,
      {
        body: JSON.stringify({
          title: 'Scoped thread',
        }),
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    assert.equal(unrelatedThreadResponse.status, 201)
    assert.equal(relatedThreadResponse.status, 201)

    await runtime.services.events.outbox.processOnce()

    const firstChunk = await readStreamChunk(reader, 1_000)

    assert.equal(firstChunk.done, false)

    const text = new TextDecoder().decode(firstChunk.value)

    assert.match(text, /event: thread\.created/)
    assert.match(text, new RegExp(`"sessionId":"${firstSessionBody.data.id}"`))
    assert.doesNotMatch(text, new RegExp(`"sessionId":"${secondSessionBody.data.id}"`))
  } finally {
    await reader.cancel()
  }
})

test('event outbox reconciliation releases processing rows back into retryable state', () => {
  const { runtime } = createManagedHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const now = '2026-03-30T00:00:00.000Z'
  const appended = createEventStore(runtime.db).append({
    actorAccountId: accountId,
    aggregateId: 'ses_outbox_recover',
    aggregateType: 'work_session',
    outboxTopics: [],
    payload: {
      sessionId: 'ses_outbox_recover',
    },
    tenantId,
    type: 'session.created',
  })

  assert.equal(appended.ok, true)

  if (!appended.ok) {
    throw new Error(appended.error.message)
  }

  runtime.db
    .insert(eventOutbox)
    .values({
      attempts: 2,
      availableAt: '2026-03-29T23:59:00.000Z',
      createdAt: now,
      eventId: appended.value.id,
      id: 'obx_processing_recover',
      lastError: null,
      processedAt: null,
      status: 'processing',
      tenantId,
      topic: 'realtime',
    })
    .run()

  const recovered = runtime.services.events.outbox.reconcileProcessingEntries()

  assert.equal(recovered.ok, true)

  if (!recovered.ok) {
    throw new Error(recovered.error.message)
  }

  assert.equal(recovered.value, 1)

  const row = runtime.db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.id, 'obx_processing_recover'))
    .get()

  assert.equal(row?.status, 'failed')
  assert.equal(row?.attempts, 2)
  assert.equal(row?.processedAt, null)
  assert.match(row?.lastError ?? '', /Recovered abandoned processing outbox entry/)
  assert.notEqual(row?.availableAt, '2026-03-29T23:59:00.000Z')
})

test('event outbox worker wakes immediately when new realtime entries are appended', async () => {
  const { runtime } = createManagedHarness({
    AUTH_MODE: 'api_key',
    MULTIAGENT_WORKER_POLL_MS: '1000',
    NODE_ENV: 'test',
  })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const subscription = runtime.services.events.realtime.subscribe({
    afterCursor: 0,
    category: 'all',
  })

  runtime.services.events.outbox.start()

  try {
    await new Promise((resolve) => setTimeout(resolve, 25))

    const appended = createEventStore(runtime.db).append({
      actorAccountId: accountId,
      aggregateId: 'ses_outbox_wake',
      aggregateType: 'work_session',
      outboxTopics: ['realtime'],
      payload: {
        sessionId: 'ses_outbox_wake',
      },
      tenantId,
      type: 'session.created',
    })

    assert.equal(appended.ok, true)

    if (!appended.ok) {
      throw new Error(appended.error.message)
    }

    const delivered = await subscription.next(250)

    assert.ok(delivered)
    assert.equal(delivered?.type, 'session.created')
    assert.equal(delivered?.aggregateId, 'ses_outbox_wake')
  } finally {
    subscription.close()
    await runtime.services.events.outbox.stop()
  }
})

test('event outbox worker keeps realtime delivery flowing while observability is blocked', async () => {
  const { runtime } = createManagedHarness({
    AUTH_MODE: 'api_key',
    MULTIAGENT_WORKER_POLL_MS: '1000',
    NODE_ENV: 'test',
  })
  const { accountId, tenantId } = seedApiKeyAuth(runtime)
  const eventStore = createEventStore(runtime.db)
  const subscription = runtime.services.events.realtime.subscribe({
    afterCursor: 0,
    category: 'all',
  })
  let releaseBlockedExport: (() => void) | null = null

  runtime.services.observability.langfuse.exportOutboxEntry = async () =>
    new Promise((resolve) => {
      releaseBlockedExport = () => resolve(ok(null))
    })

  runtime.services.events.outbox.start()
  runtime.services.observability.worker.start()

  try {
    const blocking = eventStore.append({
      actorAccountId: accountId,
      aggregateId: 'run_observability_block',
      aggregateType: 'run',
      outboxTopics: ['observability'],
      payload: {
        rootRunId: 'run_observability_block',
        runId: 'run_observability_block',
        status: 'completed',
      },
      tenantId,
      type: 'run.completed',
    })

    assert.equal(blocking.ok, true)

    await new Promise((resolve) => setTimeout(resolve, 25))

    const realtimeOnly = eventStore.append({
      actorAccountId: accountId,
      aggregateId: 'ses_realtime_fast_lane',
      aggregateType: 'work_session',
      outboxTopics: ['realtime'],
      payload: {
        sessionId: 'ses_realtime_fast_lane',
      },
      tenantId,
      type: 'session.created',
    })

    assert.equal(realtimeOnly.ok, true)

    const delivered = await subscription.next(250)

    assert.ok(delivered)
    assert.equal(delivered?.type, 'session.created')
    assert.equal(delivered?.aggregateId, 'ses_realtime_fast_lane')

    const blockedRow = runtime.db
      .select()
      .from(eventOutbox)
      .all()
      .find(
        (row) =>
          row.topic === 'observability' &&
          row.eventId === (blocking.ok ? blocking.value.id : 'evt_missing'),
      )

    assert.equal(blockedRow?.status, 'processing')
  } finally {
    releaseBlockedExport?.()
    subscription.close()
    await runtime.services.events.outbox.stop()
    await runtime.services.observability.worker.stop()
  }
})
