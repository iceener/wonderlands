import assert from 'node:assert/strict'
import { test } from 'vitest'

import { createRunRepository } from '../src/adapters/persistence/sqlite/runtime/run-repository'
import { createInternalCommandContext } from '../src/application/commands/internal-command-context'
import { prepareContextState } from '../src/application/context/prepare-context-state'
import { loadThreadContext } from '../src/application/interactions/load-thread-context'
import { contextSummaries, memoryRecords } from '../src/db/schema'
import type { AiInteractionResponse } from '../src/domain/ai/types'
import type { RunRecord } from '../src/domain/runtime/run-repository'
import { asAccountId, asRunId, asTenantId } from '../src/shared/ids'
import { ok } from '../src/shared/result'
import type { TenantScope } from '../src/shared/scope'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const now = '2026-04-02T00:00:00.000Z'

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
      initialMessage: 'Initial preparation-stage message',
      title: 'Context preparation',
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
  raw: { preparation: true },
  responseId,
  status: 'completed',
  toolCalls: [],
  usage: null,
})

test('prepareContextState honors lifecycle gates and observes before reflecting', async () => {
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
      content: 'Summary of earlier context:\n- user: Preserve preparation ordering.',
      createdAt: now,
      fromSequence: 1,
      id: 'sum_preparation_order',
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
          JSON.stringify({ observations: [{ text: 'Prepared observation.' }] }),
          'resp_preparation_observer',
        ),
      )
    }

    if (stage === 'reflector') {
      return ok(
        jsonResponse(
          JSON.stringify({ reflection: 'Prepared reflection.' }),
          'resp_preparation_reflector',
        ),
      )
    }

    throw new Error(`unexpected AI stage: ${stage}`)
  }

  const context = createInternalCommandContext(runtime, scope)
  const gated = await prepareContextState(
    context,
    run,
    { compact: false, observe: false, reflect: false },
    {
      beforeMemoryLifecycle: () => {
        stages.push('boundaries')
        return ok(null)
      },
    },
  )

  assert.equal(gated.ok, true)
  assert.deepEqual(stages, ['boundaries'])
  assert.deepEqual(gated.ok ? gated.value.readiness : null, {
    compaction: 'disabled',
    observation: 'disabled',
    projection: 'ready',
    reflection: 'disabled',
  })
  assert.equal(runtime.db.select().from(memoryRecords).all().length, 0)

  stages.length = 0
  const enabled = await prepareContextState(
    context,
    run,
    { compact: false },
    {
      beforeMemoryLifecycle: () => {
        stages.push('boundaries')
        return ok(null)
      },
    },
  )

  assert.equal(enabled.ok, true)
  assert.deepEqual(stages, ['boundaries', 'observer', 'reflector'])
  assert.deepEqual(
    runtime.db
      .select()
      .from(memoryRecords)
      .all()
      .map((record) => [record.kind, record.status]),
    [
      ['observation', 'superseded'],
      ['reflection', 'active'],
    ],
  )
})

test('prepareContextState keeps compaction root-only and honors compact false', async () => {
  const { app, runtime } = createTestHarness(compactionEnv)
  const auth = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, auth.headers)
  const scope = scopeFor(auth.accountId, auth.tenantId)
  const rootRun = requireRun(runtime, scope, bootstrap.data.runId)
  const context = createInternalCommandContext(runtime, scope)

  for (const text of [
    `A${' earlier preparation context'.repeat(100)}`,
    `B${' additional sealed preparation context'.repeat(100)}`,
    `C${' newest preparation context'.repeat(15)}`,
  ]) {
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

  const disabled = await prepareContextState(context, rootRun, {
    compact: false,
    observe: false,
    reflect: false,
  })

  assert.equal(disabled.ok, true)
  assert.equal(disabled.ok ? disabled.value.readiness.compaction : null, 'disabled')
  assert.equal(runtime.db.select().from(contextSummaries).all().length, 0)

  const childRun: RunRecord = {
    ...rootRun,
    id: asRunId('run_preparation_child'),
    parentRunId: rootRun.id,
    threadId: null,
  }
  const child = await prepareContextState(context, childRun, {
    compact: true,
    observe: false,
    reflect: true,
  })

  assert.equal(child.ok, true)
  assert.equal(child.ok ? child.value.readiness.compaction : null, 'ineligible_child_run')
  assert.equal(child.ok ? child.value.readiness.reflection : null, 'ineligible_child_run')
  assert.equal(runtime.db.select().from(contextSummaries).all().length, 0)

  const root = await prepareContextState(context, rootRun, {
    compact: true,
    observe: false,
    reflect: false,
  })

  assert.equal(root.ok, true)
  assert.equal(root.ok ? root.value.readiness.compaction : null, 'completed')
  assert.ok(root.ok && root.value.latestSummary)
  assert.equal(runtime.db.select().from(contextSummaries).all().length, 1)
})

test('loadThreadContext remains compatible with prepared durable boundaries', async () => {
  const { app, runtime } = createTestHarness(compactionEnv)
  const auth = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, auth.headers)
  const scope = scopeFor(auth.accountId, auth.tenantId)
  const run = requireRun(runtime, scope, bootstrap.data.runId)
  const context = createInternalCommandContext(runtime, scope)
  const options = { compact: false, observe: false, reflect: false }

  const loaded = await loadThreadContext(context, run, options)
  const prepared = await prepareContextState(context, run, options)

  assert.equal(loaded.ok, true)
  assert.equal(prepared.ok, true)
  assert.deepEqual(
    loaded.ok ? loaded.value.visibleMessages : null,
    prepared.ok ? prepared.value.visibleMessages : null,
  )
  assert.deepEqual(
    loaded.ok ? loaded.value.items : null,
    prepared.ok ? prepared.value.liveTailItems : null,
  )
  assert.deepEqual(
    loaded.ok ? loaded.value.pendingWaits : null,
    prepared.ok ? prepared.value.pendingWaits : null,
  )
  assert.deepEqual(
    loaded.ok ? loaded.value.summary : null,
    prepared.ok ? prepared.value.latestSummary : null,
  )
  assert.deepEqual(loaded.ok ? loaded.value.run : null, prepared.ok ? prepared.value.run : null)
})
