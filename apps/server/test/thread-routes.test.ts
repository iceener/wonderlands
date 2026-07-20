import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { test } from 'vitest'
import {
  accountThreadActivitySeen,
  contextSummaries,
  domainEvents,
  eventOutbox,
  fileLinks,
  files,
  items,
  jobs,
  memoryRecordSources,
  memoryRecords,
  runClaims,
  runDependencies,
  runs,
  sessionMessages,
  sessionThreads,
  tenantMemberships,
  tenants,
  toolExecutions,
  uploads,
  usageLedger,
  workSessions,
} from '../src/db/schema'
import type { AiInteractionRequest, AiInteractionResponse } from '../src/domain/ai/types'
import { ok } from '../src/shared/result'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { assertAcceptedThreadInteraction } from './helpers/assert-accepted-thread-interaction'
import { createTestHarness } from './helpers/create-test-app'
import { grantNativeToolToDefaultAgent } from './helpers/grant-native-tool-agent'

const bootstrapThread = async (
  app: ReturnType<typeof createTestHarness>['app'],
  headers: Record<string, string>,
) => {
  const response = await app.request('http://local/v1/sessions/bootstrap', {
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

  assert.equal(response.status, 201)

  return response.json()
}

const registerImmediateFunctionTool = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    name: string
    output: unknown
  },
) => {
  grantNativeToolToDefaultAgent(runtime, input.name)

  runtime.services.tools.register({
    description: `Thread route test tool ${input.name}`,
    domain: 'native',
    execute: async () =>
      ok({
        kind: 'immediate',
        output: input.output,
      }),
    inputSchema: {
      additionalProperties: false,
      properties: {},
      required: [],
      type: 'object',
    },
    name: input.name,
  })
}

test('thread interaction returns 202 Accepted with accepted status and a run id', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const sessionResponse = await app.request('http://local/v1/sessions', {
    body: JSON.stringify({
      title: 'Accepted interaction contract',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const sessionBody = await sessionResponse.json()

  assert.equal(sessionResponse.status, 201)

  const threadResponse = await app.request(
    `http://local/v1/sessions/${sessionBody.data.id}/threads`,
    {
      body: JSON.stringify({
        title: 'Accepted interaction contract thread',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const threadBody = await threadResponse.json()

  assert.equal(threadResponse.status, 201)

  const interactionResponse = await app.request(
    `http://local/v1/threads/${threadBody.data.id}/interactions`,
    {
      body: JSON.stringify({
        text: 'Start the next step for this thread.',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const interactionBody = await interactionResponse.json()

  const runId = assertAcceptedThreadInteraction(interactionResponse, interactionBody)

  assert.deepEqual(interactionBody.data.attachedFileIds, [])
  assert.equal(typeof interactionBody.data.inputMessageId, 'string')
  assert.equal(typeof interactionBody.data.sessionId, 'string')
  assert.equal(typeof interactionBody.data.threadId, 'string')

  const runRow = runtime.db.select().from(runs).where(eq(runs.id, runId)).get()

  assert.equal(runRow?.id, runId)
  assert.equal(runRow?.threadId, threadBody.data.id)
})

const minutesAgo = (baseIso: string, minutes: number): string =>
  new Date(Date.parse(baseIso) - minutes * 60_000).toISOString()

const getRootJobRow = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  threadId: string,
) =>
  runtime.db
    .select()
    .from(jobs)
    .where(eq(jobs.threadId, threadId))
    .all()
    .find((job) => job.parentJobId === null)

const updateRootThreadActivity = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    jobPatch?: Partial<typeof jobs.$inferInsert>
    runPatch?: Partial<typeof runs.$inferInsert>
    threadId: string
  },
) => {
  const rootJob = getRootJobRow(runtime, input.threadId)

  assert.ok(rootJob)

  if (input.jobPatch) {
    runtime.db.update(jobs).set(input.jobPatch).where(eq(jobs.id, rootJob.id)).run()
  }

  if (input.runPatch && rootJob.currentRunId) {
    runtime.db.update(runs).set(input.runPatch).where(eq(runs.id, rootJob.currentRunId)).run()
  }

  return {
    jobId: rootJob.id,
    runId: rootJob.currentRunId,
  }
}

const insertPendingWait = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    callId: string
    createdAt: string
    domain: 'mcp' | 'native' | 'provider' | 'system'
    runId: string
    targetKind:
      | 'external'
      | 'human_response'
      | 'mcp_operation'
      | 'run'
      | 'tool_execution'
      | 'upload'
    tool: string
    type: 'agent' | 'human' | 'mcp' | 'tool' | 'upload'
    waitId: string
  },
) => {
  runtime.db
    .insert(toolExecutions)
    .values({
      createdAt: input.createdAt,
      domain: input.domain,
      id: input.callId,
      runId: input.runId,
      startedAt: input.createdAt,
      tenantId: 'ten_shared',
      tool: input.tool,
    })
    .run()

  runtime.db
    .insert(runDependencies)
    .values({
      callId: input.callId,
      createdAt: input.createdAt,
      id: input.waitId,
      runId: input.runId,
      status: 'pending',
      targetKind: input.targetKind,
      tenantId: 'ten_shared',
      type: input.type,
    })
    .run()
}

const seedSharedTenantUsers = (runtime: ReturnType<typeof createTestHarness>['runtime']) => {
  const owner = seedApiKeyAuth(runtime, {
    accountEmail: 'owner@example.com',
    accountId: 'acc_owner',
    accountName: 'Owner',
    apiKeyId: 'key_owner',
    role: 'member',
    secret: 'sk_owner_1234567890',
    tenantId: 'ten_shared',
  })
  const member = seedApiKeyAuth(runtime, {
    accountEmail: 'member@example.com',
    accountId: 'acc_member',
    accountName: 'Member',
    apiKeyId: 'key_member',
    includeMembership: false,
    includeTenant: false,
    role: 'member',
    secret: 'sk_member_1234567890',
    tenantId: 'ten_shared',
  })
  const admin = seedApiKeyAuth(runtime, {
    accountEmail: 'admin@example.com',
    accountId: 'acc_admin',
    accountName: 'Admin',
    apiKeyId: 'key_admin',
    includeMembership: false,
    includeTenant: false,
    role: 'admin',
    secret: 'sk_admin_1234567890',
    tenantId: 'ten_shared',
  })

  runtime.db
    .insert(tenantMemberships)
    .values([
      {
        accountId: member.accountId,
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'mem_ten_shared_member',
        role: 'member',
        tenantId: member.tenantId,
      },
      {
        accountId: admin.accountId,
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'mem_ten_shared_admin',
        role: 'admin',
        tenantId: admin.tenantId,
      },
    ])
    .run()

  return {
    admin,
    member,
    owner,
  }
}

const appendTestEvent = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    aggregateId: string
    aggregateType: string
    id: string
    payload: Record<string, unknown>
    tenantId: string
    type: string
  },
) => {
  const currentEventNo = Math.max(
    0,
    ...runtime.db
      .select()
      .from(domainEvents)
      .all()
      .map((row) => row.eventNo),
  )
  const createdAt = '2026-03-30T14:00:00.000Z'

  runtime.db
    .insert(domainEvents)
    .values({
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      category: 'domain',
      createdAt,
      eventNo: currentEventNo + 1,
      id: input.id,
      payload: input.payload,
      tenantId: input.tenantId,
      type: input.type,
    })
    .run()

  runtime.db
    .insert(eventOutbox)
    .values({
      availableAt: createdAt,
      createdAt,
      eventId: input.id,
      id: `out_${input.id}`,
      status: 'pending',
      tenantId: input.tenantId,
      topic: 'realtime',
    })
    .run()
}

const writeTestBlob = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  storageKey: string,
  contents: string,
) => {
  const absolutePath = resolve(runtime.config.files.storage.root, '..', storageKey)

  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, contents)

  return absolutePath
}

test('post thread message appends a visible user message without creating a run', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapThread(app, headers)

  const response = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/messages`,
    {
      body: JSON.stringify({
        text: 'Follow up with a narrower delivery plan',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  const body = await response.json()

  assert.equal(response.status, 201)
  assert.equal(body.ok, true)

  const messageRows = runtime.db.select().from(sessionMessages).all()
  const runRows = runtime.db.select().from(runs).all()
  const eventRows = runtime.db.select().from(domainEvents).all()

  assert.equal(messageRows.length, 2)
  assert.equal(runRows.length, 1)
  assert.equal(messageRows[1]?.id, body.data.messageId)
  assert.equal(messageRows[1]?.runId, null)
  assert.equal(messageRows[1]?.sequence, 2)
  assert.equal(messageRows[1]?.threadId, bootstrap.data.threadId)
  assert.deepEqual(messageRows[1]?.content, [
    { text: 'Follow up with a narrower delivery plan', type: 'text' },
  ])
  assert.equal(eventRows.at(-1)?.type, 'message.posted')
})

test('thread detail and listing expose the latest root work item read model', async () => {
  {
    const { app, runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { headers } = seedApiKeyAuth(runtime)
    const bootstrap = await bootstrapThread(app, headers)

    const response = await app.request(`http://local/v1/threads/${bootstrap.data.threadId}`, {
      headers,
      method: 'GET',
    })
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.data.id, bootstrap.data.threadId)
    assert.equal(body.data.rootJob?.currentRunId, bootstrap.data.runId)
    assert.equal(body.data.rootJob?.status, 'queued')
    assert.equal(body.data.rootJob?.parentJobId, null)
    assert.equal(body.data.rootJob?.edges.length, 0)
  }

  {
    const { app, runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { headers } = seedApiKeyAuth(runtime)
    const bootstrap = await bootstrapThread(app, headers)

    const response = await app.request('http://local/v1/threads?limit=5', {
      headers,
    })
    const body = await response.json()
    const listedThread = body.data.threads.find(
      (thread: { id: string }) => thread.id === bootstrap.data.threadId,
    )

    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(listedThread?.rootJob?.currentRunId, bootstrap.data.runId)
    assert.equal(listedThread?.rootJob?.status, 'queued')
  }
})
test('list threads is scoped to the current account, including admin callers', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { admin, member, owner } = seedSharedTenantUsers(runtime)
  const ownerBootstrap = await bootstrapThread(app, owner.headers)
  const memberBootstrap = await bootstrapThread(app, member.headers)
  const adminBootstrap = await bootstrapThread(app, admin.headers)

  const ownerResponse = await app.request('http://local/v1/threads?limit=10', {
    headers: owner.headers,
  })
  const ownerBody = await ownerResponse.json()
  const ownerThreadIds = ownerBody.data.threads.map((thread: { id: string }) => thread.id)

  assert.equal(ownerResponse.status, 200)
  assert.equal(ownerBody.ok, true)
  assert.deepEqual(ownerThreadIds, [ownerBootstrap.data.threadId])
  assert.ok(!ownerThreadIds.includes(memberBootstrap.data.threadId))
  assert.ok(!ownerThreadIds.includes(adminBootstrap.data.threadId))

  const memberResponse = await app.request('http://local/v1/threads?limit=10', {
    headers: member.headers,
  })
  const memberBody = await memberResponse.json()
  const memberThreadIds = memberBody.data.threads.map((thread: { id: string }) => thread.id)

  assert.equal(memberResponse.status, 200)
  assert.equal(memberBody.ok, true)
  assert.deepEqual(memberThreadIds, [memberBootstrap.data.threadId])
  assert.ok(!memberThreadIds.includes(ownerBootstrap.data.threadId))
  assert.ok(!memberThreadIds.includes(adminBootstrap.data.threadId))

  const adminResponse = await app.request('http://local/v1/threads?limit=10', {
    headers: admin.headers,
  })
  const adminBody = await adminResponse.json()
  const adminThreadIds = adminBody.data.threads.map((thread: { id: string }) => thread.id)

  assert.equal(adminResponse.status, 200)
  assert.equal(adminBody.ok, true)
  assert.deepEqual(adminThreadIds, [adminBootstrap.data.threadId])
  assert.ok(!adminThreadIds.includes(ownerBootstrap.data.threadId))
  assert.ok(!adminThreadIds.includes(memberBootstrap.data.threadId))
})

