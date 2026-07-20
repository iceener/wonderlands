import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { onTestFinished, test } from 'vitest'

import { closeAppRuntime } from '../src/app/runtime'
import { createEventStore } from '../src/application/commands/event-store'
import { dispatchProjectionEvent } from '../src/application/events/projection-dispatcher'
import {
  domainEvents,
  eventOutbox,
  items,
  runs,
  sessionThreads,
  workSessions,
} from '../src/db/schema'
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

test('event outbox worker dispatches root run events to Langfuse when observability is configured', async () => {
  const originalFetch = globalThis.fetch
  const fetchCalls: Array<{
    bodyByteLength: number
    bodyText: string | null
    headers: Record<string, string>
    url: string
  }> = []
  const normalizeHeaders = (headers: RequestInit['headers']): Record<string, string> => {
    if (!headers) {
      return {}
    }

    if (headers instanceof Headers) {
      return Object.fromEntries(
        [...headers.entries()].map(([key, value]) => [key.toLowerCase(), value]),
      )
    }

    if (Array.isArray(headers)) {
      return Object.fromEntries(headers.map(([key, value]) => [key.toLowerCase(), value]))
    }

    return Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]),
    )
  }

  const normalizeBody = (
    body: RequestInit['body'],
  ): {
    bodyByteLength: number
    bodyText: string | null
  } => {
    if (typeof body === 'string') {
      return {
        bodyByteLength: Buffer.byteLength(body),
        bodyText: body,
      }
    }

    if (body instanceof URLSearchParams) {
      const text = body.toString()
      return {
        bodyByteLength: Buffer.byteLength(text),
        bodyText: text,
      }
    }

    if (body instanceof ArrayBuffer) {
      return {
        bodyByteLength: body.byteLength,
        bodyText: null,
      }
    }

    if (ArrayBuffer.isView(body)) {
      return {
        bodyByteLength: body.byteLength,
        bodyText: null,
      }
    }

    return {
      bodyByteLength: 0,
      bodyText: null,
    }
  }

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit) => {
      const headers = normalizeHeaders(init?.headers)
      const body = normalizeBody(init?.body)

      fetchCalls.push({
        bodyByteLength: body.bodyByteLength,
        bodyText: body.bodyText,
        headers,
        url:
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      })

      return new Response(JSON.stringify({ id: 'scr_test' }), {
        headers: {
          'content-type': 'application/json',
        },
        status: 200,
      })
    },
    writable: true,
  })

  try {
    const { runtime } = createManagedHarness({
      AUTH_MODE: 'api_key',
      LANGFUSE_BASE_URL: 'https://langfuse.local',
      LANGFUSE_PUBLIC_KEY: 'pk_test',
      LANGFUSE_SECRET_KEY: 'sk_test',
      NODE_ENV: 'test',
    })
    const { accountId, assistantToolProfileId, tenantId } = seedApiKeyAuth(runtime)
    const eventStore = createEventStore(runtime.db)
    const sessionId = 'ses_langfuse_outbox'
    const threadId = 'thr_langfuse_outbox'
    const runId = 'run_langfuse_outbox'
    const startedAt = '2026-04-02T09:19:04.971Z'
    const completedAt = '2026-04-02T09:19:06.571Z'
    const outputText = 'Alice completed the exported root run.'
    const usage = {
      inputTokens: 21,
      outputTokens: 8,
      total: 29,
      totalTokens: 29,
    }

    runtime.db
      .insert(workSessions)
      .values({
        archivedAt: null,
        createdAt: startedAt,
        createdByAccountId: accountId,
        deletedAt: null,
        id: sessionId,
        metadata: null,
        rootRunId: null,
        status: 'active',
        tenantId,
        title: 'Langfuse Export Session',
        updatedAt: completedAt,
        workspaceId: null,
        workspaceRef: null,
      })
      .run()

    runtime.db
      .insert(sessionThreads)
      .values({
        branchFromMessageId: null,
        branchFromSequence: null,
        createdAt: startedAt,
        createdByAccountId: accountId,
        id: threadId,
        parentThreadId: null,
        sessionId,
        status: 'active',
        tenantId,
        title: 'Langfuse Export Thread',
        titleSource: 'user',
        updatedAt: completedAt,
      })
      .run()

    runtime.db
      .insert(runs)
      .values({
        actorAccountId: accountId,
        agentId: null,
        agentRevisionId: null,
        completedAt,
        configSnapshot: {},
        createdAt: startedAt,
        errorJson: null,
        id: runId,
        jobId: null,
        lastProgressAt: completedAt,
        parentRunId: null,
        resultJson: {
          model: 'gpt-5.4-2026-03-05',
          outputText,
          provider: 'openai',
          responseId: 'resp_langfuse_outbox',
          usage,
        },
        rootRunId: runId,
        sessionId,
        sourceCallId: null,
        startedAt,
        status: 'completed',
        targetKind: 'agent',
        task: 'Export this completed run to Langfuse.',
        tenantId,
        threadId,
        toolProfileId: assistantToolProfileId,
        turnCount: 1,
        updatedAt: completedAt,
        version: 3,
        workspaceId: null,
        workspaceRef: null,
      })
      .run()

    runtime.db
      .update(workSessions)
      .set({
        rootRunId: runId,
      })
      .where(eq(workSessions.id, sessionId))
      .run()

    const basePayload = {
      rootRunId: runId,
      runId,
      sessionId,
      threadId,
    }

    const runCreated = eventStore.append({
      actorAccountId: accountId,
      aggregateId: runId,
      aggregateType: 'run',
      payload: {
        ...basePayload,
        agentName: 'Alice',
        status: 'pending',
        targetKind: 'agent',
        task: 'Export this completed run to Langfuse.',
      },
      tenantId,
      type: 'run.created',
    })

    const generationStarted = eventStore.append({
      actorAccountId: accountId,
      aggregateId: runId,
      aggregateType: 'run',
      payload: {
        ...basePayload,
        inputMessages: [
          {
            content: 'You are Alice. Reply briefly and helpfully.',
            role: 'system',
          },
          {
            content: 'Export this completed run to Langfuse.',
            role: 'user',
          },
        ],
        modelParameters: {
          maxOutputTokens: 400,
          temperature: 0.2,
        },
        provider: 'openai',
        requestedModel: 'gpt-5.4',
        startedAt,
        status: 'running',
        turn: 1,
      },
      tenantId,
      type: 'generation.started',
    })

    const reasoningDone = eventStore.append({
      actorAccountId: accountId,
      aggregateId: runId,
      aggregateType: 'run',
      payload: {
        ...basePayload,
        itemId: 'rsn_langfuse_outbox',
        text: 'Reasoning summary for export verification.',
        turn: 1,
      },
      tenantId,
      type: 'reasoning.summary.done',
    })

    const toolCalled = eventStore.append({
      actorAccountId: accountId,
      aggregateId: 'call_langfuse_outbox',
      aggregateType: 'tool_execution',
      payload: {
        ...basePayload,
        args: {
          q: 'langfuse exporter verification',
        },
        callId: 'call_langfuse_outbox',
        tool: 'web__search',
        turn: 1,
      },
      tenantId,
      type: 'tool.called',
    })

    const toolCompleted = eventStore.append({
      actorAccountId: accountId,
      aggregateId: 'call_langfuse_outbox',
      aggregateType: 'tool_execution',
      payload: {
        ...basePayload,
        callId: 'call_langfuse_outbox',
        outcome: {
          hits: 3,
        },
        tool: 'web__search',
        turn: 1,
      },
      tenantId,
      type: 'tool.completed',
    })

    const generationCompleted = eventStore.append({
      actorAccountId: accountId,
      aggregateId: runId,
      aggregateType: 'run',
      payload: {
        ...basePayload,
        model: 'gpt-5.4-2026-03-05',
        outputItemCount: 1,
        outputText,
        provider: 'openai',
        responseId: 'resp_langfuse_outbox',
        startedAt,
        status: 'completed',
        toolCallCount: 0,
        turn: 1,
        usage,
      },
      tenantId,
      type: 'generation.completed',
    })

    const runCompleted = eventStore.append({
      actorAccountId: accountId,
      aggregateId: runId,
      aggregateType: 'run',
      payload: {
        ...basePayload,
        assistantMessageId: 'msg_langfuse_outbox',
        model: 'gpt-5.4-2026-03-05',
        outputText,
        provider: 'openai',
        responseId: 'resp_langfuse_outbox',
        status: 'completed',
        usage,
      },
      tenantId,
      type: 'run.completed',
    })

    assert.equal(runCreated.ok, true)
    assert.equal(generationStarted.ok, true)
    assert.equal(reasoningDone.ok, true)
    assert.equal(toolCalled.ok, true)
    assert.equal(toolCompleted.ok, true)
    assert.equal(generationCompleted.ok, true)
    assert.equal(runCompleted.ok, true)

    await runtime.services.observability.worker.processOnce()

    assert.equal(fetchCalls.length > 0, true)
    assert.equal(
      fetchCalls.some((call) => call.url === 'https://langfuse.local/api/public/scores'),
      true,
    )
    const scoreBodies = fetchCalls
      .filter((call) => call.url === 'https://langfuse.local/api/public/scores')
      .flatMap((call) => {
        if (!call.bodyText) {
          return []
        }

        return [JSON.parse(call.bodyText) as Record<string, unknown>]
      })
    const toolScore = scoreBodies.find((body) => body.name === 'tool.success')

    assert.ok(toolScore)
    assert.equal(typeof toolScore?.traceId, 'string')
    assert.equal(
      fetchCalls.some((call) => call.url === 'https://langfuse.local/api/public/ingestion'),
      false,
    )
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
      writable: true,
    })
  }
}, 30_000)

