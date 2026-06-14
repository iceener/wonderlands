import assert from 'node:assert/strict'
import { test } from 'vitest'
import { runs, sessionMessages, sessionThreads, usageLedger, workSessions } from '../src/db/schema'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

test('thread budget route returns a current estimate and the latest provider usage', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers, tenantId } = seedApiKeyAuth(runtime)

  runtime.db
    .insert(workSessions)
    .values({
      createdAt: '2026-03-30T10:00:00.000Z',
      createdByAccountId: null,
      id: 'ses_budget_1',
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId,
      title: 'Budget test session',
      updatedAt: '2026-03-30T10:00:00.000Z',
      workspaceId: null,
      workspaceRef: null,
    })
    .run()

  runtime.db
    .insert(sessionThreads)
    .values({
      createdAt: '2026-03-30T10:00:00.000Z',
      createdByAccountId: null,
      id: 'thr_budget_1',
      parentThreadId: null,
      sessionId: 'ses_budget_1',
      status: 'active',
      tenantId,
      title: 'Budget test thread',
      updatedAt: '2026-03-30T10:00:00.000Z',
    })
    .run()

  runtime.db
    .insert(runs)
    .values({
      actorAccountId: null,
      agentId: null,
      agentRevisionId: null,
      completedAt: '2026-03-30T10:01:00.000Z',
      configSnapshot: {
        model: 'gpt-5.4',
        provider: 'openai',
      },
      createdAt: '2026-03-30T10:00:00.000Z',
      errorJson: null,
      id: 'run_budget_1',
      lastProgressAt: '2026-03-30T10:01:00.000Z',
      parentRunId: null,
      resultJson: {
        model: 'gpt-5.4',
        outputText: 'Assistant answer for the current thread.',
        provider: 'openai',
        responseId: 'resp_budget_1',
        usage: {
          cachedTokens: 120,
          inputTokens: 4_900,
          outputTokens: 620,
          reasoningTokens: 64,
          totalTokens: 5_584,
        },
      },
      rootRunId: 'run_budget_1',
      sessionId: 'ses_budget_1',
      sourceCallId: null,
      startedAt: '2026-03-30T10:00:01.000Z',
      status: 'completed',
      task: 'Budget test task',
      tenantId,
      targetKind: 'assistant',
      threadId: 'thr_budget_1',
      toolProfileId: null,
      turnCount: 1,
      updatedAt: '2026-03-30T10:01:00.000Z',
      version: 2,
      jobId: null,
      workspaceId: null,
      workspaceRef: null,
    })
    .run()

  runtime.db
    .insert(sessionMessages)
    .values({
      authorAccountId: null,
      authorKind: 'user',
      content: [{ text: 'Plan the next milestone for the API backend', type: 'text' }],
      createdAt: '2026-03-30T10:00:00.500Z',
      id: 'msg_budget_1',
      metadata: null,
      runId: null,
      sequence: 1,
      sessionId: 'ses_budget_1',
      tenantId,
      threadId: 'thr_budget_1',
    })
    .run()

  runtime.db
    .insert(usageLedger)
    .values({
      cachedTokens: 120,
      createdAt: '2026-03-30T10:01:00.000Z',
      estimatedInputTokens: 5_120,
      estimatedOutputTokens: 2_048,
      id: 'use_budget_1',
      inputTokens: 4_900,
      model: 'gpt-5.4',
      operation: 'interaction',
      outputTokens: 620,
      provider: 'openai',
      runId: 'run_budget_1',
      sessionId: 'ses_budget_1',
      stablePrefixTokens: 3_000,
      tenantId,
      threadId: 'thr_budget_1',
      toolExecutionId: null,
      turn: 1,
      volatileSuffixTokens: 2_120,
    })
    .run()

  const response = await app.request('http://local/v1/threads/thr_budget_1/budget', {
    headers,
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.data.budget.contextWindow, 1_047_576)
  assert.equal(body.data.budget.actualInputTokens, 4_900)
  assert.equal(body.data.budget.actualOutputTokens, 620)
  assert.equal(body.data.budget.actualTotalTokens, 5_584)
  assert.equal(body.data.budget.cachedInputTokens, 120)
  assert.equal(body.data.budget.reasoningTokens, 64)
  assert.equal(body.data.budget.model, 'gpt-5.4')
  assert.equal(body.data.budget.provider, 'openai')
  assert.equal(body.data.budget.measuredAt, '2026-03-30T10:01:00.000Z')
  assert.equal(body.data.budget.turn, 2)
  assert.equal(body.data.budget.estimatedInputTokens > 0, true)
  assert.notEqual(body.data.budget.estimatedInputTokens, 5_120)
})
