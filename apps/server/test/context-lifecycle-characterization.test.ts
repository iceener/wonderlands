import assert from 'node:assert/strict'
import { test } from 'vitest'

import { createRunRepository } from '../src/adapters/persistence/sqlite/runtime/run-repository'
import { createInternalCommandContext } from '../src/application/commands/internal-command-context'
import { loadThreadContext } from '../src/application/interactions/load-thread-context'
import { maybeCompactMainThreadContext } from '../src/application/runtime/execution/context-compaction'
import { contextSummaries, memoryRecords } from '../src/db/schema'
import type { AiInteractionResponse } from '../src/domain/ai/types'
import type { ItemRecord } from '../src/domain/runtime/item-repository'
import type { RunDependencyRecord } from '../src/domain/runtime/run-dependency-repository'
import type { RunRecord } from '../src/domain/runtime/run-repository'
import { asAccountId, asItemId, asRunId, asTenantId } from '../src/shared/ids'
import { ok } from '../src/shared/result'
import type { TenantScope } from '../src/shared/scope'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const now = '2026-04-01T00:00:00.000Z'

const compactionEnv = {
  AUTH_MODE: 'api_key',
  MEMORY_COMPACTION_RAW_ITEMS: '1',
  MEMORY_OBSERVATION_TAIL_RATIO: '0.1',
  MEMORY_OBSERVATION_TRIGGER_RATIO: '0.0005',
  NODE_ENV: 'test',
}

const bootstrapRun = async (
  app: ReturnType<typeof createTestHarness>['app'],
  headers: Record<string, string>,
) => {
  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Initial lifecycle characterization message',
      title: 'Lifecycle characterization',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 201)

  return (await response.json()) as {
    data: {
      runId: string
      threadId: string
    }
  }
}

const scopeFor = (accountId: string, tenantId: string): TenantScope => ({
  accountId: asAccountId(accountId),
  role: 'admin',
  tenantId: asTenantId(tenantId),
})

const requireRun = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  scope: TenantScope,
  runId: string,
): RunRecord => {
  const result = createRunRepository(runtime.db).getById(scope, asRunId(runId))

  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error(result.error.message)
  }

  return result.value
}

const messageItem = (run: RunRecord, sequence: number, text: string): ItemRecord => ({
  arguments: null,
  callId: null,
  content: [{ text, type: 'text' }],
  createdAt: now,
  id: asItemId(`itm_characterization_${sequence}`),
  name: null,
  output: null,
  providerPayload: null,
  role: sequence % 2 === 0 ? 'assistant' : 'user',
  runId: run.id,
  sequence,
  summary: null,
  tenantId: run.tenantId,
  type: 'message',
})

const compactionDeps = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  scope: TenantScope,
) => ({
  config: runtime.config,
  createId: <TPrefix extends string>(prefix: TPrefix): `${TPrefix}_${string}` =>
    `${prefix}_characterization` as `${TPrefix}_${string}`,
  db: runtime.db,
  nowIso: () => now,
  scope,
})

const jsonResponse = (outputText: string, responseId: string): AiInteractionResponse => ({
  messages: [
    {
      content: [{ text: outputText, type: 'text' }],
      role: 'assistant',
    },
  ],
  model: 'gpt-5.4',
  output: [
    {
      content: [{ text: outputText, type: 'text' }],
      role: 'assistant',
      type: 'message',
    },
  ],
  outputText,
  provider: 'openai',
  providerRequestId: `req_${responseId}`,
  raw: { characterization: true },
  responseId,
  status: 'completed',
  toolCalls: [],
  usage: null,
})