test('list thread activity is account-scoped, root-only, ordered, and derives approval and waiting states', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { admin, owner } = seedSharedTenantUsers(runtime)
  const approvalBootstrap = await bootstrapThread(app, owner.headers)
  const failedBootstrap = await bootstrapThread(app, owner.headers)
  const waitingBootstrap = await bootstrapThread(app, owner.headers)
  const runningBootstrap = await bootstrapThread(app, owner.headers)
  const pendingBootstrap = await bootstrapThread(app, owner.headers)
  const completedRecentBootstrap = await bootstrapThread(app, owner.headers)
  const completedOldBootstrap = await bootstrapThread(app, owner.headers)
  const adminBootstrap = await bootstrapThread(app, admin.headers)

  const nowIso = runtime.services.clock.nowIso()
  const approvalAt = minutesAgo(nowIso, 1)
  const failedAt = minutesAgo(nowIso, 2)
  const waitingAt = minutesAgo(nowIso, 3)
  const runningAt = minutesAgo(nowIso, 4)
  const pendingAt = minutesAgo(nowIso, 5)
  const completedRecentAt = minutesAgo(nowIso, 6)
  const completedOldAt = minutesAgo(nowIso, 90)

  const approvalRoot = updateRootThreadActivity(runtime, {
    jobPatch: {
      status: 'waiting',
      updatedAt: approvalAt,
    },
    runPatch: {
      lastProgressAt: approvalAt,
      status: 'waiting',
      updatedAt: approvalAt,
    },
    threadId: approvalBootstrap.data.threadId,
  })
  const waitingRoot = updateRootThreadActivity(runtime, {
    jobPatch: {
      status: 'waiting',
      updatedAt: waitingAt,
    },
    runPatch: {
      lastProgressAt: waitingAt,
      status: 'waiting',
      updatedAt: waitingAt,
    },
    threadId: waitingBootstrap.data.threadId,
  })

  assert.ok(approvalRoot.runId)
  assert.ok(waitingRoot.runId)

  insertPendingWait(runtime, {
    callId: 'call_activity_approval',
    createdAt: approvalAt,
    domain: 'mcp',
    runId: approvalRoot.runId,
    targetKind: 'human_response',
    tool: 'delegate_to_agent',
    type: 'human',
    waitId: 'dep_activity_approval',
  })
  insertPendingWait(runtime, {
    callId: 'call_activity_waiting',
    createdAt: waitingAt,
    domain: 'native',
    runId: waitingRoot.runId,
    targetKind: 'external',
    tool: 'external_gate',
    type: 'tool',
    waitId: 'dep_activity_waiting',
  })

  updateRootThreadActivity(runtime, {
    jobPatch: {
      status: 'blocked',
      updatedAt: failedAt,
    },
    runPatch: {
      completedAt: failedAt,
      lastProgressAt: failedAt,
      status: 'failed',
      updatedAt: failedAt,
    },
    threadId: failedBootstrap.data.threadId,
  })
  updateRootThreadActivity(runtime, {
    jobPatch: {
      status: 'running',
      updatedAt: runningAt,
    },
    runPatch: {
      lastProgressAt: runningAt,
      status: 'running',
      updatedAt: runningAt,
    },
    threadId: runningBootstrap.data.threadId,
  })
  updateRootThreadActivity(runtime, {
    jobPatch: {
      status: 'queued',
      updatedAt: pendingAt,
    },
    runPatch: {
      lastProgressAt: pendingAt,
      status: 'pending',
      updatedAt: pendingAt,
    },
    threadId: pendingBootstrap.data.threadId,
  })
  updateRootThreadActivity(runtime, {
    jobPatch: {
      completedAt: completedRecentAt,
      status: 'completed',
      updatedAt: completedRecentAt,
    },
    runPatch: {
      completedAt: completedRecentAt,
      lastProgressAt: completedRecentAt,
      status: 'completed',
      updatedAt: completedRecentAt,
    },
    threadId: completedRecentBootstrap.data.threadId,
  })
  updateRootThreadActivity(runtime, {
    jobPatch: {
      completedAt: completedOldAt,
      status: 'completed',
      updatedAt: completedOldAt,
    },
    runPatch: {
      completedAt: completedOldAt,
      lastProgressAt: completedOldAt,
      status: 'completed',
      updatedAt: completedOldAt,
    },
    threadId: completedOldBootstrap.data.threadId,
  })
  updateRootThreadActivity(runtime, {
    jobPatch: {
      status: 'running',
      updatedAt: runningAt,
    },
    runPatch: {
      lastProgressAt: runningAt,
      status: 'running',
      updatedAt: runningAt,
    },
    threadId: adminBootstrap.data.threadId,
  })

  runtime.db
    .insert(sessionThreads)
    .values({
      branchFromMessageId: null,
      branchFromSequence: null,
      createdAt: waitingAt,
      createdByAccountId: owner.accountId,
      id: 'thr_child_activity',
      parentThreadId: approvalBootstrap.data.threadId,
      sessionId: approvalBootstrap.data.sessionId,
      status: 'active',
      tenantId: owner.tenantId,
      title: 'Child activity thread',
      titleSource: null,
      updatedAt: waitingAt,
    })
    .run()
  runtime.db
    .insert(runs)
    .values({
      completedAt: null,
      configSnapshot: { model: 'gpt-5.4', provider: 'openai', version: 'test' },
      createdAt: waitingAt,
      id: 'run_child_activity',
      lastProgressAt: waitingAt,
      parentRunId: null,
      resultJson: null,
      rootRunId: 'run_child_activity',
      sessionId: approvalBootstrap.data.sessionId,
      startedAt: waitingAt,
      status: 'running',
      task: 'Child activity thread run',
      tenantId: owner.tenantId,
      targetKind: 'assistant',
      threadId: 'thr_child_activity',
      toolProfileId: null,
      turnCount: 0,
      updatedAt: waitingAt,
      version: 1,
      workspaceRef: '/tmp/workspaces/run_child_activity',
    })
    .run()
  runtime.db
    .insert(jobs)
    .values({
      completedAt: null,
      createdAt: waitingAt,
      currentRunId: 'run_child_activity',
      id: 'job_child_activity',
      kind: 'run',
      parentJobId: null,
      queuedAt: waitingAt,
      rootJobId: 'job_child_activity',
      sessionId: approvalBootstrap.data.sessionId,
      status: 'running',
      tenantId: owner.tenantId,
      threadId: 'thr_child_activity',
      title: 'Child activity job',
      updatedAt: waitingAt,
      version: 1,
    })
    .run()

  const response = await app.request('http://local/v1/threads/activity', {
    headers: owner.headers,
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.deepEqual(
    body.data.threads.map((thread: { id: string }) => thread.id),
    [
      approvalBootstrap.data.threadId,
      failedBootstrap.data.threadId,
      waitingBootstrap.data.threadId,
      runningBootstrap.data.threadId,
      pendingBootstrap.data.threadId,
      completedRecentBootstrap.data.threadId,
    ],
  )

  const activityByThreadId = new Map(
    body.data.threads.map(
      (thread: {
        activity: { completedAt: string | null; label: string; state: string }
        id: string
      }) => [thread.id, thread.activity],
    ),
  )

  assert.deepEqual(activityByThreadId.get(approvalBootstrap.data.threadId), {
    completedAt: null,
    label: 'Approve',
    state: 'approval',
    updatedAt: approvalAt,
  })
  assert.deepEqual(activityByThreadId.get(failedBootstrap.data.threadId), {
    completedAt: null,
    label: 'Failed',
    state: 'failed',
    updatedAt: failedAt,
  })
  assert.deepEqual(activityByThreadId.get(waitingBootstrap.data.threadId), {
    completedAt: null,
    label: 'Waiting',
    state: 'waiting',
    updatedAt: waitingAt,
  })
  assert.deepEqual(activityByThreadId.get(runningBootstrap.data.threadId), {
    completedAt: null,
    label: 'Running',
    state: 'running',
    updatedAt: runningAt,
  })
  assert.deepEqual(activityByThreadId.get(pendingBootstrap.data.threadId), {
    completedAt: null,
    label: 'Pending',
    state: 'pending',
    updatedAt: pendingAt,
  })
  assert.deepEqual(activityByThreadId.get(completedRecentBootstrap.data.threadId), {
    completedAt: completedRecentAt,
    label: 'Done',
    state: 'completed',
    updatedAt: completedRecentAt,
  })
  assert.ok(!activityByThreadId.has(completedOldBootstrap.data.threadId))
  assert.ok(!activityByThreadId.has(adminBootstrap.data.threadId))
  assert.ok(!activityByThreadId.has('thr_child_activity'))

  const adminResponse = await app.request('http://local/v1/threads/activity', {
    headers: admin.headers,
  })
  const adminBody = await adminResponse.json()

  assert.equal(adminResponse.status, 200)
  assert.equal(adminBody.ok, true)
  assert.deepEqual(
    adminBody.data.threads.map((thread: { id: string }) => thread.id),
    [adminBootstrap.data.threadId],
  )
  assert.equal(adminBody.data.threads[0]?.activity.state, 'running')
})

test('seen activity tracks completed and failed root-run generations', async () => {
  {
    const { app, runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
    const bootstrap = await bootstrapThread(app, headers)
    const completedAt = minutesAgo(runtime.services.clock.nowIso(), 5)

    updateRootThreadActivity(runtime, {
      jobPatch: {
        completedAt,
        status: 'completed',
        updatedAt: completedAt,
      },
      runPatch: {
        completedAt,
        lastProgressAt: completedAt,
        status: 'completed',
        updatedAt: completedAt,
      },
      threadId: bootstrap.data.threadId,
    })

    const seenResponse = await app.request(
      `http://local/v1/threads/${bootstrap.data.threadId}/activity/seen`,
      {
        headers,
        method: 'POST',
      },
    )

    assert.equal(seenResponse.status, 204)

    const seenRow = runtime.db
      .select()
      .from(accountThreadActivitySeen)
      .where(eq(accountThreadActivitySeen.threadId, bootstrap.data.threadId))
      .get()

    assert.deepEqual(seenRow, {
      accountId,
      seenCompletedAt: completedAt,
      seenCompletedRunId: bootstrap.data.runId,
      tenantId,
      threadId: bootstrap.data.threadId,
      updatedAt: seenRow?.updatedAt,
    })
    assert.ok(typeof seenRow?.updatedAt === 'string' && seenRow.updatedAt.length > 0)

    const activityResponse = await app.request('http://local/v1/threads/activity', {
      headers,
    })
    const activityBody = await activityResponse.json()

    assert.equal(activityResponse.status, 200)
    assert.equal(activityBody.ok, true)
    assert.deepEqual(activityBody.data.threads, [])
  }

  {
    const { app, runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { headers } = seedApiKeyAuth(runtime)
    const bootstrap = await bootstrapThread(app, headers)
    const firstCompletedAt = minutesAgo(runtime.services.clock.nowIso(), 10)

    updateRootThreadActivity(runtime, {
      jobPatch: {
        completedAt: firstCompletedAt,
        status: 'completed',
        updatedAt: firstCompletedAt,
      },
      runPatch: {
        completedAt: firstCompletedAt,
        lastProgressAt: firstCompletedAt,
        status: 'completed',
        updatedAt: firstCompletedAt,
      },
      threadId: bootstrap.data.threadId,
    })

    const seenResponse = await app.request(
      `http://local/v1/threads/${bootstrap.data.threadId}/activity/seen`,
      {
        headers,
        method: 'POST',
      },
    )

    assert.equal(seenResponse.status, 204)

    const hiddenActivityResponse = await app.request('http://local/v1/threads/activity', {
      headers,
    })
    const hiddenActivityBody = await hiddenActivityResponse.json()

    assert.equal(hiddenActivityResponse.status, 200)
    assert.equal(hiddenActivityBody.ok, true)
    assert.deepEqual(hiddenActivityBody.data.threads, [])

    const secondInteractionResponse = await app.request(
      `http://local/v1/threads/${bootstrap.data.threadId}/interactions`,
      {
        body: JSON.stringify({
          text: 'Continue from the finished result with a narrower plan.',
        }),
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )
    const secondInteractionBody = await secondInteractionResponse.json()

    assert.equal(secondInteractionResponse.status, 202)
    assert.notEqual(secondInteractionBody.data.runId, bootstrap.data.runId)

    const activeActivityResponse = await app.request('http://local/v1/threads/activity', {
      headers,
    })
    const activeActivityBody = await activeActivityResponse.json()

    assert.equal(activeActivityResponse.status, 200)
    assert.equal(activeActivityBody.ok, true)
    assert.deepEqual(
      activeActivityBody.data.threads.map((thread: { id: string }) => thread.id),
      [bootstrap.data.threadId],
    )
    assert.equal(activeActivityBody.data.threads[0]?.activity.state, 'pending')

    const secondCompletedAt = minutesAgo(runtime.services.clock.nowIso(), 1)

    updateRootThreadActivity(runtime, {
      jobPatch: {
        completedAt: secondCompletedAt,
        status: 'completed',
        updatedAt: secondCompletedAt,
      },
      runPatch: {
        completedAt: secondCompletedAt,
        lastProgressAt: secondCompletedAt,
        status: 'completed',
        updatedAt: secondCompletedAt,
      },
      threadId: bootstrap.data.threadId,
    })

    const completedAgainResponse = await app.request('http://local/v1/threads/activity', {
      headers,
    })
    const completedAgainBody = await completedAgainResponse.json()

    assert.equal(completedAgainResponse.status, 200)
    assert.equal(completedAgainBody.ok, true)
    assert.deepEqual(
      completedAgainBody.data.threads.map((thread: { id: string }) => thread.id),
      [bootstrap.data.threadId],
    )
    assert.deepEqual(completedAgainBody.data.threads[0]?.activity, {
      completedAt: secondCompletedAt,
      label: 'Done',
      state: 'completed',
      updatedAt: secondCompletedAt,
    })

    const seenRow = runtime.db
      .select()
      .from(accountThreadActivitySeen)
      .where(eq(accountThreadActivitySeen.threadId, bootstrap.data.threadId))
      .get()

    assert.equal(seenRow?.seenCompletedRunId, bootstrap.data.runId)
  }

  {
    const { app, runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { headers } = seedApiKeyAuth(runtime)
    const bootstrap = await bootstrapThread(app, headers)
    const firstFailedAt = minutesAgo(runtime.services.clock.nowIso(), 10)

    updateRootThreadActivity(runtime, {
      jobPatch: {
        status: 'blocked',
        updatedAt: firstFailedAt,
      },
      runPatch: {
        completedAt: firstFailedAt,
        lastProgressAt: firstFailedAt,
        status: 'failed',
        updatedAt: firstFailedAt,
      },
      threadId: bootstrap.data.threadId,
    })

    const seenResponse = await app.request(
      `http://local/v1/threads/${bootstrap.data.threadId}/activity/seen`,
      {
        headers,
        method: 'POST',
      },
    )

    assert.equal(seenResponse.status, 204)

    const hiddenActivityResponse = await app.request('http://local/v1/threads/activity', {
      headers,
    })
    const hiddenActivityBody = await hiddenActivityResponse.json()

    assert.equal(hiddenActivityResponse.status, 200)
    assert.equal(hiddenActivityBody.ok, true)
    assert.deepEqual(hiddenActivityBody.data.threads, [])

    const secondInteractionResponse = await app.request(
      `http://local/v1/threads/${bootstrap.data.threadId}/interactions`,
      {
        body: JSON.stringify({
          text: 'Retry the failed image request with a corrected schema.',
        }),
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )
    const secondInteractionBody = await secondInteractionResponse.json()

    assert.equal(secondInteractionResponse.status, 202)
    assert.notEqual(secondInteractionBody.data.runId, bootstrap.data.runId)

    const secondFailedAt = minutesAgo(runtime.services.clock.nowIso(), 1)

    updateRootThreadActivity(runtime, {
      jobPatch: {
        status: 'blocked',
        updatedAt: secondFailedAt,
      },
      runPatch: {
        completedAt: secondFailedAt,
        lastProgressAt: secondFailedAt,
        status: 'failed',
        updatedAt: secondFailedAt,
      },
      threadId: bootstrap.data.threadId,
    })

    const failedAgainResponse = await app.request('http://local/v1/threads/activity', {
      headers,
    })
    const failedAgainBody = await failedAgainResponse.json()

    assert.equal(failedAgainResponse.status, 200)
    assert.equal(failedAgainBody.ok, true)
    assert.deepEqual(
      failedAgainBody.data.threads.map((thread: { id: string }) => thread.id),
      [bootstrap.data.threadId],
    )
    assert.deepEqual(failedAgainBody.data.threads[0]?.activity, {
      completedAt: null,
      label: 'Failed',
      state: 'failed',
      updatedAt: secondFailedAt,
    })

    const seenRow = runtime.db
      .select()
      .from(accountThreadActivitySeen)
      .where(eq(accountThreadActivitySeen.threadId, bootstrap.data.threadId))
      .get()

    assert.equal(seenRow?.seenCompletedRunId, bootstrap.data.runId)
  }
})
test('posting new information reopens and then reuses the latest root work item', async () => {
  {
    const { app, runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { headers } = seedApiKeyAuth(runtime)
    const bootstrap = await bootstrapThread(app, headers)

    runtime.services.ai.interactions.generate = async () =>
      ok({
        messages: [
          {
            content: [
              { text: 'Bootstrap run completed before the follow-up message.', type: 'text' },
            ],
            role: 'assistant',
          },
        ],
        model: 'gpt-5.4',
        output: [
          {
            content: [
              { text: 'Bootstrap run completed before the follow-up message.', type: 'text' },
            ],
            role: 'assistant',
            providerMessageId: 'msg_bootstrap_completed',
            type: 'message',
          },
        ],
        outputText: 'Bootstrap run completed before the follow-up message.',
        provider: 'openai',
        providerRequestId: 'req_bootstrap_completed',
        raw: { stub: true },
        responseId: 'resp_bootstrap_completed',
        status: 'completed',
        toolCalls: [],
        usage: {
          cachedTokens: 0,
          inputTokens: 64,
          outputTokens: 14,
          reasoningTokens: 0,
          totalTokens: 78,
        },
      })

    const executeResponse = await app.request(
      `http://local/v1/runs/${bootstrap.data.runId}/execute`,
      {
        body: JSON.stringify({}),
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    assert.equal(executeResponse.status, 200)

    const firstMessageResponse = await app.request(
      `http://local/v1/threads/${bootstrap.data.threadId}/messages`,
      {
        body: JSON.stringify({
          text: 'Use that completed result, but continue with a narrower delivery plan.',
        }),
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )
    const firstMessageBody = await firstMessageResponse.json()

    assert.equal(firstMessageResponse.status, 201)

    const secondMessageResponse = await app.request(
      `http://local/v1/threads/${bootstrap.data.threadId}/messages`,
      {
        body: JSON.stringify({
          text: 'Do not reopen the same work item twice while it is already ready.',
        }),
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    assert.equal(secondMessageResponse.status, 201)

    const rootJob = runtime.db
      .select()
      .from(jobs)
      .all()
      .find(
        (workItem) =>
          workItem.threadId === bootstrap.data.threadId && workItem.parentJobId === null,
      )
    const reopenedEvents = runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.type === 'job.requeued')

    assert.equal(rootJob?.status, 'queued')
    assert.equal(rootJob?.completedAt, null)
    assert.equal(
      (rootJob?.statusReasonJson as { reason?: string } | null)?.reason,
      'new_user_message',
    )
    assert.equal(
      (rootJob?.statusReasonJson as { messageId?: string } | null)?.messageId,
      firstMessageBody.data.messageId,
    )
    assert.equal(reopenedEvents.length, 1)
    assert.equal(
      (reopenedEvents[0]?.payload as { messageId?: string } | null)?.messageId,
      firstMessageBody.data.messageId,
    )
  }

  {
    const { app, runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { headers } = seedApiKeyAuth(runtime)
    const bootstrap = await bootstrapThread(app, headers)

    runtime.services.ai.interactions.generate = async () =>
      ok({
        messages: [
          {
            content: [
              { text: 'Bootstrap run completed before reusing the graph root.', type: 'text' },
            ],
            role: 'assistant',
          },
        ],
        model: 'gpt-5.4',
        output: [
          {
            content: [
              { text: 'Bootstrap run completed before reusing the graph root.', type: 'text' },
            ],
            role: 'assistant',
            providerMessageId: 'msg_graph_root_bootstrap',
            type: 'message',
          },
        ],
        outputText: 'Bootstrap run completed before reusing the graph root.',
        provider: 'openai',
        providerRequestId: 'req_graph_root_bootstrap',
        raw: { stub: true },
        responseId: 'resp_graph_root_bootstrap',
        status: 'completed',
        toolCalls: [],
        usage: {
          cachedTokens: 0,
          inputTokens: 64,
          outputTokens: 14,
          reasoningTokens: 0,
          totalTokens: 78,
        },
      })

    const bootstrapExecute = await app.request(
      `http://local/v1/runs/${bootstrap.data.runId}/execute`,
      {
        body: JSON.stringify({}),
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    assert.equal(bootstrapExecute.status, 200)

    const messageResponse = await app.request(
      `http://local/v1/threads/${bootstrap.data.threadId}/messages`,
      {
        body: JSON.stringify({
          text: 'Use the reopened root instead of creating a new one.',
        }),
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )
    const messageBody = await messageResponse.json()

    assert.equal(messageResponse.status, 201)

    runtime.services.ai.interactions.generate = async (request) => {
      assert.equal(request.messages.at(-1)?.role, 'user')
      assert.deepEqual(request.messages.at(-1)?.content, [
        { text: 'Use the reopened root instead of creating a new one.', type: 'text' },
      ])

      return ok({
        messages: [
          {
            content: [{ text: 'The interaction reused the reopened work item.', type: 'text' }],
            role: 'assistant',
          },
        ],
        model: 'gpt-5.4',
        output: [
          {
            content: [{ text: 'The interaction reused the reopened work item.', type: 'text' }],
            role: 'assistant',
            providerMessageId: 'msg_graph_root_reuse',
            type: 'message',
          },
        ],
        outputText: 'The interaction reused the reopened work item.',
        provider: 'openai',
        providerRequestId: 'req_graph_root_reuse',
        raw: { stub: true },
        responseId: 'resp_graph_root_reuse',
        status: 'completed',
        toolCalls: [],
        usage: {
          cachedTokens: 0,
          inputTokens: 66,
          outputTokens: 16,
          reasoningTokens: 0,
          totalTokens: 82,
        },
      })
    }

    const interactionResponse = await app.request(
      `http://local/v1/threads/${bootstrap.data.threadId}/interactions`,
      {
        body: JSON.stringify({
          messageId: messageBody.data.messageId,
        }),
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )
    const interactionBody = await interactionResponse.json()

    assert.equal(interactionResponse.status, 202)

    const interactionExecute = await app.request(
      `http://local/v1/runs/${interactionBody.data.runId}/execute`,
      {
        body: JSON.stringify({}),
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    assert.equal(interactionExecute.status, 200)

    const workItemRows = runtime.db
      .select()
      .from(jobs)
      .all()
      .filter(
        (workItem) =>
          workItem.threadId === bootstrap.data.threadId && workItem.parentJobId === null,
      )
    const rootJob = workItemRows[0]
    const createdEvents = runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.type === 'job.created')
    const reopenedEvents = runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.type === 'job.requeued')
    const runRows = runtime.db.select().from(runs).all()
    const bootstrapRun = runRows.find((run) => run.id === bootstrap.data.runId)
    const interactionRun = runRows.find((run) => run.id === interactionBody.data.runId)

    assert.equal(workItemRows.length, 1)
    assert.equal(rootJob?.id, bootstrapRun?.jobId)
    assert.equal(rootJob?.id, interactionRun?.jobId)
    assert.equal(rootJob?.currentRunId, interactionBody.data.runId)
    assert.equal(rootJob?.status, 'completed')
    assert.equal(createdEvents.length, 1)
    assert.equal(reopenedEvents.length, 1)
    assert.equal(
      (reopenedEvents[0]?.payload as { messageId?: string } | null)?.messageId,
      messageBody.data.messageId,
    )
  }
})
test('patch thread message edits in place, replaces attachments, prunes later history, and reruns from the preserved root work item', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapThread(app, headers)

  runtime.services.ai.interactions.generate = async () =>
    ok({
      messages: [
        {
          content: [{ text: 'Initial answer before the edit.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Initial answer before the edit.', type: 'text' }],
          role: 'assistant',
          providerMessageId: 'msg_initial_answer',
          type: 'message',
        },
      ],
      outputText: 'Initial answer before the edit.',
      provider: 'openai',
      providerRequestId: 'req_initial_answer',
      raw: { stub: true },
      responseId: 'resp_initial_answer',
      status: 'completed',
      toolCalls: [],
      usage: {
        cachedTokens: 0,
        inputTokens: 48,
        outputTokens: 12,
        reasoningTokens: 0,
        totalTokens: 60,
      },
    })

  const bootstrapExecute = await app.request(
    `http://local/v1/runs/${bootstrap.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(bootstrapExecute.status, 200)

  const oldFileId = 'fil_edit_old'
  const oldUploadId = 'upl_edit_old'
  const oldBlobStorageKey = 'files/thread-edit/old-file.txt'
  const libraryFileId = 'fil_edit_library'
  const oldBlobPath = writeTestBlob(runtime, oldBlobStorageKey, 'old edit attachment')

  runtime.db
    .insert(uploads)
    .values({
      accessScope: 'session_local',
      accountId: 'acc_test',
      completedAt: '2026-03-30T13:00:00.000Z',
      createdAt: '2026-03-30T13:00:00.000Z',
      declaredMimeType: 'text/plain',
      detectedMimeType: 'text/plain',
      fileId: oldFileId,
      id: oldUploadId,
      originalFilename: 'old-file.txt',
      sessionId: bootstrap.data.sessionId,
      sizeBytes: 20,
      stagedStorageKey: oldBlobStorageKey,
      status: 'completed',
      tenantId,
      updatedAt: '2026-03-30T13:00:00.000Z',
    })
    .run()

  runtime.db
    .insert(files)
    .values([
      {
        accessScope: 'session_local',
        createdAt: '2026-03-30T13:00:00.000Z',
        createdByAccountId: 'acc_test',
        createdByRunId: null,
        id: oldFileId,
        mimeType: 'text/plain',
        originUploadId: oldUploadId,
        originalFilename: 'old-file.txt',
        sizeBytes: 20,
        sourceKind: 'upload',
        status: 'ready',
        storageKey: oldBlobStorageKey,
        tenantId,
        title: 'Old edit file',
        updatedAt: '2026-03-30T13:00:00.000Z',
      },
      {
        accessScope: 'account_library',
        createdAt: '2026-03-30T13:01:00.000Z',
        createdByAccountId: 'acc_test',
        id: libraryFileId,
        mimeType: 'text/plain',
        originalFilename: 'library-file.txt',
        sizeBytes: 18,
        sourceKind: 'upload',
        status: 'ready',
        storageKey: 'files/thread-edit/library-file.txt',
        tenantId,
        title: 'Library edit file',
        updatedAt: '2026-03-30T13:01:00.000Z',
      },
    ])
    .run()

  runtime.db
    .insert(fileLinks)
    .values([
      {
        createdAt: '2026-03-30T13:00:00.000Z',
        fileId: oldFileId,
        id: 'flk_edit_old_session',
        linkType: 'session',
        targetId: bootstrap.data.sessionId,
        tenantId,
      },
      {
        createdAt: '2026-03-30T13:00:00.000Z',
        fileId: oldFileId,
        id: 'flk_edit_old_message',
        linkType: 'message',
        targetId: bootstrap.data.messageId,
        tenantId,
      },
    ])
    .run()

  const followUpMessageResponse = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/messages`,
    {
      body: JSON.stringify({
        text: 'Old follow-up that should disappear after the edit.',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const followUpMessageBody = await followUpMessageResponse.json()

  assert.equal(followUpMessageResponse.status, 201)

  runtime.services.ai.interactions.generate = async () =>
    ok({
      messages: [
        {
          content: [{ text: 'Follow-up answer before the edit.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Follow-up answer before the edit.', type: 'text' }],
          role: 'assistant',
          providerMessageId: 'msg_follow_up_answer',
          type: 'message',
        },
      ],
      outputText: 'Follow-up answer before the edit.',
      provider: 'openai',
      providerRequestId: 'req_follow_up_answer',
      raw: { stub: true },
      responseId: 'resp_follow_up_answer',
      status: 'completed',
      toolCalls: [],
      usage: {
        cachedTokens: 0,
        inputTokens: 52,
        outputTokens: 14,
        reasoningTokens: 0,
        totalTokens: 66,
      },
    })

  const followUpInteractionResponse = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/interactions`,
    {
      body: JSON.stringify({
        messageId: followUpMessageBody.data.messageId,
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const followUpInteractionBody = await followUpInteractionResponse.json()

  assert.equal(followUpInteractionResponse.status, 202)

  const followUpInteractionExecute = await app.request(
    `http://local/v1/runs/${followUpInteractionBody.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(followUpInteractionExecute.status, 200)

  const rootJobBeforeEdit = runtime.db
    .select()
    .from(jobs)
    .all()
    .find(
      (workItem) => workItem.threadId === bootstrap.data.threadId && workItem.parentJobId === null,
    )

  assert.notEqual(rootJobBeforeEdit, undefined)

  const editResponse = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/messages/${bootstrap.data.messageId}`,
    {
      body: JSON.stringify({
        fileIds: [libraryFileId],
        text: 'Edited opening brief',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'PATCH',
    },
  )
  const editBody = await editResponse.json()

  assert.equal(editResponse.status, 200)
  assert.equal(editBody.ok, true)
  assert.equal(editBody.data.messageId, bootstrap.data.messageId)
  assert.deepEqual(editBody.data.attachedFileIds, [libraryFileId])

  const remainingMessageRows = runtime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.threadId, bootstrap.data.threadId))
    .all()

  assert.equal(remainingMessageRows.length, 1)
  assert.equal(remainingMessageRows[0]?.id, bootstrap.data.messageId)
  assert.equal(remainingMessageRows[0]?.runId, null)
  assert.deepEqual(remainingMessageRows[0]?.content, [
    { text: 'Edited opening brief', type: 'text' },
  ])

  assert.equal(
    runtime.db.select().from(runs).where(eq(runs.sessionId, bootstrap.data.sessionId)).all().length,
    0,
  )
  assert.equal(
    runtime.db
      .select()
      .from(workSessions)
      .where(eq(workSessions.id, bootstrap.data.sessionId))
      .get()?.rootRunId,
    null,
  )

  const rootJobAfterEdit = runtime.db
    .select()
    .from(jobs)
    .where(eq(jobs.id, rootJobBeforeEdit!.id))
    .get()

  assert.notEqual(rootJobAfterEdit, undefined)
  assert.equal(rootJobAfterEdit?.status, 'queued')
  assert.equal(rootJobAfterEdit?.currentRunId, null)

  assert.equal(runtime.db.select().from(files).where(eq(files.id, oldFileId)).get(), undefined)
  assert.equal(
    runtime.db.select().from(uploads).where(eq(uploads.id, oldUploadId)).get(),
    undefined,
  )
  assert.equal(
    runtime.db.select().from(fileLinks).where(eq(fileLinks.id, 'flk_edit_old_message')).get(),
    undefined,
  )
  assert.equal(
    runtime.db.select().from(fileLinks).where(eq(fileLinks.id, 'flk_edit_old_session')).get(),
    undefined,
  )
  assert.equal(existsSync(oldBlobPath), false)

  assert.notEqual(
    runtime.db.select().from(files).where(eq(files.id, libraryFileId)).get(),
    undefined,
  )
  assert.notEqual(
    runtime.db
      .select()
      .from(fileLinks)
      .where(and(eq(fileLinks.fileId, libraryFileId), eq(fileLinks.linkType, 'session')))
      .get(),
    undefined,
  )
  assert.notEqual(
    runtime.db
      .select()
      .from(fileLinks)
      .where(and(eq(fileLinks.fileId, libraryFileId), eq(fileLinks.linkType, 'message')))
      .get(),
    undefined,
  )

  runtime.services.ai.interactions.generate = async () =>
    ok({
      messages: [
        {
          content: [{ text: 'Answer after editing the first turn.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Answer after editing the first turn.', type: 'text' }],
          role: 'assistant',
          providerMessageId: 'msg_after_edit_answer',
          type: 'message',
        },
      ],
      outputText: 'Answer after editing the first turn.',
      provider: 'openai',
      providerRequestId: 'req_after_edit_answer',
      raw: { stub: true },
      responseId: 'resp_after_edit_answer',
      status: 'completed',
      toolCalls: [],
      usage: {
        cachedTokens: 0,
        inputTokens: 50,
        outputTokens: 13,
        reasoningTokens: 0,
        totalTokens: 63,
      },
    })

  const rerunResponse = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/interactions`,
    {
      body: JSON.stringify({
        messageId: bootstrap.data.messageId,
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const rerunBody = await rerunResponse.json()

  assert.equal(rerunResponse.status, 202)

  const rerunExecute = await app.request(`http://local/v1/runs/${rerunBody.data.runId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(rerunExecute.status, 200)

  const rerunRow = runtime.db.select().from(runs).where(eq(runs.id, rerunBody.data.runId)).get()

  assert.equal(rerunRow?.jobId, rootJobBeforeEdit?.id)
})

test('thread listing orders recent account threads and searches titles and messages', async () => {
  {
    const { app, runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { headers, tenantId } = seedApiKeyAuth(runtime)

    runtime.db
      .insert(tenants)
      .values({
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'ten_other',
        name: 'Other Tenant',
        slug: 'other-tenant',
        status: 'active',
        updatedAt: '2026-03-29T00:00:00.000Z',
      })
      .run()

    runtime.db
      .insert(workSessions)
      .values([
        {
          createdAt: '2026-03-29T00:00:00.000Z',
          createdByAccountId: 'acc_test',
          id: 'ses_newer',
          status: 'active',
          tenantId,
          title: 'Newer session',
          updatedAt: '2026-03-30T10:00:00.000Z',
        },
        {
          createdAt: '2026-03-29T00:00:00.000Z',
          createdByAccountId: 'acc_test',
          id: 'ses_older',
          status: 'active',
          tenantId,
          title: 'Older session',
          updatedAt: '2026-03-29T10:00:00.000Z',
        },
        {
          createdAt: '2026-03-29T00:00:00.000Z',
          createdByAccountId: 'acc_test',
          id: 'ses_deleted',
          status: 'active',
          tenantId,
          title: 'Deleted session',
          updatedAt: '2026-03-30T11:00:00.000Z',
        },
        {
          createdAt: '2026-03-29T00:00:00.000Z',
          createdByAccountId: null,
          id: 'ses_other',
          status: 'active',
          tenantId: 'ten_other',
          title: 'Other tenant session',
          updatedAt: '2026-03-30T12:00:00.000Z',
        },
      ])
      .run()

    runtime.db
      .insert(sessionThreads)
      .values([
        {
          createdAt: '2026-03-29T00:00:00.000Z',
          createdByAccountId: 'acc_test',
          id: 'thr_newer',
          parentThreadId: null,
          sessionId: 'ses_newer',
          status: 'active',
          tenantId,
          title: 'Newest thread',
          updatedAt: '2026-03-30T12:00:00.000Z',
        },
        {
          createdAt: '2026-03-29T00:00:00.000Z',
          createdByAccountId: 'acc_test',
          id: 'thr_older',
          parentThreadId: null,
          sessionId: 'ses_older',
          status: 'active',
          tenantId,
          title: 'Older thread',
          updatedAt: '2026-03-29T12:00:00.000Z',
        },
        {
          createdAt: '2026-03-29T00:00:00.000Z',
          createdByAccountId: 'acc_test',
          id: 'thr_deleted',
          parentThreadId: null,
          sessionId: 'ses_deleted',
          status: 'deleted',
          tenantId,
          title: 'Deleted thread',
          updatedAt: '2026-03-30T13:00:00.000Z',
        },
        {
          createdAt: '2026-03-29T00:00:00.000Z',
          createdByAccountId: null,
          id: 'thr_other',
          parentThreadId: null,
          sessionId: 'ses_other',
          status: 'active',
          tenantId: 'ten_other',
          title: 'Other tenant thread',
          updatedAt: '2026-03-30T14:00:00.000Z',
        },
      ])
      .run()

    const response = await app.request('http://local/v1/threads?limit=2', {
      headers,
    })
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.deepEqual(
      body.data.threads.map((thread: { id: string }) => thread.id),
      ['thr_newer', 'thr_older'],
    )
  }

  {
    const { app, runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { headers } = seedApiKeyAuth(runtime)
    const bootstrap = await bootstrapThread(app, headers)

    const renameResponse = await app.request(`http://local/v1/threads/${bootstrap.data.threadId}`, {
      body: JSON.stringify({
        title: 'Release checklist',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'PATCH',
    })

    assert.equal(renameResponse.status, 200)

    const postResponse = await app.request(
      `http://local/v1/threads/${bootstrap.data.threadId}/messages`,
      {
        body: JSON.stringify({
          text: 'Remember the zebra migration before release.',
        }),
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    assert.equal(postResponse.status, 201)

    const titleSearchResponse = await app.request(
      'http://local/v1/threads?limit=5&query=checklist',
      {
        headers,
      },
    )
    const titleSearchBody = await titleSearchResponse.json()

    assert.equal(titleSearchResponse.status, 200)
    assert.equal(titleSearchBody.ok, true)
    assert.deepEqual(
      titleSearchBody.data.threads.map((thread: { id: string }) => thread.id),
      [bootstrap.data.threadId],
    )

    const messageSearchResponse = await app.request('http://local/v1/threads?limit=5&query=zebra', {
      headers,
    })
    const messageSearchBody = await messageSearchResponse.json()

    assert.equal(messageSearchResponse.status, 200)
    assert.equal(messageSearchBody.ok, true)
    assert.deepEqual(
      messageSearchBody.data.threads.map((thread: { id: string }) => thread.id),
      [bootstrap.data.threadId],
    )
  }
})
test('thread budget route returns the current thread estimate plus the latest provider usage', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapThread(app, headers)

  runtime.db
    .insert(usageLedger)
    .values({
      cachedTokens: 120,
      createdAt: '2026-03-30T15:00:00.000Z',
      estimatedInputTokens: 5_120,
      estimatedOutputTokens: 2_048,
      id: 'use_thread_budget_1',
      inputTokens: 4_900,
      model: 'gpt-5.4',
      operation: 'interaction',
      outputTokens: 620,
      provider: 'openai',
      runId: bootstrap.data.runId,
      sessionId: bootstrap.data.sessionId,
      stablePrefixTokens: 3_000,
      tenantId,
      threadId: bootstrap.data.threadId,
      toolExecutionId: null,
      turn: 2,
      volatileSuffixTokens: 2_120,
    })
    .run()

  const response = await app.request(`http://local/v1/threads/${bootstrap.data.threadId}/budget`, {
    headers,
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.data.budget.contextWindow, 1_047_576)
  assert.equal(body.data.budget.actualInputTokens, 4_900)
  assert.equal(body.data.budget.actualOutputTokens, 620)
  assert.equal(body.data.budget.actualTotalTokens, 5_520)
  assert.equal(body.data.budget.cachedInputTokens, 120)
  assert.equal(body.data.budget.estimatedInputTokens > 0, true)
  assert.notEqual(body.data.budget.estimatedInputTokens, 5_120)
  assert.equal(body.data.budget.measuredAt, '2026-03-30T15:00:00.000Z')
  assert.equal(body.data.budget.model, 'gpt-5.4')
  assert.equal(body.data.budget.provider, 'openai')
  assert.equal(body.data.budget.reasoningTokens, null)
  assert.equal(body.data.budget.turn, 1)
})

test('thread memory route allows inline observation and reflection edits', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapThread(app, headers)

  runtime.db
    .insert(memoryRecords)
    .values([
      {
        content: {
          observations: [{ text: 'Original observation' }],
          source: 'observer_v1',
        },
        createdAt: '2026-03-30T16:00:00.000Z',
        generation: 1,
        id: 'mrec_obs_inline',
        kind: 'observation',
        ownerRunId: bootstrap.data.runId,
        parentRecordId: null,
        rootRunId: bootstrap.data.runId,
        scopeKind: 'run_local',
        scopeRef: bootstrap.data.runId,
        sessionId: bootstrap.data.sessionId,
        status: 'active',
        tenantId,
        threadId: bootstrap.data.threadId,
        tokenCount: 10,
        visibility: 'private',
      },
      {
        content: {
          reflection: 'Original reflection',
          source: 'reflector_v1',
        },
        createdAt: '2026-03-30T16:05:00.000Z',
        generation: 2,
        id: 'mrec_ref_inline',
        kind: 'reflection',
        ownerRunId: bootstrap.data.runId,
        parentRecordId: null,
        rootRunId: bootstrap.data.runId,
        scopeKind: 'run_local',
        scopeRef: bootstrap.data.runId,
        sessionId: bootstrap.data.sessionId,
        status: 'active',
        tenantId,
        threadId: bootstrap.data.threadId,
        tokenCount: 12,
        visibility: 'private',
      },
    ])
    .run()

  const updateObservationResponse = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/memory/mrec_obs_inline`,
    {
      body: JSON.stringify({
        kind: 'observation',
        observations: [{ text: '**Edited** observation' }],
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'PATCH',
    },
  )
  const updateObservationBody = await updateObservationResponse.json()

  assert.equal(updateObservationResponse.status, 200)
  assert.equal(updateObservationBody.ok, true)
  assert.equal(updateObservationBody.data.record.kind, 'observation')
  assert.equal(
    updateObservationBody.data.record.content.observations[0]?.text,
    '**Edited** observation',
  )

  const updateReflectionResponse = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/memory/mrec_ref_inline`,
    {
      body: JSON.stringify({
        kind: 'reflection',
        reflection: '## Edited reflection',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'PATCH',
    },
  )
  const updateReflectionBody = await updateReflectionResponse.json()

  assert.equal(updateReflectionResponse.status, 200)
  assert.equal(updateReflectionBody.ok, true)
  assert.equal(updateReflectionBody.data.record.kind, 'reflection')
  assert.equal(updateReflectionBody.data.record.content.reflection, '## Edited reflection')

  const memoryResponse = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/memory`,
    {
      headers,
    },
  )
  const memoryBody = await memoryResponse.json()

  assert.equal(memoryResponse.status, 200)
  assert.equal(memoryBody.ok, true)
  assert.equal(memoryBody.data.observations[0]?.kind, 'observation')
  assert.equal(
    memoryBody.data.observations[0]?.content.observations[0]?.text,
    '**Edited** observation',
  )
  assert.equal(memoryBody.data.reflection?.kind, 'reflection')
  assert.equal(memoryBody.data.reflection?.content.reflection, '## Edited reflection')
})

test('regenerate thread title queues a background naming request for the latest root run', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapThread(app, headers)

  const response = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/title/regenerate`,
    {
      headers,
      method: 'POST',
    },
  )
  const body = await response.json()

  assert.equal(response.status, 202)
  assert.equal(body.ok, true)
  assert.equal(body.data.accepted, true)
  assert.equal(body.data.threadId, bootstrap.data.threadId)

  const requestEvent = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .findLast((event) => event.type === 'thread.naming.requested')
  const requestOutboxTopics = runtime.db
    .select()
    .from(eventOutbox)
    .all()
    .filter((row) => row.eventId === requestEvent?.id)
    .map((row) => row.topic)
    .sort()

  assert.deepEqual(requestEvent?.payload, {
    requestId: requestEvent?.payload.requestId,
    requestedAt: requestEvent?.payload.requestedAt,
    sessionId: bootstrap.data.sessionId,
    sourceRunId: bootstrap.data.runId,
    threadId: bootstrap.data.threadId,
    trigger: 'manual_regenerate',
  })
  assert.deepEqual(requestOutboxTopics, ['background', 'realtime'])
})

test('delete thread permanently removes descendant rows, owned blobs, and thread-scoped events', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapThread(app, headers)
  const siblingThreadId = 'thr_sibling'
  const childThreadId = 'thr_child'
  const childMessageId = 'msg_child'
  const siblingMessageId = 'msg_sibling'
  const childRunId = 'run_child_worker'
  const branchRunId = 'run_branch_root'
  const siblingRunId = 'run_sibling_root'
  const toolExecutionId = 'call_child_worker'
  const waitId = 'wait_child_worker'
  const summaryId = 'sum_child_worker'
  const memoryRecordId = 'mem_child_worker'
  const uploadId = 'upl_thread_file'
  const fileId = 'fil_thread_file'
  const libraryFileId = 'fil_library_file'
  const blobStorageKey = 'files/thread-delete/thread-file.txt'

  runtime.db
    .insert(sessionThreads)
    .values([
      {
        branchFromMessageId: null,
        branchFromSequence: null,
        createdAt: '2026-03-30T12:05:00.000Z',
        createdByAccountId: 'acc_test',
        id: childThreadId,
        parentThreadId: bootstrap.data.threadId,
        sessionId: bootstrap.data.sessionId,
        status: 'active',
        tenantId,
        title: 'Child thread',
        titleSource: null,
        updatedAt: '2026-03-30T12:05:00.000Z',
      },
      {
        branchFromMessageId: null,
        branchFromSequence: null,
        createdAt: '2026-03-30T12:10:00.000Z',
        createdByAccountId: 'acc_test',
        id: siblingThreadId,
        parentThreadId: null,
        sessionId: bootstrap.data.sessionId,
        status: 'active',
        tenantId,
        title: 'Sibling thread',
        titleSource: null,
        updatedAt: '2026-03-30T12:10:00.000Z',
      },
    ])
    .run()

  runtime.db
    .insert(sessionMessages)
    .values([
      {
        authorAccountId: 'acc_test',
        authorKind: 'user',
        content: [{ text: 'Child thread message', type: 'text' }],
        createdAt: '2026-03-30T12:06:00.000Z',
        id: childMessageId,
        runId: null,
        sequence: 1,
        sessionId: bootstrap.data.sessionId,
        tenantId,
        threadId: childThreadId,
      },
      {
        authorAccountId: 'acc_test',
        authorKind: 'user',
        content: [{ text: 'Sibling thread message', type: 'text' }],
        createdAt: '2026-03-30T12:11:00.000Z',
        id: siblingMessageId,
        runId: null,
        sequence: 1,
        sessionId: bootstrap.data.sessionId,
        tenantId,
        threadId: siblingThreadId,
      },
    ])
    .run()

  runtime.db
    .insert(runs)
    .values([
      {
        completedAt: '2026-03-30T12:30:00.000Z',
        configSnapshot: { model: 'gpt-5.4', provider: 'openai', version: 'test' },
        createdAt: '2026-03-30T12:12:00.000Z',
        id: childRunId,
        lastProgressAt: '2026-03-30T12:30:00.000Z',
        parentRunId: bootstrap.data.runId,
        resultJson: { status: 'ok' },
        rootRunId: bootstrap.data.runId,
        sessionId: bootstrap.data.sessionId,
        startedAt: '2026-03-30T12:12:00.000Z',
        status: 'completed',
        task: 'Child worker run',
        tenantId,
        targetKind: 'assistant',
        threadId: null,
        toolProfileId: null,
        updatedAt: '2026-03-30T12:30:00.000Z',
        workspaceRef: '/tmp/workspaces/run_child_worker',
      },
      {
        completedAt: '2026-03-30T12:40:00.000Z',
        configSnapshot: { model: 'gpt-5.4', provider: 'openai', version: 'test' },
        createdAt: '2026-03-30T12:13:00.000Z',
        id: branchRunId,
        lastProgressAt: '2026-03-30T12:40:00.000Z',
        resultJson: { status: 'ok' },
        rootRunId: branchRunId,
        sessionId: bootstrap.data.sessionId,
        startedAt: '2026-03-30T12:13:00.000Z',
        status: 'completed',
        task: 'Branch run',
        tenantId,
        targetKind: 'assistant',
        threadId: childThreadId,
        toolProfileId: null,
        updatedAt: '2026-03-30T12:40:00.000Z',
        workspaceRef: '/tmp/workspaces/run_branch_root',
      },
      {
        completedAt: '2026-03-30T12:50:00.000Z',
        configSnapshot: { model: 'gpt-5.4', provider: 'openai', version: 'test' },
        createdAt: '2026-03-30T12:14:00.000Z',
        id: siblingRunId,
        lastProgressAt: '2026-03-30T12:50:00.000Z',
        resultJson: { status: 'ok' },
        rootRunId: siblingRunId,
        sessionId: bootstrap.data.sessionId,
        startedAt: '2026-03-30T12:14:00.000Z',
        status: 'completed',
        task: 'Sibling run',
        tenantId,
        targetKind: 'assistant',
        threadId: siblingThreadId,
        toolProfileId: null,
        updatedAt: '2026-03-30T12:50:00.000Z',
        workspaceRef: '/tmp/workspaces/run_sibling_root',
      },
    ])
    .run()

  runtime.db
    .insert(toolExecutions)
    .values({
      createdAt: '2026-03-30T12:20:00.000Z',
      domain: 'native',
      id: toolExecutionId,
      runId: childRunId,
      startedAt: '2026-03-30T12:20:00.000Z',
      tenantId,
      tool: 'shell.exec',
    })
    .run()

  runtime.db
    .insert(runDependencies)
    .values({
      callId: toolExecutionId,
      createdAt: '2026-03-30T12:21:00.000Z',
      id: waitId,
      runId: childRunId,
      status: 'resolved',
      targetKind: 'external',
      tenantId,
      type: 'tool',
    })
    .run()

  runtime.db
    .insert(items)
    .values({
      content: [{ text: 'Child run output', type: 'text' }],
      createdAt: '2026-03-30T12:22:00.000Z',
      id: 'itm_child_worker',
      role: 'assistant',
      runId: childRunId,
      sequence: 1,
      tenantId,
      type: 'message',
    })
    .run()

  runtime.db
    .insert(contextSummaries)
    .values({
      content: 'Child summary',
      createdAt: '2026-03-30T12:23:00.000Z',
      fromSequence: 1,
      id: summaryId,
      modelKey: 'openai:gpt-5.4',
      runId: childRunId,
      tenantId,
      throughSequence: 1,
    })
    .run()

  runtime.db
    .insert(memoryRecords)
    .values({
      content: { text: 'Remember this thread detail' },
      createdAt: '2026-03-30T12:24:00.000Z',
      id: memoryRecordId,
      kind: 'observation',
      ownerRunId: childRunId,
      rootRunId: bootstrap.data.runId,
      scopeKind: 'thread_shared',
      scopeRef: bootstrap.data.threadId,
      sessionId: bootstrap.data.sessionId,
      status: 'active',
      tenantId,
      threadId: bootstrap.data.threadId,
      visibility: 'promoted',
    })
    .run()

  runtime.db
    .insert(memoryRecordSources)
    .values({
      createdAt: '2026-03-30T12:25:00.000Z',
      fromSequence: 1,
      id: 'mrs_child_worker',
      recordId: memoryRecordId,
      sourceRunId: childRunId,
      sourceSummaryId: summaryId,
      tenantId,
      throughSequence: 1,
    })
    .run()

  runtime.db
    .insert(usageLedger)
    .values({
      createdAt: '2026-03-30T12:26:00.000Z',
      id: 'use_child_worker',
      model: 'gpt-5.4',
      operation: 'interaction',
      provider: 'openai',
      runId: childRunId,
      sessionId: bootstrap.data.sessionId,
      summaryId,
      tenantId,
      threadId: bootstrap.data.threadId,
      toolExecutionId,
    })
    .run()

  runtime.db
    .insert(uploads)
    .values({
      accessScope: 'session_local',
      accountId: 'acc_test',
      completedAt: '2026-03-30T12:27:00.000Z',
      createdAt: '2026-03-30T12:27:00.000Z',
      declaredMimeType: 'text/plain',
      detectedMimeType: 'text/plain',
      fileId,
      id: uploadId,
      originalFilename: 'thread-file.txt',
      sessionId: bootstrap.data.sessionId,
      sizeBytes: 24,
      stagedStorageKey: blobStorageKey,
      status: 'completed',
      tenantId,
      updatedAt: '2026-03-30T12:27:00.000Z',
    })
    .run()

  runtime.db
    .insert(files)
    .values([
      {
        accessScope: 'session_local',
        createdAt: '2026-03-30T12:27:00.000Z',
        createdByAccountId: 'acc_test',
        createdByRunId: childRunId,
        id: fileId,
        mimeType: 'text/plain',
        originUploadId: uploadId,
        originalFilename: 'thread-file.txt',
        sizeBytes: 24,
        sourceKind: 'upload',
        status: 'ready',
        storageKey: blobStorageKey,
        tenantId,
        title: 'Thread file',
        updatedAt: '2026-03-30T12:27:00.000Z',
      },
      {
        accessScope: 'account_library',
        createdAt: '2026-03-30T12:28:00.000Z',
        createdByAccountId: 'acc_test',
        id: libraryFileId,
        mimeType: 'text/plain',
        originalFilename: 'library-file.txt',
        sizeBytes: 18,
        sourceKind: 'upload',
        status: 'ready',
        storageKey: 'files/thread-delete/library-file.txt',
        tenantId,
        title: 'Library file',
        updatedAt: '2026-03-30T12:28:00.000Z',
      },
    ])
    .run()

  runtime.db
    .insert(fileLinks)
    .values([
      {
        createdAt: '2026-03-30T12:27:00.000Z',
        fileId,
        id: 'flk_thread_session',
        linkType: 'session',
        targetId: bootstrap.data.sessionId,
        tenantId,
      },
      {
        createdAt: '2026-03-30T12:27:00.000Z',
        fileId,
        id: 'flk_thread_message',
        linkType: 'message',
        targetId: childMessageId,
        tenantId,
      },
      {
        createdAt: '2026-03-30T12:27:00.000Z',
        fileId,
        id: 'flk_thread_run',
        linkType: 'run',
        targetId: childRunId,
        tenantId,
      },
      {
        createdAt: '2026-03-30T12:27:00.000Z',
        fileId,
        id: 'flk_thread_tool',
        linkType: 'tool_execution',
        targetId: toolExecutionId,
        tenantId,
      },
      {
        createdAt: '2026-03-30T12:28:00.000Z',
        fileId: libraryFileId,
        id: 'flk_library_message',
        linkType: 'message',
        targetId: childMessageId,
        tenantId,
      },
    ])
    .run()

  const blobPath = writeTestBlob(runtime, blobStorageKey, 'thread attachment contents')

  appendTestEvent(runtime, {
    aggregateId: fileId,
    aggregateType: 'file',
    id: 'evt_thread_file_uploaded',
    payload: {
      fileId,
      sessionId: bootstrap.data.sessionId,
      uploadId,
    },
    tenantId,
    type: 'file.uploaded',
  })
  appendTestEvent(runtime, {
    aggregateId: fileId,
    aggregateType: 'file',
    id: 'evt_thread_file_linked',
    payload: {
      fileId,
      messageId: childMessageId,
      sessionId: bootstrap.data.sessionId,
      targetId: childMessageId,
    },
    tenantId,
    type: 'file.linked',
  })
  appendTestEvent(runtime, {
    aggregateId: uploadId,
    aggregateType: 'upload',
    id: 'evt_thread_upload_completed',
    payload: {
      uploadId,
    },
    tenantId,
    type: 'upload.completed',
  })
  appendTestEvent(runtime, {
    aggregateId: toolExecutionId,
    aggregateType: 'tool_execution',
    id: 'evt_thread_tool_called',
    payload: {
      callId: toolExecutionId,
      runId: childRunId,
      sessionId: bootstrap.data.sessionId,
      tool: 'shell.exec',
    },
    tenantId,
    type: 'tool.called',
  })
  appendTestEvent(runtime, {
    aggregateId: waitId,
    aggregateType: 'wait_entry',
    id: 'evt_thread_wait_resolved',
    payload: {
      callId: toolExecutionId,
      runId: childRunId,
      waitId,
    },
    tenantId,
    type: 'wait.resolved',
  })
  appendTestEvent(runtime, {
    aggregateId: libraryFileId,
    aggregateType: 'file',
    id: 'evt_library_file_linked',
    payload: {
      fileId: libraryFileId,
      messageId: childMessageId,
      sessionId: bootstrap.data.sessionId,
      targetId: childMessageId,
    },
    tenantId,
    type: 'file.linked',
  })

  const deletedReferenceIds = new Set<string>([
    bootstrap.data.threadId,
    childThreadId,
    bootstrap.data.messageId,
    childMessageId,
    bootstrap.data.runId,
    childRunId,
    branchRunId,
    toolExecutionId,
    waitId,
    summaryId,
    fileId,
    uploadId,
  ])
  const deletedEventIds = new Set(
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((row) => {
        if (deletedReferenceIds.has(row.aggregateId)) {
          return true
        }

        if (!row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) {
          return false
        }

        const payload = row.payload as Record<string, unknown>

        return [
          'callId',
          'childRunId',
          'fileId',
          'messageId',
          'parentRunId',
          'rootRunId',
          'runId',
          'summaryId',
          'threadId',
          'uploadId',
          'waitId',
          'waitTargetRunId',
        ].some((key) => {
          const candidate = payload[key]
          return typeof candidate === 'string' && deletedReferenceIds.has(candidate)
        })
      })
      .map((row) => row.id),
  )

  const deleteResponse = await app.request(`http://local/v1/threads/${bootstrap.data.threadId}`, {
    headers,
    method: 'DELETE',
  })
  const deleteBody = await deleteResponse.json()

  assert.equal(deleteResponse.status, 200)
  assert.equal(deleteBody.ok, true)
  assert.equal(deleteBody.data.threadId, bootstrap.data.threadId)
  assert.equal(deleteBody.data.deleted, true)

  assert.equal(
    runtime.db
      .select()
      .from(sessionThreads)
      .where(eq(sessionThreads.id, bootstrap.data.threadId))
      .get(),
    undefined,
  )
  assert.equal(
    runtime.db.select().from(sessionThreads).where(eq(sessionThreads.id, childThreadId)).get(),
    undefined,
  )
  assert.notEqual(
    runtime.db.select().from(sessionThreads).where(eq(sessionThreads.id, siblingThreadId)).get(),
    undefined,
  )

  assert.equal(
    runtime.db
      .select()
      .from(sessionMessages)
      .where(eq(sessionMessages.id, bootstrap.data.messageId))
      .get(),
    undefined,
  )
  assert.equal(
    runtime.db.select().from(sessionMessages).where(eq(sessionMessages.id, childMessageId)).get(),
    undefined,
  )
  assert.notEqual(
    runtime.db.select().from(sessionMessages).where(eq(sessionMessages.id, siblingMessageId)).get(),
    undefined,
  )

  assert.equal(
    runtime.db.select().from(runs).where(eq(runs.id, bootstrap.data.runId)).get(),
    undefined,
  )
  assert.equal(runtime.db.select().from(runs).where(eq(runs.id, childRunId)).get(), undefined)
  assert.equal(runtime.db.select().from(runs).where(eq(runs.id, branchRunId)).get(), undefined)
  assert.notEqual(runtime.db.select().from(runs).where(eq(runs.id, siblingRunId)).get(), undefined)

  assert.equal(
    runtime.db.select().from(toolExecutions).where(eq(toolExecutions.id, toolExecutionId)).get(),
    undefined,
  )
  assert.equal(
    runtime.db.select().from(runDependencies).where(eq(runDependencies.id, waitId)).get(),
    undefined,
  )
  assert.equal(
    runtime.db.select().from(items).where(eq(items.id, 'itm_child_worker')).get(),
    undefined,
  )
  assert.equal(
    runtime.db.select().from(contextSummaries).where(eq(contextSummaries.id, summaryId)).get(),
    undefined,
  )
  assert.equal(
    runtime.db.select().from(memoryRecords).where(eq(memoryRecords.id, memoryRecordId)).get(),
    undefined,
  )
  assert.equal(
    runtime.db
      .select()
      .from(memoryRecordSources)
      .where(eq(memoryRecordSources.id, 'mrs_child_worker'))
      .get(),
    undefined,
  )
  assert.equal(
    runtime.db.select().from(usageLedger).where(eq(usageLedger.id, 'use_child_worker')).get(),
    undefined,
  )
  assert.equal(runtime.db.select().from(files).where(eq(files.id, fileId)).get(), undefined)
  assert.equal(runtime.db.select().from(uploads).where(eq(uploads.id, uploadId)).get(), undefined)
  assert.equal(
    runtime.db.select().from(fileLinks).where(eq(fileLinks.id, 'flk_thread_message')).get(),
    undefined,
  )
  assert.equal(
    runtime.db.select().from(fileLinks).where(eq(fileLinks.id, 'flk_thread_session')).get(),
    undefined,
  )
  assert.equal(
    runtime.db.select().from(fileLinks).where(eq(fileLinks.id, 'flk_library_message')).get(),
    undefined,
  )
  assert.notEqual(
    runtime.db.select().from(files).where(eq(files.id, libraryFileId)).get(),
    undefined,
  )
  assert.equal(existsSync(blobPath), false)

  const sessionRow = runtime.db
    .select()
    .from(workSessions)
    .where(eq(workSessions.id, bootstrap.data.sessionId))
    .get()

  assert.equal(sessionRow?.rootRunId, null)
  assert.equal(runtime.db.select().from(runClaims).all().length, 0)

  const remainingEventRows = runtime.db.select().from(domainEvents).all()
  const remainingOutboxRows = runtime.db.select().from(eventOutbox).all()

  assert.equal(
    remainingEventRows.some((row) => deletedEventIds.has(row.id)),
    false,
  )
  assert.equal(
    remainingOutboxRows.some((row) => deletedEventIds.has(row.eventId)),
    false,
  )
})

test('delete thread rejects permanent deletion while a live run is still active', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapThread(app, headers)

  runtime.db
    .update(runs)
    .set({
      status: 'running',
    })
    .where(eq(runs.id, bootstrap.data.runId))
    .run()

  const response = await app.request(`http://local/v1/threads/${bootstrap.data.threadId}`, {
    headers,
    method: 'DELETE',
  })
  const body = await response.json()

  assert.equal(response.status, 409)
  assert.equal(body.ok, false)
  assert.match(body.error.message, /cannot be permanently deleted/i)
  assert.notEqual(
    runtime.db
      .select()
      .from(sessionThreads)
      .where(eq(sessionThreads.id, bootstrap.data.threadId))
      .get(),
    undefined,
  )
})

test('thread interaction creates a new run, executes it, and assembles context from thread-visible history', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapThread(app, headers)

  const capturedRequests: AiInteractionRequest[] = []
  const responses: AiInteractionResponse[] = [
    {
      messages: [
        {
          content: [{ text: 'Start with run execution, then add SSE.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Start with run execution, then add SSE.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Start with run execution, then add SSE.',
      provider: 'openai',
      providerRequestId: 'req_openai_first',
      raw: { stub: 1 },
      responseId: 'resp_openai_first',
      status: 'completed',
      toolCalls: [],
      usage: {
        cachedTokens: 0,
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 5,
        totalTokens: 120,
      },
    },
    {
      messages: [
        {
          content: [{ text: 'After SSE, wire cursor replay.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'After SSE, wire cursor replay.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'After SSE, wire cursor replay.',
      provider: 'openai',
      providerRequestId: 'req_openai_second',
      raw: { stub: 2 },
      responseId: 'resp_openai_second',
      status: 'completed',
      toolCalls: [],
      usage: {
        cachedTokens: 0,
        inputTokens: 130,
        outputTokens: 18,
        reasoningTokens: 3,
        totalTokens: 148,
      },
    },
  ]

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    const response = responses.shift()
    assert.ok(response)

    return ok(response)
  }

  const firstRunResponse = await app.request(
    `http://local/v1/runs/${bootstrap.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(firstRunResponse.status, 200)

  const interactionResponse = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/interactions`,
    {
      body: JSON.stringify({
        text: 'What should come after that?',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  const interactionBody = await interactionResponse.json()

  assert.equal(interactionResponse.status, 202)
  assert.equal(interactionBody.ok, true)

  const interactionExecute = await app.request(
    `http://local/v1/runs/${interactionBody.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const interactionExecuteBody = await interactionExecute.json()

  assert.equal(interactionExecute.status, 200)
  assert.equal(capturedRequests.length, 2)
  assert.deepEqual(
    capturedRequests[1]?.messages.map((message) => ({
      content: message.content,
      role: message.role,
    })),
    [
      {
        content: [{ text: 'Plan the next milestone for the API backend', type: 'text' }],
        role: 'user',
      },
      {
        content: [{ text: 'Start with run execution, then add SSE.', type: 'text' }],
        role: 'assistant',
      },
      {
        content: [{ text: 'What should come after that?', type: 'text' }],
        role: 'user',
      },
    ],
  )
  assert.match(capturedRequests[1]?.messages[1]?.providerMessageId ?? '', /^msg_/)

  const messageRows = runtime.db.select().from(sessionMessages).all()
  const runRows = runtime.db.select().from(runs).all()
  const itemRows = runtime.db.select().from(items).all()
  const workItemRows = runtime.db.select().from(jobs).all()
  const eventTypes = runtime.db
    .select({ type: domainEvents.type })
    .from(domainEvents)
    .all()
    .map((event) => event.type)

  assert.equal(runRows.length, 2)
  assert.equal(messageRows.length, 4)
  assert.equal(workItemRows.length, 1)
  assert.equal(runRows[0]?.jobId, runRows[1]?.jobId)
  assert.equal(
    runRows.find((run) => run.id === interactionBody.data.runId)?.jobId,
    workItemRows.find((workItem) => workItem.currentRunId === interactionBody.data.runId)?.id,
  )
  assert.equal(
    workItemRows.find((workItem) => workItem.currentRunId === interactionBody.data.runId)?.status,
    'completed',
  )
  assert.equal(eventTypes.filter((type) => type === 'job.created').length, 1)
  assert.equal(eventTypes.filter((type) => type === 'job.requeued').length, 1)

  const secondRunItems = itemRows.filter((item) => item.runId === interactionBody.data.runId)
  assert.equal(secondRunItems.length, 4)
  assert.deepEqual(
    secondRunItems.slice(0, 3).map((item) => ({
      content: item.content,
      role: item.role,
      type: item.type,
    })),
    [
      {
        content: [{ text: 'Plan the next milestone for the API backend', type: 'text' }],
        role: 'user',
        type: 'message',
      },
      {
        content: [{ text: 'Start with run execution, then add SSE.', type: 'text' }],
        role: 'assistant',
        type: 'message',
      },
      {
        content: [{ text: 'What should come after that?', type: 'text' }],
        role: 'user',
        type: 'message',
      },
    ],
  )
  assert.equal(secondRunItems[3]?.role, 'assistant')
  assert.deepEqual(secondRunItems[3]?.content, [
    { text: 'After SSE, wire cursor replay.', type: 'text' },
  ])

  assert.equal(messageRows[2]?.id, interactionBody.data.inputMessageId)
  assert.equal(messageRows[2]?.runId, interactionBody.data.runId)
  assert.equal(messageRows[3]?.id, interactionExecuteBody.data.assistantMessageId)
  assert.equal(messageRows[3]?.runId, interactionBody.data.runId)
})

test('thread interaction recovers the already-advanced durable run when execute loses the pending race', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapThread(app, headers)
  let generateCalls = 0

  runtime.services.ai.interactions.generate = async () => {
    generateCalls += 1

    if (generateCalls === 1) {
      return ok<AiInteractionResponse>({
        messages: [
          {
            content: [{ text: 'Bootstrap run completed.', type: 'text' }],
            role: 'assistant',
          },
        ],
        model: 'gpt-5.4',
        output: [
          {
            content: [{ text: 'Bootstrap run completed.', type: 'text' }],
            role: 'assistant',
            type: 'message',
          },
        ],
        outputText: 'Bootstrap run completed.',
        provider: 'openai',
        providerRequestId: 'req_thread_interaction_race_bootstrap',
        raw: { stub: true },
        responseId: 'resp_thread_interaction_race_bootstrap',
        status: 'completed',
        toolCalls: [],
        usage: null,
      })
    }

    return {
      error: {
        message: 'interaction execute should have recovered from durable state',
        type: 'conflict' as const,
      },
      ok: false as const,
    }
  }

  const bootstrapExecute = await app.request(
    `http://local/v1/runs/${bootstrap.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(bootstrapExecute.status, 200)

  const originalTransaction = runtime.db.transaction.bind(runtime.db)
  let advancedRunId: string | null = null

  ;(
    runtime.db as unknown as {
      transaction: typeof runtime.db.transaction
    }
  ).transaction = ((callback: Parameters<typeof runtime.db.transaction>[0]) => {
    const result = originalTransaction(callback)

    if (!advancedRunId) {
      const candidate = runtime.db
        .select()
        .from(runs)
        .all()
        .find(
          (run) =>
            run.threadId === bootstrap.data.threadId &&
            run.id !== bootstrap.data.runId &&
            run.status === 'pending',
        )

      if (candidate) {
        advancedRunId = candidate.id
        runtime.db
          .update(runs)
          .set({
            lastProgressAt: '2026-03-30T16:00:01.000Z',
            resultJson: {
              model: 'gpt-5.4',
              outputText: '',
              pendingWaits: [
                {
                  args: null,
                  callId: 'call_external_wait',
                  createdAt: '2026-03-30T16:00:01.000Z',
                  description: 'Waiting for external approval',
                  targetKind: 'external',
                  targetRef: 'approval_wait_race_1',
                  tool: 'external_gate',
                  type: 'tool',
                  waitId: 'wait_external_wait',
                },
              ],
              provider: 'openai',
              responseId: 'resp_external_wait',
              usage: null,
              waitIds: ['wait_external_wait'],
            },
            status: 'waiting',
            updatedAt: '2026-03-30T16:00:01.000Z',
            version: candidate.version + 1,
          })
          .where(eq(runs.id, candidate.id))
          .run()
      }
    }

    return result
  }) as typeof runtime.db.transaction

  try {
    const interactionResponse = await app.request(
      `http://local/v1/threads/${bootstrap.data.threadId}/interactions`,
      {
        body: JSON.stringify({
          text: 'Recover the durable waiting run instead of starting execution twice.',
        }),
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )
    const interactionBody = await interactionResponse.json()

    assert.equal(interactionResponse.status, 202)
    assert.equal(interactionBody.ok, true)
    assert.equal(interactionBody.data.runId, advancedRunId)
    assert.equal(interactionBody.data.status, 'accepted')
  } finally {
    ;(
      runtime.db as unknown as {
        transaction: typeof runtime.db.transaction
      }
    ).transaction = originalTransaction
  }

  assert.equal(generateCalls, 1)
  assert.notEqual(advancedRunId, null)
  assert.equal(
    runtime.db
      .select()
      .from(sessionMessages)
      .all()
      .filter((message) => message.threadId === bootstrap.data.threadId).length,
    3,
  )
})

test('thread interaction replays prior OpenAI reasoning items for assistant messages', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapThread(app, headers)

  const capturedRequests: AiInteractionRequest[] = []
  const responses: AiInteractionResponse[] = [
    {
      messages: [
        {
          content: [{ text: 'The image text is WIP Weekly.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          encryptedContent: 'enc_reasoning_thread_1',
          id: 'rs_reasoning_thread_1',
          summary: [{ text: 'Need a little OCR reasoning first.', type: 'summary_text' }],
          type: 'reasoning',
        },
        {
          content: [{ text: 'The image text is WIP Weekly.', type: 'text' }],
          providerMessageId: 'msg_reasoned_thread_1',
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'The image text is WIP Weekly.',
      provider: 'openai',
      providerRequestId: 'req_openai_reasoned_first',
      raw: { stub: 'reasoned_first' },
      responseId: 'resp_openai_reasoned_first',
      status: 'completed',
      toolCalls: [],
      usage: {
        cachedTokens: 0,
        inputTokens: 90,
        outputTokens: 22,
        reasoningTokens: 6,
        totalTokens: 112,
      },
    },
    {
      messages: [
        {
          content: [{ text: 'Then acknowledge the follow-up.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Then acknowledge the follow-up.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Then acknowledge the follow-up.',
      provider: 'openai',
      providerRequestId: 'req_openai_reasoned_second',
      raw: { stub: 'reasoned_second' },
      responseId: 'resp_openai_reasoned_second',
      status: 'completed',
      toolCalls: [],
      usage: null,
    },
  ]

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    const response = responses.shift()
    assert.ok(response)

    return ok(response)
  }

  const firstRunResponse = await app.request(
    `http://local/v1/runs/${bootstrap.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(firstRunResponse.status, 200)

  const interactionResponse = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/interactions`,
    {
      body: JSON.stringify({
        text: 'What next?',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  const interactionBody = await interactionResponse.json()

  assert.equal(interactionResponse.status, 202)
  assert.equal(interactionBody.ok, true)

  const interactionExecute = await app.request(
    `http://local/v1/runs/${interactionBody.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(interactionExecute.status, 200)
  assert.equal(capturedRequests.length, 2)

  const replayedMessages = capturedRequests[1]?.messages ?? []
  assert.deepEqual(
    replayedMessages.map((message) => ({
      content: message.content,
      providerMessageId: message.providerMessageId ?? null,
      role: message.role,
    })),
    [
      {
        content: [{ text: 'Plan the next milestone for the API backend', type: 'text' }],
        providerMessageId: null,
        role: 'user',
      },
      {
        content: [
          {
            encryptedContent: 'enc_reasoning_thread_1',
            id: 'rs_reasoning_thread_1',
            summary: [{ text: 'Need a little OCR reasoning first.', type: 'summary_text' }],
            type: 'reasoning',
          },
        ],
        providerMessageId: null,
        role: 'assistant',
      },
      {
        content: [{ text: 'The image text is WIP Weekly.', type: 'text' }],
        providerMessageId: 'msg_reasoned_thread_1',
        role: 'assistant',
      },
      {
        content: [{ text: 'What next?', type: 'text' }],
        providerMessageId: null,
        role: 'user',
      },
    ],
  )

  const secondRunItems = runtime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.runId === interactionBody.data.runId)

  assert.deepEqual(
    secondRunItems.slice(0, 4).map((item) => ({
      providerItemId:
        (
          item.providerPayload as {
            providerItemId?: string | null
          } | null
        )?.providerItemId ?? null,
      providerMessageId:
        (
          item.providerPayload as {
            providerMessageId?: string | null
          } | null
        )?.providerMessageId ?? null,
      role: item.role,
      type: item.type,
    })),
    [
      {
        providerItemId: null,
        providerMessageId: null,
        role: 'user',
        type: 'message',
      },
      {
        providerItemId: 'rs_reasoning_thread_1',
        providerMessageId: null,
        role: null,
        type: 'reasoning',
      },
      {
        providerItemId: null,
        providerMessageId: 'msg_reasoned_thread_1',
        role: 'assistant',
        type: 'message',
      },
      {
        providerItemId: null,
        providerMessageId: null,
        role: 'user',
        type: 'message',
      },
    ],
  )
})

test('thread interaction replays prior tool call history and avoids duplicating inherited items on later turns', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapThread(app, headers)

  registerImmediateFunctionTool(runtime, {
    name: 'get_status',
    output: {
      state: 'ready',
    },
  })

  const capturedRequests: AiInteractionRequest[] = []
  const responses: AiInteractionResponse[] = [
    {
      messages: [],
      model: 'gpt-5.4',
      output: [
        {
          encryptedContent: 'enc_reasoning_thread_tool_1',
          id: 'rs_reasoning_thread_tool_1',
          summary: [{ text: 'Need the latest status before answering.', type: 'summary_text' }],
          type: 'reasoning',
        },
        {
          arguments: {},
          argumentsJson: '{}',
          callId: 'call_status_thread_1',
          name: 'get_status',
          type: 'function_call',
        },
      ],
      outputText: '',
      provider: 'openai',
      providerRequestId: 'req_openai_thread_tool_1',
      raw: { stub: 'thread_tool_1' },
      responseId: 'resp_openai_thread_tool_1',
      status: 'completed',
      toolCalls: [
        {
          arguments: {},
          argumentsJson: '{}',
          callId: 'call_status_thread_1',
          name: 'get_status',
        },
      ],
      usage: null,
    },
    {
      messages: [
        {
          content: [{ text: 'The status is ready.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'The status is ready.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'The status is ready.',
      provider: 'openai',
      providerRequestId: 'req_openai_thread_tool_2',
      raw: { stub: 'thread_tool_2' },
      responseId: 'resp_openai_thread_tool_2',
      status: 'completed',
      toolCalls: [],
      usage: null,
    },
    {
      messages: [
        {
          content: [{ text: 'Track the status history.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Track the status history.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Track the status history.',
      provider: 'openai',
      providerRequestId: 'req_openai_thread_tool_3',
      raw: { stub: 'thread_tool_3' },
      responseId: 'resp_openai_thread_tool_3',
      status: 'completed',
      toolCalls: [],
      usage: null,
    },
    {
      messages: [
        {
          content: [{ text: 'Still tracking it.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Still tracking it.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Still tracking it.',
      provider: 'openai',
      providerRequestId: 'req_openai_thread_tool_4',
      raw: { stub: 'thread_tool_4' },
      responseId: 'resp_openai_thread_tool_4',
      status: 'completed',
      toolCalls: [],
      usage: null,
    },
  ]

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    const response = responses.shift()
    assert.ok(response)

    return ok(response)
  }

  const firstRunResponse = await app.request(
    `http://local/v1/runs/${bootstrap.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(firstRunResponse.status, 200)

  const secondTurnResponse = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/interactions`,
    {
      body: JSON.stringify({
        text: 'What should we do with that status?',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const secondTurnBody = await secondTurnResponse.json()

  assert.equal(secondTurnResponse.status, 202)
  assert.equal(secondTurnBody.ok, true)

  const secondTurnExecute = await app.request(
    `http://local/v1/runs/${secondTurnBody.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(secondTurnExecute.status, 200)

  const thirdTurnResponse = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/interactions`,
    {
      body: JSON.stringify({
        text: 'And what after that?',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const thirdTurnBody = await thirdTurnResponse.json()

  assert.equal(thirdTurnResponse.status, 202)
  assert.equal(thirdTurnBody.ok, true)

  const thirdTurnExecute = await app.request(
    `http://local/v1/runs/${thirdTurnBody.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(thirdTurnExecute.status, 200)
  assert.equal(capturedRequests.length, 4)

  const secondTurnTranscript = (capturedRequests[2]?.messages ?? [])
    .filter((message) => message.role !== 'developer')
    .map((message) => ({
      content: message.content,
      role: message.role,
    }))
  const thirdTurnTranscript = (capturedRequests[3]?.messages ?? [])
    .filter((message) => message.role !== 'developer')
    .map((message) => ({
      content: message.content,
      role: message.role,
    }))

  assert.deepEqual(secondTurnTranscript, [
    {
      content: [{ text: 'Plan the next milestone for the API backend', type: 'text' }],
      role: 'user',
    },
    {
      content: [
        {
          encryptedContent: 'enc_reasoning_thread_tool_1',
          id: 'rs_reasoning_thread_tool_1',
          summary: [{ text: 'Need the latest status before answering.', type: 'summary_text' }],
          type: 'reasoning',
        },
      ],
      role: 'assistant',
    },
    {
      content: [
        {
          argumentsJson: '{}',
          callId: 'call_status_thread_1',
          name: 'get_status',
          type: 'function_call',
        },
      ],
      role: 'assistant',
    },
    {
      content: [
        {
          callId: 'call_status_thread_1',
          isError: false,
          name: 'get_status',
          outputJson: '{"state":"ready"}',
          type: 'function_result',
        },
      ],
      role: 'tool',
    },
    {
      content: [{ text: 'The status is ready.', type: 'text' }],
      role: 'assistant',
    },
    {
      content: [{ text: 'What should we do with that status?', type: 'text' }],
      role: 'user',
    },
  ])

  assert.deepEqual(thirdTurnTranscript, [
    {
      content: [{ text: 'Plan the next milestone for the API backend', type: 'text' }],
      role: 'user',
    },
    {
      content: [
        {
          encryptedContent: 'enc_reasoning_thread_tool_1',
          id: 'rs_reasoning_thread_tool_1',
          summary: [{ text: 'Need the latest status before answering.', type: 'summary_text' }],
          type: 'reasoning',
        },
      ],
      role: 'assistant',
    },
    {
      content: [
        {
          argumentsJson: '{}',
          callId: 'call_status_thread_1',
          name: 'get_status',
          type: 'function_call',
        },
      ],
      role: 'assistant',
    },
    {
      content: [
        {
          callId: 'call_status_thread_1',
          isError: false,
          name: 'get_status',
          outputJson: '{"state":"ready"}',
          type: 'function_result',
        },
      ],
      role: 'tool',
    },
    {
      content: [{ text: 'The status is ready.', type: 'text' }],
      role: 'assistant',
    },
    {
      content: [{ text: 'What should we do with that status?', type: 'text' }],
      role: 'user',
    },
    {
      content: [{ text: 'Track the status history.', type: 'text' }],
      role: 'assistant',
    },
    {
      content: [{ text: 'And what after that?', type: 'text' }],
      role: 'user',
    },
  ])

  const secondRunItems = runtime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.runId === secondTurnBody.data.runId)

  assert.deepEqual(
    secondRunItems.slice(0, 7).map((item) => ({
      callId: item.callId,
      role: item.role,
      type: item.type,
    })),
    [
      {
        callId: null,
        role: 'user',
        type: 'message',
      },
      {
        callId: null,
        role: null,
        type: 'reasoning',
      },
      {
        callId: 'call_status_thread_1',
        role: null,
        type: 'function_call',
      },
      {
        callId: 'call_status_thread_1',
        role: null,
        type: 'function_call_output',
      },
      {
        callId: null,
        role: 'assistant',
        type: 'message',
      },
      {
        callId: null,
        role: 'user',
        type: 'message',
      },
      {
        callId: null,
        role: 'assistant',
        type: 'message',
      },
    ],
  )

  const projectedFunctionCallPayload = secondRunItems[2]?.providerPayload as {
    responseId?: string | null
    source?: string | null
    sourceItemId?: string | null
    sourceRunId?: string | null
  } | null
  const projectedFunctionResultPayload = secondRunItems[3]?.providerPayload as {
    name?: string | null
    source?: string | null
    sourceItemId?: string | null
    sourceRunId?: string | null
  } | null

  assert.equal(projectedFunctionCallPayload?.source, 'session_message_projection')
  assert.equal(projectedFunctionCallPayload?.sourceRunId, bootstrap.data.runId)
  assert.match(projectedFunctionCallPayload?.sourceItemId ?? '', /^itm_/)
  assert.equal(projectedFunctionCallPayload?.responseId, 'resp_openai_thread_tool_1')
  assert.equal(projectedFunctionResultPayload?.source, 'session_message_projection')
  assert.equal(projectedFunctionResultPayload?.sourceRunId, bootstrap.data.runId)
  assert.match(projectedFunctionResultPayload?.sourceItemId ?? '', /^itm_/)
  assert.equal(projectedFunctionResultPayload?.name, 'get_status')
})

test('thread interaction preserves Gemini thought signatures on replayed assistant text', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapThread(app, headers)

  const capturedRequests: AiInteractionRequest[] = []
  const responses: AiInteractionResponse[] = [
    {
      messages: [
        {
          content: [
            {
              text: 'Draft the rollout in two phases.',
              thoughtSignature: 'sig_google_text_1',
              type: 'text',
            },
          ],
          role: 'assistant',
        },
      ],
      model: 'gemini-2.5-pro',
      output: [
        {
          content: [
            {
              text: 'Draft the rollout in two phases.',
              thoughtSignature: 'sig_google_text_1',
              type: 'text',
            },
          ],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Draft the rollout in two phases.',
      provider: 'google',
      providerRequestId: 'req_google_first',
      raw: { stub: 'google_first' },
      responseId: 'resp_google_first',
      status: 'completed',
      toolCalls: [],
      usage: {
        cachedTokens: 0,
        inputTokens: 80,
        outputTokens: 16,
        reasoningTokens: 5,
        totalTokens: 96,
      },
    },
    {
      messages: [
        {
          content: [{ text: 'Then add the follow-up milestone.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gemini-2.5-pro',
      output: [
        {
          content: [{ text: 'Then add the follow-up milestone.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Then add the follow-up milestone.',
      provider: 'google',
      providerRequestId: 'req_google_second',
      raw: { stub: 'google_second' },
      responseId: 'resp_google_second',
      status: 'completed',
      toolCalls: [],
      usage: null,
    },
  ]

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    const response = responses.shift()
    assert.ok(response)

    return ok(response)
  }

  const firstRunResponse = await app.request(
    `http://local/v1/runs/${bootstrap.data.runId}/execute`,
    {
      body: JSON.stringify({
        provider: 'google',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(firstRunResponse.status, 200)

  const interactionResponse = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/interactions`,
    {
      body: JSON.stringify({
        provider: 'google',
        text: 'What should happen after that?',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  const interactionBody = await interactionResponse.json()

  assert.equal(interactionResponse.status, 202)
  assert.equal(interactionBody.ok, true)

  const interactionExecute = await app.request(
    `http://local/v1/runs/${interactionBody.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(interactionExecute.status, 200)
  assert.equal(capturedRequests.length, 2)
  assert.deepEqual(
    capturedRequests[1]?.messages.map((message) => ({
      content: message.content,
      role: message.role,
    })),
    [
      {
        content: [{ text: 'Plan the next milestone for the API backend', type: 'text' }],
        role: 'user',
      },
      {
        content: [
          {
            text: 'Draft the rollout in two phases.',
            thoughtSignature: 'sig_google_text_1',
            type: 'text',
          },
        ],
        role: 'assistant',
      },
      {
        content: [{ text: 'What should happen after that?', type: 'text' }],
        role: 'user',
      },
    ],
  )
  assert.match(capturedRequests[1]?.messages[1]?.providerMessageId ?? '', /^msg_/)

  const secondRunItems = runtime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.runId === interactionBody.data.runId)

  assert.deepEqual(secondRunItems[1]?.content, [
    {
      text: 'Draft the rollout in two phases.',
      thoughtSignature: 'sig_google_text_1',
      type: 'text',
    },
  ])
})

test('thread interaction rejects writes into a session workspace owned by another account', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const firstAuth = seedApiKeyAuth(runtime, {
    accountId: 'acc_owner',
    apiKeyId: 'key_owner',
    secret: 'sk_owner_1234567890',
    tenantId: 'ten_shared',
  })
  const secondAuth = seedApiKeyAuth(runtime, {
    accountId: 'acc_other',
    accountEmail: 'other@example.com',
    apiKeyId: 'key_other',
    includeMembership: false,
    includeTenant: false,
    secret: 'sk_other_1234567890',
    tenantId: 'ten_shared',
  })
  runtime.db
    .insert(tenantMemberships)
    .values({
      accountId: 'acc_other',
      createdAt: '2026-03-29T00:00:00.000Z',
      id: 'mem_ten_shared_other',
      role: 'admin',
      tenantId: 'ten_shared',
    })
    .run()

  const sessionResponse = await app.request('http://local/v1/sessions', {
    body: JSON.stringify({
      title: 'Owner session',
    }),
    headers: {
      ...firstAuth.headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const sessionBody = await sessionResponse.json()

  const threadResponse = await app.request(
    `http://local/v1/sessions/${sessionBody.data.id}/threads`,
    {
      body: JSON.stringify({
        title: 'Owner thread',
      }),
      headers: {
        ...firstAuth.headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const threadBody = await threadResponse.json()

  const interactionResponse = await app.request(
    `http://local/v1/threads/${threadBody.data.id}/interactions`,
    {
      body: JSON.stringify({
        text: 'Try writing into another account session',
      }),
      headers: {
        ...secondAuth.headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const interactionBody = await interactionResponse.json()

  assert.equal(interactionResponse.status, 403)
  assert.equal(interactionBody.ok, false)
  assert.equal(interactionBody.error.type, 'permission')
  assert.match(interactionBody.error.message, /cannot write into workspace owned/)
  assert.equal(runtime.db.select().from(runs).all().length, 0)
})

test('branch thread copies transcript through an assistant message and clears copied run ids', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)

  runtime.services.ai.interactions.generate = async () =>
    ok({
      messages: [
        {
          content: [{ text: 'Initial assistant reply', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Initial assistant reply', type: 'text' }],
          providerMessageId: 'msg_provider_branch_seed',
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Initial assistant reply',
      provider: 'openai',
      providerRequestId: 'req_branch_seed',
      raw: { stub: true },
      responseId: 'resp_branch_seed',
      status: 'completed',
      toolCalls: [],
      usage: {
        cachedTokens: 0,
        inputTokens: 48,
        outputTokens: 6,
        reasoningTokens: 0,
        totalTokens: 54,
      },
    })

  const bootstrap = await bootstrapThread(app, headers)
  runtime.db
    .update(jobs)
    .set({
      completedAt: '2026-03-30T14:00:00.000Z',
      status: 'completed',
      updatedAt: '2026-03-30T14:00:00.000Z',
    })
    .where(eq(jobs.threadId, bootstrap.data.threadId))
    .run()
  const sourceMessages = runtime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.threadId, bootstrap.data.threadId))
    .all()
    .sort((left, right) => left.sequence - right.sequence)
  const sourceUserMessage = sourceMessages.find((message) => message.authorKind === 'user')
  const sourceAssistantMessage =
    sourceMessages.find((message) => message.authorKind === 'assistant') ??
    (() => {
      runtime.db
        .insert(sessionMessages)
        .values({
          authorAccountId: null,
          authorKind: 'assistant',
          content: [{ text: 'Initial assistant reply', type: 'text' }],
          createdAt: '2026-03-30T14:01:00.000Z',
          id: 'msg_branch_source_assistant',
          metadata: null,
          runId: null,
          sequence: 2,
          sessionId: bootstrap.data.sessionId,
          tenantId,
          threadId: bootstrap.data.threadId,
        })
        .run()

      return runtime.db
        .select()
        .from(sessionMessages)
        .where(eq(sessionMessages.id, 'msg_branch_source_assistant'))
        .get()
    })()

  assert.ok(sourceUserMessage)
  assert.ok(sourceAssistantMessage)

  runtime.db
    .insert(files)
    .values({
      accessScope: 'session_local',
      createdAt: '2026-03-30T14:30:00.000Z',
      createdByAccountId: accountId,
      createdByRunId: null,
      id: 'fil_branch_source',
      metadata: null,
      mimeType: 'text/plain',
      originUploadId: null,
      originalFilename: 'branch-source.txt',
      sizeBytes: 21,
      sourceKind: 'upload',
      status: 'ready',
      storageKey: 'files/branch-source.txt',
      tenantId,
      title: 'Branch source file',
      updatedAt: '2026-03-30T14:30:00.000Z',
    })
    .run()

  runtime.db
    .insert(fileLinks)
    .values([
      {
        createdAt: '2026-03-30T14:30:00.000Z',
        fileId: 'fil_branch_source',
        id: 'flk_branch_session',
        linkType: 'session',
        targetId: bootstrap.data.sessionId,
        tenantId,
      },
      {
        createdAt: '2026-03-30T14:30:00.000Z',
        fileId: 'fil_branch_source',
        id: 'flk_branch_message',
        linkType: 'message',
        targetId: sourceUserMessage!.id,
        tenantId,
      },
    ])
    .run()

  const response = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/branches`,
    {
      body: JSON.stringify({
        sourceMessageId: sourceAssistantMessage!.id,
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const body = await response.json()

  assert.equal(response.status, 201)
  assert.equal(body.ok, true)
  assert.equal(body.data.parentThreadId, bootstrap.data.threadId)
  assert.equal(body.data.branchFromMessageId, sourceAssistantMessage!.id)
  assert.equal(body.data.branchFromSequence, sourceAssistantMessage!.sequence)

  const branchedThreadMessages = runtime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.threadId, body.data.id))
    .all()
    .sort((left, right) => left.sequence - right.sequence)

  assert.equal(branchedThreadMessages.length, 2)
  assert.equal(branchedThreadMessages[0]?.sequence, 1)
  assert.equal(branchedThreadMessages[1]?.sequence, 2)
  assert.equal(branchedThreadMessages[0]?.content[0]?.text, sourceUserMessage!.content[0]?.text)
  assert.equal(
    branchedThreadMessages[1]?.content[0]?.text,
    sourceAssistantMessage!.content[0]?.text,
  )
  assert.equal(branchedThreadMessages[0]?.runId, null)
  assert.equal(branchedThreadMessages[1]?.runId, null)

  const branchedMessageLinks = runtime.db
    .select()
    .from(fileLinks)
    .where(eq(fileLinks.linkType, 'message'))
    .all()
    .filter((link) => link.targetId === branchedThreadMessages[0]?.id)

  assert.equal(branchedMessageLinks.length, 1)
  assert.equal(branchedMessageLinks[0]?.fileId, 'fil_branch_source')
  assert.equal(
    runtime.db.select().from(runs).where(eq(runs.threadId, body.data.id)).all().length,
    0,
  )
})

test('branch thread rejects user messages as branch points', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  runtime.services.ai.interactions.generate = async () =>
    ok({
      messages: [
        {
          content: [{ text: 'Assistant reply before branch validation', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Assistant reply before branch validation', type: 'text' }],
          providerMessageId: 'msg_provider_branch_validation',
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Assistant reply before branch validation',
      provider: 'openai',
      providerRequestId: 'req_branch_validation',
      raw: { stub: true },
      responseId: 'resp_branch_validation',
      status: 'completed',
      toolCalls: [],
      usage: {
        cachedTokens: 0,
        inputTokens: 40,
        outputTokens: 8,
        reasoningTokens: 0,
        totalTokens: 48,
      },
    })

  const bootstrap = await bootstrapThread(app, headers)
  runtime.db
    .update(jobs)
    .set({
      completedAt: '2026-03-30T14:05:00.000Z',
      status: 'completed',
      updatedAt: '2026-03-30T14:05:00.000Z',
    })
    .where(eq(jobs.threadId, bootstrap.data.threadId))
    .run()
  const sourceUserMessage = runtime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.threadId, bootstrap.data.threadId))
    .all()
    .find((message) => message.authorKind === 'user')

  assert.ok(sourceUserMessage)

  const response = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/branches`,
    {
      body: JSON.stringify({
        sourceMessageId: sourceUserMessage!.id,
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const body = await response.json()

  assert.equal(response.status, 409)
  assert.equal(body.ok, false)
  assert.match(body.error.message, /cannot be used as a branch point/)
})
