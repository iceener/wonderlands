import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'

import { domainEvents, jobs, runDependencies, runs, toolExecutions } from '../src/db/schema'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const bootstrapRun = async (
  app: ReturnType<typeof createTestHarness>['app'],
  headers: Record<string, string>,
) => {
  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Wait for external tools before answering.',
      title: 'Resume waiting run',
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

test('resolving one of multiple waits refreshes durable run and job snapshots', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const runId = bootstrap.data.runId as string
  const threadId = bootstrap.data.threadId as string

  const initialRun = runtime.db
    .select()
    .from(runs)
    .all()
    .find((candidate) => candidate.id === runId)
  assert.ok(initialRun)
  assert.ok(initialRun.jobId)

  runtime.db
    .update(runs)
    .set({
      lastProgressAt: '2026-04-01T20:40:00.000Z',
      resultJson: {
        model: 'gpt-5.4',
        outputText: '',
        pendingWaits: [
          {
            args: { query: 'alpha' },
            callId: 'call_wait_alpha',
            createdAt: '2026-04-01T20:40:00.000Z',
            description: 'Waiting on alpha tool',
            targetKind: 'external',
            targetRef: 'alpha',
            tool: 'external_alpha',
            type: 'tool',
            waitId: 'wte_alpha',
          },
          {
            args: { query: 'beta' },
            callId: 'call_wait_beta',
            createdAt: '2026-04-01T20:40:01.000Z',
            description: 'Waiting on beta tool',
            targetKind: 'external',
            targetRef: 'beta',
            tool: 'external_beta',
            type: 'tool',
            waitId: 'wte_beta',
          },
        ],
        provider: 'openai',
        responseId: 'resp_waiting',
        usage: null,
        waitIds: ['wte_alpha', 'wte_beta'],
      },
      status: 'waiting',
      updatedAt: '2026-04-01T20:40:00.000Z',
      version: (initialRun.version ?? 1) + 1,
    })
    .where(eq(runs.id, runId))
    .run()

  runtime.db
    .update(jobs)
    .set({
      lastHeartbeatAt: '2026-04-01T20:40:00.000Z',
      lastSchedulerSyncAt: '2026-04-01T20:40:00.000Z',
      nextSchedulerCheckAt: null,
      queuedAt: null,
      status: 'waiting',
      statusReasonJson: {
        runId,
        waitIds: ['wte_alpha', 'wte_beta'],
      },
      updatedAt: '2026-04-01T20:40:00.000Z',
    })
    .where(eq(jobs.id, initialRun.jobId))
    .run()

  runtime.db
    .insert(toolExecutions)
    .values([
      {
        argsJson: { query: 'alpha' },
        completedAt: null,
        createdAt: '2026-04-01T20:40:00.000Z',
        domain: 'system',
        durationMs: null,
        errorText: null,
        id: 'call_wait_alpha',
        outcomeJson: null,
        runId,
        startedAt: '2026-04-01T20:40:00.000Z',
        tenantId: 'ten_test',
        tool: 'external_alpha',
      },
      {
        argsJson: { query: 'beta' },
        completedAt: null,
        createdAt: '2026-04-01T20:40:01.000Z',
        domain: 'system',
        durationMs: null,
        errorText: null,
        id: 'call_wait_beta',
        outcomeJson: null,
        runId,
        startedAt: '2026-04-01T20:40:01.000Z',
        tenantId: 'ten_test',
        tool: 'external_beta',
      },
    ])
    .run()

  runtime.db
    .insert(runDependencies)
    .values([
      {
        callId: 'call_wait_alpha',
        createdAt: '2026-04-01T20:40:00.000Z',
        description: 'Waiting on alpha tool',
        id: 'wte_alpha',
        resolutionJson: null,
        resolvedAt: null,
        runId,
        status: 'pending',
        targetKind: 'external',
        targetRef: 'alpha',
        targetRunId: null,
        tenantId: 'ten_test',
        timeoutAt: null,
        type: 'tool',
      },
      {
        callId: 'call_wait_beta',
        createdAt: '2026-04-01T20:40:01.000Z',
        description: 'Waiting on beta tool',
        id: 'wte_beta',
        resolutionJson: null,
        resolvedAt: null,
        runId,
        status: 'pending',
        targetKind: 'external',
        targetRef: 'beta',
        targetRunId: null,
        tenantId: 'ten_test',
        timeoutAt: null,
        type: 'tool',
      },
    ])
    .run()

  runtime.db
    .insert(domainEvents)
    .values([
      {
        actorAccountId: 'acc_test',
        aggregateId: 'call_wait_alpha',
        aggregateType: 'tool_execution',
        category: 'domain',
        causationId: null,
        createdAt: '2026-04-01T20:40:00.000Z',
        eventNo: 1001,
        id: 'evt_wait_alpha_called',
        payload: {
          args: { query: 'alpha' },
          callId: 'call_wait_alpha',
          runId,
          sessionId: bootstrap.data.sessionId,
          threadId,
          tool: 'external_alpha',
        },
        tenantId: 'ten_test',
        traceId: 'trace_test',
        type: 'tool.called',
      },
      {
        actorAccountId: 'acc_test',
        aggregateId: 'call_wait_alpha',
        aggregateType: 'tool_execution',
        category: 'domain',
        causationId: null,
        createdAt: '2026-04-01T20:40:00.100Z',
        eventNo: 1002,
        id: 'evt_wait_alpha_waiting',
        payload: {
          args: { query: 'alpha' },
          callId: 'call_wait_alpha',
          runId,
          sessionId: bootstrap.data.sessionId,
          threadId,
          tool: 'external_alpha',
          waitId: 'wte_alpha',
          waitTargetKind: 'external',
          waitTargetRef: 'alpha',
        },
        tenantId: 'ten_test',
        traceId: 'trace_test',
        type: 'tool.waiting',
      },
      {
        actorAccountId: 'acc_test',
        aggregateId: 'call_wait_beta',
        aggregateType: 'tool_execution',
        category: 'domain',
        causationId: null,
        createdAt: '2026-04-01T20:40:01.000Z',
        eventNo: 1003,
        id: 'evt_wait_beta_called',
        payload: {
          args: { query: 'beta' },
          callId: 'call_wait_beta',
          runId,
          sessionId: bootstrap.data.sessionId,
          threadId,
          tool: 'external_beta',
        },
        tenantId: 'ten_test',
        traceId: 'trace_test',
        type: 'tool.called',
      },
      {
        actorAccountId: 'acc_test',
        aggregateId: 'call_wait_beta',
        aggregateType: 'tool_execution',
        category: 'domain',
        causationId: null,
        createdAt: '2026-04-01T20:40:01.100Z',
        eventNo: 1004,
        id: 'evt_wait_beta_waiting',
        payload: {
          args: { query: 'beta' },
          callId: 'call_wait_beta',
          runId,
          sessionId: bootstrap.data.sessionId,
          threadId,
          tool: 'external_beta',
          waitId: 'wte_beta',
          waitTargetKind: 'external',
          waitTargetRef: 'beta',
        },
        tenantId: 'ten_test',
        traceId: 'trace_test',
        type: 'tool.waiting',
      },
    ])
    .run()

  const resumeResponse = await app.request(`http://local/v1/runs/${runId}/resume`, {
    body: JSON.stringify({
      output: { ok: true, value: 'alpha-ready' },
      waitId: 'wte_alpha',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(resumeResponse.status, 202)
  const resumeBody = await resumeResponse.json()
  assert.equal(resumeBody.data.status, 'waiting')
  assert.deepEqual(resumeBody.data.waitIds, ['wte_beta'])
  assert.equal(resumeBody.data.pendingWaits.length, 1)
  assert.equal(resumeBody.data.pendingWaits[0]?.waitId, 'wte_beta')

  const persistedRun = runtime.db
    .select()
    .from(runs)
    .all()
    .find((candidate) => candidate.id === runId)
  assert.ok(persistedRun)
  const persistedResult =
    persistedRun?.resultJson && typeof persistedRun.resultJson === 'object'
      ? (persistedRun.resultJson as {
          pendingWaits?: Array<{ waitId?: string }>
          transcript?: {
            toolBlocks?: Array<{
              status?: string
              toolCallId?: string
            }>
          }
          waitIds?: string[]
        })
      : null
  assert.deepEqual(persistedResult?.waitIds, ['wte_beta'])
  assert.equal(persistedResult?.pendingWaits?.length, 1)
  assert.equal(persistedResult?.pendingWaits?.[0]?.waitId, 'wte_beta')
  assert.equal(
    persistedResult?.transcript?.toolBlocks?.some(
      (block) => block.toolCallId === 'call_wait_alpha' && block.status === 'complete',
    ),
    true,
  )
  assert.equal(
    persistedResult?.transcript?.toolBlocks?.some(
      (block) => block.toolCallId === 'call_wait_beta' && block.status === 'running',
    ),
    true,
  )

  const persistedJob = runtime.db
    .select()
    .from(jobs)
    .all()
    .find((candidate) => candidate.id === initialRun.jobId)
  assert.ok(persistedJob)
  const persistedJobReason =
    persistedJob?.statusReasonJson && typeof persistedJob.statusReasonJson === 'object'
      ? (persistedJob.statusReasonJson as { waitIds?: string[] })
      : null
  assert.deepEqual(persistedJobReason?.waitIds, ['wte_beta'])

  const getRunResponse = await app.request(`http://local/v1/runs/${runId}`, {
    headers,
    method: 'GET',
  })
  assert.equal(getRunResponse.status, 200)
  const getRunBody = await getRunResponse.json()
  assert.deepEqual(getRunBody.data.resultJson.waitIds, ['wte_beta'])
  assert.equal(getRunBody.data.resultJson.pendingWaits.length, 1)
  assert.equal(getRunBody.data.resultJson.pendingWaits[0]?.waitId, 'wte_beta')

  const getThreadResponse = await app.request(`http://local/v1/threads/${threadId}`, {
    headers,
    method: 'GET',
  })
  assert.equal(getThreadResponse.status, 200)
  const getThreadBody = await getThreadResponse.json()
  assert.deepEqual(getThreadBody.data.rootJob.statusReasonJson.waitIds, ['wte_beta'])
})