test('main-thread compaction is root-only', async () => {
  const { app, runtime } = createTestHarness(compactionEnv)
  const auth = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, auth.headers)
  const scope = scopeFor(auth.accountId, auth.tenantId)
  const rootRun = requireRun(runtime, scope, bootstrap.data.runId)
  const childRun: RunRecord = {
    ...rootRun,
    id: asRunId('run_characterization_child'),
    parentRunId: rootRun.id,
  }
  const longText = 'preserved lifecycle detail '.repeat(300)
  const rootItems = [
    messageItem(rootRun, 1, `first ${longText}`),
    messageItem(rootRun, 2, `second ${longText}`),
    messageItem(rootRun, 3, 'newest raw tail'),
  ]
  const childItems = rootItems.map((item) => ({ ...item, runId: childRun.id }))

  const childResult = maybeCompactMainThreadContext(
    compactionDeps(runtime, scope),
    childRun,
    childItems,
    [],
  )

  assert.equal(childResult.ok, true)
  assert.equal(childResult.ok ? childResult.value : undefined, null)
  assert.equal(runtime.db.select().from(contextSummaries).all().length, 0)

  const rootResult = maybeCompactMainThreadContext(
    compactionDeps(runtime, scope),
    rootRun,
    rootItems,
    [],
  )

  assert.equal(rootResult.ok, true)
  assert.ok(rootResult.ok && rootResult.value)
  assert.equal(rootResult.ok ? rootResult.value?.runId : null, rootRun.id)
  assert.equal(runtime.db.select().from(contextSummaries).all().length, 1)
})

test('a pending wait keeps its function call on the live side of the compaction boundary', async () => {
  const { app, runtime } = createTestHarness(compactionEnv)
  const auth = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, auth.headers)
  const scope = scopeFor(auth.accountId, auth.tenantId)
  const run = requireRun(runtime, scope, bootstrap.data.runId)
  const callId = 'call_pending_characterization'
  const items: ItemRecord[] = [
    messageItem(run, 1, `sealed history ${'substantial context '.repeat(300)}`),
    {
      arguments: JSON.stringify({ task: 'wait for delegated research' }),
      callId,
      content: null,
      createdAt: now,
      id: asItemId('itm_characterization_pending_call'),
      name: 'delegate_to_agent',
      output: null,
      providerPayload: null,
      role: null,
      runId: run.id,
      sequence: 2,
      summary: null,
      tenantId: run.tenantId,
      type: 'function_call',
    },
    messageItem(run, 3, `intervening detail ${'more context '.repeat(100)}`),
    messageItem(run, 4, 'newest raw tail'),
  ]
  const pendingWait: RunDependencyRecord = {
    callId,
    createdAt: now,
    description: null,
    id: 'dep_characterization_pending',
    resolutionJson: null,
    resolvedAt: null,
    runId: run.id,
    status: 'pending',
    targetKind: 'agent',
    targetRef: null,
    targetRunId: null,
    tenantId: run.tenantId,
    timeoutAt: null,
    type: 'agent',
  }

  const result = maybeCompactMainThreadContext(compactionDeps(runtime, scope), run, items, [
    pendingWait,
  ])

  assert.equal(result.ok, true)
  assert.ok(result.ok && result.value)
  assert.equal(result.ok ? result.value?.throughSequence : null, 1)
  assert.equal(items.find((item) => item.callId === callId)?.sequence, 2)
})

