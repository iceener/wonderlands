import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'vitest'

import {
  domainEvents,
  eventOutbox,
  jobs,
  runs,
  sessionThreads,
  tenantMemberships,
  workSessions,
  workspaces,
} from '../src/db/schema'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

test('create session route writes a tenant-scoped work session without creating a thread or run', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)

  const response = await app.request('http://local/v1/sessions', {
    body: JSON.stringify({
      metadata: {
        origin: 'test',
      },
      title: 'Explicit session',
      workspaceRef: 'workspace://explicit-session',
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

  const sessionRows = runtime.db.select().from(workSessions).all()
  const threadRows = runtime.db.select().from(sessionThreads).all()
  const runRows = runtime.db.select().from(runs).all()
  const workspaceRows = runtime.db.select().from(workspaces).all()
  const eventRows = runtime.db.select().from(domainEvents).all()
  const outboxRows = runtime.db.select().from(eventOutbox).all()
  const sortedEvents = eventRows.slice().sort((left, right) => left.eventNo - right.eventNo)
  const expectedWorkspaceRoot = resolve(
    runtime.config.files.storage.root,
    '..',
    'workspaces',
    `ten_${tenantId}`,
    `acc_${accountId}`,
  )
  const expectedVaultRef = join(expectedWorkspaceRoot, 'vault')
  const expectedSessionRef = join(expectedWorkspaceRoot, 'sessions', body.data.id)

  assert.equal(sessionRows.length, 1)
  assert.equal(threadRows.length, 0)
  assert.equal(runRows.length, 0)
  assert.equal(workspaceRows.length, 1)
  assert.equal(sessionRows[0]?.id, body.data.id)
  assert.equal(sessionRows[0]?.title, 'Explicit session')
  assert.equal(sessionRows[0]?.rootRunId, null)
  assert.equal(sessionRows[0]?.workspaceId, workspaceRows[0]?.id)
  assert.equal(sessionRows[0]?.workspaceRef, expectedSessionRef)
  assert.deepEqual(sessionRows[0]?.metadata, {
    origin: 'test',
  })
  assert.equal(workspaceRows[0]?.accountId, accountId)
  assert.equal(workspaceRows[0]?.tenantId, tenantId)
  assert.equal(workspaceRows[0]?.kind, 'account_root')
  assert.equal(workspaceRows[0]?.rootRef, expectedWorkspaceRoot)
  assert.equal(existsSync(expectedWorkspaceRoot), true)
  assert.equal(existsSync(join(expectedWorkspaceRoot, 'agents')), true)
  assert.equal(existsSync(expectedVaultRef), true)
  assert.equal(existsSync(expectedSessionRef), false)
  assert.deepEqual(
    sortedEvents.map((event) => event.type),
    ['workspace.created', 'workspace.resolved', 'session.created'],
  )
  assert.deepEqual(sortedEvents[1]?.payload, {
    accountId,
    kind: 'account_root',
    reason: 'session.create',
    rootRef: expectedWorkspaceRoot,
    sessionId: body.data.id,
    status: 'active',
    workspaceId: workspaceRows[0]?.id,
    workspaceRef: expectedSessionRef,
  })
  assert.equal(outboxRows.length, 6)
})

test('create session thread route creates a thread under an existing session and emits thread.created', async () => {
  const { app, runtime } = createTestHarness({
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

  const response = await app.request(`http://local/v1/sessions/${sessionBody.data.id}/threads`, {
    body: JSON.stringify({
      title: 'Main thread',
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

  const threadRows = runtime.db.select().from(sessionThreads).all()
  const eventRows = runtime.db.select().from(domainEvents).all()

  assert.equal(threadRows.length, 1)
  assert.equal(threadRows[0]?.id, body.data.id)
  assert.equal(threadRows[0]?.sessionId, sessionBody.data.id)
  assert.equal(threadRows[0]?.title, 'Main thread')
  assert.equal(threadRows[0]?.parentThreadId, null)
  assert.equal(eventRows.at(-1)?.type, 'thread.created')
  assert.deepEqual(eventRows.at(-1)?.payload, {
    parentThreadId: null,
    sessionId: sessionBody.data.id,
    threadId: body.data.id,
  })
})

test('get run route returns the tenant-scoped run record', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const bootstrapResponse = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Plan the next milestone for the API backend',
      title: 'Milestone planning',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const bootstrap = await bootstrapResponse.json()

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}`, {
    headers,
    method: 'GET',
  })

  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.data.id, bootstrap.data.runId)
  assert.equal(body.data.sessionId, bootstrap.data.sessionId)
  assert.equal(body.data.threadId, bootstrap.data.threadId)
  assert.equal(body.data.status, 'pending')
  assert.equal(body.data.targetKind, 'assistant')
  assert.equal(body.data.toolProfileId, 'tpf_assistant_test')
  assert.equal(body.data.job?.id, runtime.db.select().from(jobs).get()?.id)
  assert.equal(body.data.job?.currentRunId, bootstrap.data.runId)
  assert.equal(body.data.job?.status, 'queued')
  assert.equal(body.data.job?.parentJobId, null)
  assert.deepEqual(body.data.job?.edges, [])
})

test('create session ignores caller-supplied workspace refs and isolates account-owned roots', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const firstAuth = seedApiKeyAuth(runtime, {
    accountId: 'acc_first',
    apiKeyId: 'key_first',
    secret: 'sk_first_1234567890',
    tenantId: 'ten_shared',
  })
  const secondAuth = seedApiKeyAuth(runtime, {
    accountId: 'acc_second',
    accountEmail: 'second@example.com',
    apiKeyId: 'key_second',
    includeMembership: false,
    includeTenant: false,
    secret: 'sk_second_1234567890',
    tenantId: 'ten_shared',
  })
  runtime.db
    .insert(tenantMemberships)
    .values({
      accountId: 'acc_second',
      createdAt: '2026-03-29T00:00:00.000Z',
      id: 'mem_ten_shared_second',
      role: 'admin',
      tenantId: 'ten_shared',
    })
    .run()

  const firstResponse = await app.request('http://local/v1/sessions', {
    body: JSON.stringify({
      title: 'First session',
    }),
    headers: {
      ...firstAuth.headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const firstBody = await firstResponse.json()

  const secondResponse = await app.request('http://local/v1/sessions', {
    body: JSON.stringify({
      title: 'Second session',
      workspaceRef: 'workspace://reuse-first-account',
    }),
    headers: {
      ...secondAuth.headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const secondBody = await secondResponse.json()

  assert.equal(firstResponse.status, 201)
  assert.equal(secondResponse.status, 201)

  const sessionRows = runtime.db
    .select()
    .from(workSessions)
    .orderBy(workSessions.createdAt, workSessions.id)
    .all()

  assert.equal(sessionRows.length, 2)
  assert.notEqual(sessionRows[0]?.workspaceId, sessionRows[1]?.workspaceId)
  assert.notEqual(sessionRows[0]?.workspaceRef, sessionRows[1]?.workspaceRef)
  assert.equal(sessionRows[0]?.id, firstBody.data.id)
  assert.equal(sessionRows[1]?.id, secondBody.data.id)
  assert.match(sessionRows[0]?.workspaceRef ?? '', /acc_acc_first\/sessions\//)
  assert.match(sessionRows[1]?.workspaceRef ?? '', /acc_acc_second\/sessions\//)
  assert.equal(
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.type === 'workspace.created').length,
    2,
  )
  assert.equal(
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.type === 'workspace.resolved').length,
    2,
  )
})
