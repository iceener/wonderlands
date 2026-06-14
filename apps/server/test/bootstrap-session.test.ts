import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'vitest'
import {
  domainEvents,
  eventOutbox,
  items,
  jobs,
  runs,
  sessionMessages,
  sessionThreads,
  workSessions,
  workspaces,
} from '../src/db/schema'
import type { AiInteractionResponse } from '../src/domain/ai/types'
import { ok } from '../src/shared/result'
import { createApiKeyAuthHeaders, seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const expectedInitialContent = [{ text: 'Plan the first milestone', type: 'text' as const }]

const assertNoBootstrapWrites = (runtime: ReturnType<typeof createTestHarness>['runtime']) => {
  assert.equal(runtime.db.select().from(workSessions).all().length, 0)
  assert.equal(runtime.db.select().from(sessionThreads).all().length, 0)
  assert.equal(runtime.db.select().from(sessionMessages).all().length, 0)
  assert.equal(runtime.db.select().from(runs).all().length, 0)
  assert.equal(runtime.db.select().from(jobs).all().length, 0)
  assert.equal(runtime.db.select().from(items).all().length, 0)
  assert.equal(runtime.db.select().from(domainEvents).all().length, 0)
  assert.equal(runtime.db.select().from(eventOutbox).all().length, 0)
}

const stubGeneratedIds = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  expectedCalls: Array<{ id: string; prefix: string }>,
) => {
  let index = 0

  runtime.services.ids.create = ((prefix: string) => {
    const nextCall = expectedCalls[index++]

    assert.ok(nextCall, `Unexpected ID request for prefix ${prefix}`)
    assert.equal(prefix, nextCall.prefix)

    return nextCall.id as `${typeof prefix}_${string}`
  }) as typeof runtime.services.ids.create
}