test('loadThreadContext gates observer and reflector work, and observes before reflecting', async () => {
  const { app, runtime } = createTestHarness({
    ...compactionEnv,
    MEMORY_REFLECTION_TRIGGER_RATIO: '0.00005',
  })
  const auth = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, auth.headers)
  const scope = scopeFor(auth.accountId, auth.tenantId)
  const run = requireRun(runtime, scope, bootstrap.data.runId)

  runtime.db
    .insert(contextSummaries)
    .values({
      content: 'Summary of earlier main-thread context:\n- user: Preserve lifecycle ordering.',
      createdAt: now,
      fromSequence: 1,
      id: 'sum_lifecycle_gate',
      modelKey: 'main_thread_compaction_v1',
      previousSummaryId: null,
      runId: run.id,
      tenantId: run.tenantId,
      throughSequence: 1,
      tokensAfter: 20,
      tokensBefore: 100,
      turnNumber: 0,
    })
    .run()

  const stages: string[] = []
  runtime.services.ai.interactions.generate = async (request) => {
    const stage = String(request.metadata?.stage ?? 'interaction')
    stages.push(stage)

    if (stage === 'observer') {
      return ok(
        jsonResponse(
          JSON.stringify({ observations: [{ text: 'Observation created during context load.' }] }),
          'resp_lifecycle_observer',
        ),
      )
    }

    if (stage === 'reflector') {
      return ok(
        jsonResponse(
          JSON.stringify({ reflection: 'Reflection created from the just-observed summary.' }),
          'resp_lifecycle_reflector',
        ),
      )
    }

    throw new Error(`unexpected AI stage: ${stage}`)
  }

  const commandContext = createInternalCommandContext(runtime, scope)
  const gated = await loadThreadContext(commandContext, run, {
    compact: false,
    observe: false,
    reflect: false,
  })

  assert.equal(gated.ok, true)
  assert.deepEqual(stages, [])
  assert.equal(runtime.db.select().from(memoryRecords).all().length, 0)

  const enabled = await loadThreadContext(commandContext, run, {
    compact: false,
    observe: true,
    reflect: true,
  })

  assert.equal(enabled.ok, true)
  assert.deepEqual(stages, ['observer', 'reflector'])

  const records = runtime.db.select().from(memoryRecords).all()
  assert.deepEqual(
    records.map((record) => [record.kind, record.status]),
    [
      ['observation', 'superseded'],
      ['reflection', 'active'],
    ],
  )
  assert.equal(enabled.ok ? enabled.value.observations.length : -1, 0)
  assert.equal(enabled.ok ? enabled.value.activeReflection?.kind : null, 'reflection')
})

test('budget reads a deterministic durable snapshot without lifecycle side effects', async () => {
  const { app, runtime } = createTestHarness(compactionEnv)
  const auth = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, auth.headers)
  const generatedStages: string[] = []

  runtime.services.ai.interactions.generate = async (request) => {
    generatedStages.push(String(request.metadata?.stage ?? 'interaction'))
    throw new Error('the budget characterization path must not invoke the AI service')
  }

  const longMessages = [
    `A${' earlier lifecycle context'.repeat(100)}`,
    `B${' additional sealed context'.repeat(100)}`,
    `C${' newest context remains live'.repeat(15)}`,
  ]

  for (const text of longMessages) {
    const response = await app.request(
      `http://local/v1/threads/${bootstrap.data.threadId}/messages`,
      {
        body: JSON.stringify({ text }),
        headers: {
          ...auth.headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    assert.equal(response.status, 201)
  }

  assert.equal(runtime.db.select().from(contextSummaries).all().length, 0)

  const tableCounts = (): Record<string, number> => {
    const tables = runtime.db.sqlite
      .prepare<{ name: string }>(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
      )
      .all()

    return Object.fromEntries(
      tables.map(({ name }) => {
        const escapedName = name.replaceAll('"', '""')
        const row = runtime.db.sqlite
          .prepare<{ count: number }>(`select count(*) as count from "${escapedName}"`)
          .get()

        return [name, row?.count ?? 0]
      }),
    )
  }
  let clockCalls = 0
  const originalNowIso = runtime.services.clock.nowIso
  runtime.services.clock.nowIso = () => {
    clockCalls += 1
    return originalNowIso()
  }
  let idCalls = 0
  const originalCreateId = runtime.services.ids.create
  runtime.services.ids.create = <TPrefix extends string>(prefix: TPrefix) => {
    idCalls += 1
    return originalCreateId(prefix)
  }
  const beforeCounts = tableCounts()
  const firstResponse = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/budget`,
    { headers: auth.headers },
  )
  const secondResponse = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/budget`,
    { headers: auth.headers },
  )
  const firstBody = await firstResponse.json()
  const secondBody = await secondResponse.json()

  assert.equal(firstResponse.status, 200)
  assert.equal(secondResponse.status, 200)
  assert.deepEqual(secondBody.data.budget, firstBody.data.budget)
  assert.deepEqual(tableCounts(), beforeCounts)
  assert.equal(runtime.db.select().from(contextSummaries).all().length, 0)
  assert.equal(runtime.db.select().from(memoryRecords).all().length, 0)
  // API-key authentication checks expiry once per request; budget assembly itself adds no calls.
  assert.equal(clockCalls, 2)
  assert.equal(idCalls, 0)
  assert.deepEqual(generatedStages, [])
})
