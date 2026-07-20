import assert from 'node:assert/strict'
import { test } from 'vitest'

import { contextSummaries, memoryRecords } from '../src/db/schema'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

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