test('bootstrap session command creates session, thread, message, run, and events in one flow', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, assistantToolProfileId, headers, tenantId } = seedApiKeyAuth(runtime)

  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Plan the first milestone',
      title: 'Milestone planning',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  const body = await response.json()

  assert.equal(response.status, 201)
  assert.equal(body.ok, true)
  assert.ok(body.meta.requestId)
  assert.ok(body.meta.traceId)

  const sessions = runtime.db.select().from(workSessions).all()
  const threads = runtime.db.select().from(sessionThreads).all()
  const messages = runtime.db.select().from(sessionMessages).all()
  const createdRuns = runtime.db.select().from(runs).all()
  const createdJobs = runtime.db.select().from(jobs).all()
  const createdItems = runtime.db.select().from(items).all()
  const createdWorkspaces = runtime.db.select().from(workspaces).all()
  const createdEvents = runtime.db.select().from(domainEvents).all()
  const createdOutbox = runtime.db.select().from(eventOutbox).all()
  const expectedWorkspaceRoot = resolve(
    runtime.config.files.storage.root,
    '..',
    'workspaces',
    `ten_${tenantId}`,
    `acc_${accountId}`,
  )
  const expectedVaultRef = join(expectedWorkspaceRoot, 'vault')
  const expectedSessionRef = join(expectedWorkspaceRoot, 'sessions', body.data.sessionId)
  const expectedRunRef = join(expectedWorkspaceRoot, 'runs', body.data.runId)

  assert.equal(sessions.length, 1)
  assert.equal(threads.length, 1)
  assert.equal(messages.length, 1)
  assert.equal(createdRuns.length, 1)
  assert.equal(createdJobs.length, 1)
  assert.equal(createdWorkspaces.length, 1)
  assert.equal(createdItems.length, 0)
  assert.equal(createdEvents.length, 8)
  assert.equal(createdOutbox.length, createdEvents.length * 2)

  assert.equal(sessions[0]?.id, body.data.sessionId)
  assert.equal(sessions[0]?.createdByAccountId, 'acc_test')
  assert.equal(sessions[0]?.rootRunId, body.data.runId)
  assert.equal(sessions[0]?.title, 'Milestone planning')
  assert.equal(sessions[0]?.workspaceId, createdWorkspaces[0]?.id)
  assert.equal(sessions[0]?.workspaceRef, expectedSessionRef)

  assert.equal(threads[0]?.id, body.data.threadId)
  assert.equal(threads[0]?.sessionId, body.data.sessionId)
  assert.equal(threads[0]?.title, 'Milestone planning')

  assert.equal(messages[0]?.id, body.data.messageId)
  assert.equal(messages[0]?.runId, body.data.runId)
  assert.equal(messages[0]?.sessionId, body.data.sessionId)
  assert.equal(messages[0]?.threadId, body.data.threadId)
  assert.equal(messages[0]?.sequence, 1)
  assert.deepEqual(messages[0]?.content, expectedInitialContent)

  assert.equal(createdRuns[0]?.id, body.data.runId)
  assert.equal(createdRuns[0]?.rootRunId, body.data.runId)
  assert.equal(createdRuns[0]?.toolProfileId, assistantToolProfileId)
  assert.equal(createdRuns[0]?.sessionId, body.data.sessionId)
  assert.equal(createdRuns[0]?.task, 'Plan the first milestone')
  assert.equal(createdRuns[0]?.threadId, body.data.threadId)
  assert.equal(createdRuns[0]?.jobId, createdJobs[0]?.id)
  assert.equal(createdRuns[0]?.workspaceId, createdWorkspaces[0]?.id)
  assert.equal(createdRuns[0]?.workspaceRef, expectedRunRef)
  assert.equal(createdJobs[0]?.currentRunId, body.data.runId)
  assert.equal(createdJobs[0]?.kind, 'objective')
  assert.equal(createdJobs[0]?.rootJobId, createdJobs[0]?.id)
  assert.equal(createdJobs[0]?.sessionId, body.data.sessionId)
  assert.equal(createdJobs[0]?.status, 'queued')
  assert.equal(createdJobs[0]?.threadId, body.data.threadId)
  assert.equal(createdJobs[0]?.title, 'Plan the first milestone')
  assert.equal(createdWorkspaces[0]?.rootRef, expectedWorkspaceRoot)
  assert.equal(existsSync(join(expectedWorkspaceRoot, 'agents')), true)
  assert.equal(existsSync(expectedVaultRef), true)
  assert.equal(existsSync(expectedSessionRef), false)
  assert.equal(existsSync(expectedRunRef), false)

  const eventSummary = createdEvents
    .slice()
    .sort((left, right) => left.eventNo - right.eventNo)
    .map((event) => ({
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      payload: event.payload,
      type: event.type,
    }))

  assert.deepEqual(eventSummary, [
    {
      aggregateId: createdWorkspaces[0]?.id,
      aggregateType: 'workspace',
      payload: {
        accountId,
        kind: 'account_root',
        reason: 'session.bootstrap',
        rootRef: expectedWorkspaceRoot,
        rootRunId: body.data.runId,
        runId: body.data.runId,
        sessionId: body.data.sessionId,
        status: 'active',
        threadId: body.data.threadId,
        workspaceId: createdWorkspaces[0]?.id,
        workspaceRef: expectedRunRef,
      },
      type: 'workspace.created',
    },
    {
      aggregateId: createdWorkspaces[0]?.id,
      aggregateType: 'workspace',
      payload: {
        accountId,
        kind: 'account_root',
        reason: 'session.bootstrap',
        rootRef: expectedWorkspaceRoot,
        rootRunId: body.data.runId,
        runId: body.data.runId,
        sessionId: body.data.sessionId,
        status: 'active',
        threadId: body.data.threadId,
        workspaceId: createdWorkspaces[0]?.id,
        workspaceRef: expectedRunRef,
      },
      type: 'workspace.resolved',
    },
    {
      aggregateId: body.data.sessionId,
      aggregateType: 'work_session',
      payload: {
        sessionId: body.data.sessionId,
        title: 'Milestone planning',
      },
      type: 'session.created',
    },
    {
      aggregateId: body.data.threadId,
      aggregateType: 'session_thread',
      payload: {
        sessionId: body.data.sessionId,
        threadId: body.data.threadId,
      },
      type: 'thread.created',
    },
    {
      aggregateId: body.data.messageId,
      aggregateType: 'session_message',
      payload: {
        messageId: body.data.messageId,
        sessionId: body.data.sessionId,
        threadId: body.data.threadId,
      },
      type: 'message.posted',
    },
    {
      aggregateId: createdJobs[0]?.id,
      aggregateType: 'job',
      payload: {
        assignedAgentId: null,
        assignedAgentRevisionId: null,
        createdAt: createdJobs[0]?.createdAt,
        currentRunId: body.data.runId,
        kind: 'objective',
        parentJobId: null,
        rootJobId: createdJobs[0]?.id,
        runId: body.data.runId,
        sessionId: body.data.sessionId,
        status: 'queued',
        threadId: body.data.threadId,
        title: 'Plan the first milestone',
        jobId: createdJobs[0]?.id,
      },
      type: 'job.created',
    },
    {
      aggregateId: createdJobs[0]?.id,
      aggregateType: 'job',
      payload: {
        createdAt: createdJobs[0]?.createdAt,
        currentRunId: body.data.runId,
        kind: 'objective',
        parentJobId: null,
        rootJobId: createdJobs[0]?.id,
        runId: body.data.runId,
        sessionId: body.data.sessionId,
        status: 'queued',
        threadId: body.data.threadId,
        title: 'Plan the first milestone',
        updatedAt: createdJobs[0]?.updatedAt,
        jobId: createdJobs[0]?.id,
      },
      type: 'job.queued',
    },
    {
      aggregateId: body.data.runId,
      aggregateType: 'run',
      payload: {
        agentId: null,
        agentRevisionId: null,
        rootRunId: body.data.runId,
        runId: body.data.runId,
        sessionId: body.data.sessionId,
        targetKind: 'assistant',
        task: 'Plan the first milestone',
        threadId: body.data.threadId,
      },
      type: 'run.created',
    },
  ])

  const outboxTopicsByEventId = new Map<string, string[]>()

  for (const row of createdOutbox) {
    const topics = outboxTopicsByEventId.get(row.eventId) ?? []
    topics.push(row.topic)
    outboxTopicsByEventId.set(row.eventId, topics)
  }

  assert.equal(outboxTopicsByEventId.size, createdEvents.length)

  for (const event of createdEvents) {
    assert.deepEqual(outboxTopicsByEventId.get(event.id)?.slice().sort(), [
      'projection',
      'realtime',
    ])
  }
})

