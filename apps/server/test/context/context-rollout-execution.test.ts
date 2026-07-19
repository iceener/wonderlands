import assert from 'node:assert/strict'
import { test } from 'vitest'

import { createContextManifestRepository } from '../../src/adapters/persistence/sqlite/context/context-manifest-repository'
import type { AiInteractionResponse } from '../../src/domain/ai/types'
import { asAccountId, asRunId, asTenantId } from '../../src/shared/ids'
import { ok } from '../../src/shared/result'
import type { TenantScope } from '../../src/shared/scope'
import { seedApiKeyAuth } from '../helpers/api-key-auth'
import { createTestHarness } from '../helpers/create-test-app'

const executeCompletedRun = async (env: NodeJS.ProcessEnv) => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
    ...env,
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrapResponse = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Verify context rollout behavior',
      title: 'Context rollout',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(bootstrapResponse.status, 201)
  const bootstrap = (await bootstrapResponse.json()) as {
    data: { runId: string }
  }

  runtime.services.ai.interactions.generate = async () =>
    ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Rollout verified.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Rollout verified.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Rollout verified.',
      provider: 'openai',
      providerRequestId: 'req_rollout',
      raw: { stub: true },
      responseId: 'resp_rollout',
      status: 'completed',
      toolCalls: [],
      usage: {
        cachedTokens: 0,
        inputTokens: 20,
        outputTokens: 4,
        reasoningTokens: 0,
        totalTokens: 24,
      },
    })

  const executeResponse = await app.request(
    `http://local/v1/runs/${bootstrap.data.runId}/execute`,
    {
      body: '{}',
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(executeResponse.status, 200)

  const scope: TenantScope = {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  }
  const manifests = createContextManifestRepository(runtime.db).list(scope, {
    runId: asRunId(bootstrap.data.runId),
  })

  assert.ok(manifests.ok)
  return manifests.value
}

test('execute-run skips manifest persistence with conservative rollout defaults', async () => {
  const manifests = await executeCompletedRun({})

  assert.deepEqual(manifests, [])
})

test('execute-run persists shadow manifests for an enabled allowlisted actor', async () => {
  const manifests = await executeCompletedRun({
    CONTEXT_ASSEMBLY_MODE: 'v2_shadow',
    CONTEXT_MANIFEST_PERSIST: 'true',
    CONTEXT_V2_ACCOUNT_ALLOWLIST: 'acc_test',
  })

  assert.equal(manifests.length, 1)
  assert.equal(manifests[0]?.mode, 'shadow')
  assert.equal(manifests[0]?.turn, 1)
})