test('bootstrap session route executes the first run when execute is requested', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  runtime.services.ai.interactions.generate = async () =>
    ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Bootstrap executed immediately.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Bootstrap executed immediately.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Bootstrap executed immediately.',
      provider: 'openai',
      providerRequestId: 'req_bootstrap_execute_1',
      raw: { stub: true },
      responseId: 'resp_bootstrap_execute_1',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })

  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      execute: true,
      initialMessage: 'Plan the first milestone',
      title: 'Milestone planning',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const body = await response.json()

  assert.equal(response.status, 201)
  assert.equal(body.ok, true)
  assert.equal(body.data.status, 'completed')
  assert.equal(body.data.outputText, 'Bootstrap executed immediately.')
  assert.ok(body.data.inputMessageId)
  assert.ok(body.data.assistantMessageId)
  assert.ok(body.data.runId)
  assert.ok(body.data.sessionId)
  assert.ok(body.data.threadId)

  const messages = runtime.db.select().from(sessionMessages).all()
  const run = runtime.db.select().from(runs).all()[0]
  assert.equal(messages.length, 2)
  assert.equal(messages[0]?.id, body.data.inputMessageId)
  assert.equal(messages[1]?.id, body.data.assistantMessageId)
  assert.equal(messages[1]?.runId, body.data.runId)
  assert.equal(run?.status, 'completed')
})

test('bootstrap session leaves an untitled thread unnamed and queues auto naming in the background', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Design a clean title for this conversation in the background',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const body = await response.json()

  assert.equal(response.status, 201)
  assert.equal(body.ok, true)

  const sessionRow = runtime.db.select().from(workSessions).all()[0]
  const threadRow = runtime.db.select().from(sessionThreads).all()[0]
  const namingEvent = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .find((event) => event.type === 'thread.naming.requested')
  const namingOutboxRows = runtime.db
    .select()
    .from(eventOutbox)
    .all()
    .filter((row) => row.eventId === namingEvent?.id)
    .map((row) => row.topic)
    .sort()

  assert.equal(sessionRow?.title, null)
  assert.equal(threadRow?.title, null)
  assert.equal(threadRow?.titleSource ?? null, null)
  assert.deepEqual(namingEvent?.payload, {
    requestId: namingEvent?.payload.requestId,
    requestedAt: namingEvent?.payload.requestedAt,
    sessionId: body.data.sessionId,
    sourceRunId: body.data.runId,
    threadId: body.data.threadId,
    trigger: 'auto_first_message',
  })
  assert.deepEqual(namingOutboxRows, ['background', 'realtime'])
})

test('bootstrap session rejects API key auth when auth mode is disabled', async () => {
  const { app } = createTestHarness({
    AUTH_MODE: 'disabled',
    NODE_ENV: 'production',
  })

  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Plan the first milestone',
    }),
    headers: {
      ...createApiKeyAuthHeaders('sk_test_disabled', 'ten_test'),
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.ok, false)
  assert.equal(body.error.type, 'auth')
  assert.match(body.error.message, /API key auth is disabled/)
  assert.ok(body.meta.requestId)
  assert.ok(body.meta.traceId)
})

test('bootstrap session rejects tenant-scoped writes without matching membership', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime, {
    includeMembership: false,
  })

  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Plan the first milestone',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  const body = await response.json()

  assert.equal(response.status, 403)
  assert.equal(body.ok, false)
  assert.equal(body.error.type, 'permission')
  assert.ok(body.meta.requestId)
  assert.ok(body.meta.traceId)
  assertNoBootstrapWrites(runtime)
})

test('bootstrap session returns validation error for malformed JSON bodies', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: '{"initialMessage":',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  const body = await response.json()

  assert.equal(response.status, 400)
  assert.equal(body.ok, false)
  assert.equal(body.error.type, 'validation')
  assert.match(body.error.message, /Malformed JSON request body/)
  assert.ok(body.meta.requestId)
  assert.ok(body.meta.traceId)
  assertNoBootstrapWrites(runtime)
})

test('bootstrap session rejects invalid API keys', async () => {
  const { app } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })

  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Plan the first milestone',
    }),
    headers: {
      ...createApiKeyAuthHeaders('sk_test_invalid', 'ten_test'),
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.ok, false)
  assert.equal(body.error.type, 'auth')
  assert.match(body.error.message, /Invalid API key/)
})

test('bootstrap session rejects expired API keys', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime, {
    expiresAt: '2026-03-28T00:00:00.000Z',
  })

  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Plan the first milestone',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.ok, false)
  assert.equal(body.error.type, 'auth')
  assert.match(body.error.message, /API key has expired/)
})

test('bootstrap session requires tenant selection for API key auth', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { secret } = seedApiKeyAuth(runtime)

  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Plan the first milestone',
    }),
    headers: {
      ...createApiKeyAuthHeaders(secret),
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  const body = await response.json()

  assert.equal(response.status, 403)
  assert.equal(body.ok, false)
  assert.equal(body.error.type, 'permission')
})

test('bootstrap session rolls back earlier writes when a later insert fails', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: 'acc_test',
      deletedAt: null,
      id: 'ses_existing',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId: 'ten_test',
      title: 'Existing session',
      updatedAt: '2026-03-29T00:00:00.000Z',
      workspaceRef: null,
    })
    .run()

  runtime.db
    .insert(sessionThreads)
    .values({
      createdAt: '2026-03-29T00:00:00.000Z',
      createdByAccountId: 'acc_test',
      id: 'thr_conflict',
      parentThreadId: null,
      sessionId: 'ses_existing',
      status: 'active',
      tenantId: 'ten_test',
      title: 'Existing thread',
      updatedAt: '2026-03-29T00:00:00.000Z',
    })
    .run()

  stubGeneratedIds(runtime, [
    { id: 'ses_new', prefix: 'ses' },
    { id: 'thr_conflict', prefix: 'thr' },
    { id: 'msg_new', prefix: 'msg' },
    { id: 'run_new', prefix: 'run' },
    { id: 'job_new', prefix: 'wki' },
    { id: 'itm_new', prefix: 'itm' },
  ])

  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Plan the first milestone',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  const body = await response.json()

  assert.equal(response.status, 409)
  assert.equal(body.ok, false)
  assert.equal(body.error.type, 'conflict')
  assert.equal(runtime.db.select().from(workSessions).all().length, 1)
  assert.equal(runtime.db.select().from(sessionThreads).all().length, 1)
  assert.equal(runtime.db.select().from(sessionMessages).all().length, 0)
  assert.equal(runtime.db.select().from(runs).all().length, 0)
  assert.equal(runtime.db.select().from(jobs).all().length, 0)
  assert.equal(runtime.db.select().from(items).all().length, 0)
  assert.equal(runtime.db.select().from(domainEvents).all().length, 0)
  assert.equal(runtime.db.select().from(eventOutbox).all().length, 0)
})

test('bootstrap session rolls back state when outbox creation fails after domain event work starts', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const originalRandomUuid = crypto.randomUUID

  stubGeneratedIds(runtime, [
    { id: 'ses_tx', prefix: 'ses' },
    { id: 'thr_tx', prefix: 'thr' },
    { id: 'msg_tx', prefix: 'msg' },
    { id: 'run_tx', prefix: 'run' },
    { id: 'job_tx', prefix: 'wki' },
    { id: 'itm_tx', prefix: 'itm' },
  ])

  crypto.randomUUID = () => '11111111-1111-1111-1111-111111111111'

  try {
    const response = await app.request('http://local/v1/sessions/bootstrap', {
      body: JSON.stringify({
        initialMessage: 'Plan the first milestone',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    })

    const body = await response.json()

    assert.equal(response.status, 409)
    assert.equal(body.ok, false)
    assert.equal(body.error.type, 'conflict')
    assertNoBootstrapWrites(runtime)
  } finally {
    crypto.randomUUID = originalRandomUuid
  }
})
