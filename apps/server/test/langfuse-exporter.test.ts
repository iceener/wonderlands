import assert from 'node:assert/strict'
import { LangfuseOtelSpanAttributes } from '@langfuse/core'
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'

import { createLangfuseExporter } from '../src/adapters/observability/langfuse/exporter'
import { createEventStore } from '../src/application/commands/event-store'
import { domainEvents, runs, sessionThreads, workSessions } from '../src/db/schema'
import { asAccountId, asEventId, asTenantId } from '../src/shared/ids'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const readJsonAttribute = (value: unknown) => JSON.parse(String(value))

const readStringArrayAttribute = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry))
  }

  return JSON.parse(String(value))
}

const readAttributeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => readAttributeValue(entry))
  }

  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()

  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return value
    }
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed)
  }

  return value
}

const readObservationMetadata = (
  attributes: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  const prefix = `${LangfuseOtelSpanAttributes.OBSERVATION_METADATA}.`

  return Object.fromEntries(
    Object.entries(attributes ?? {})
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), readAttributeValue(value)]),
  )
}

const installLangfuseFetchMock = () => {
  const originalFetch = globalThis.fetch
  const fetchCalls: string[] = []

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: string | URL | Request) => {
      fetchCalls.push(
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      )

      return new Response(JSON.stringify({ id: 'scr_test' }), {
        headers: {
          'content-type': 'application/json',
        },
        status: 200,
      })
    },
    writable: true,
  })

  return {
    fetchCalls,
    restore() {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: originalFetch,
        writable: true,
      })
    },
  }
}

test('langfuse exporter emits OTEL agent, generation, and event observations for a completed root run', async () => {
  const { fetchCalls, restore } = installLangfuseFetchMock()

  try {
    const { runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { accountId, assistantToolProfileId, tenantId } = seedApiKeyAuth(runtime)
    const eventStore = createEventStore(runtime.db)
    const sessionId = 'ses_langfuse_exporter'
    const threadId = 'thr_langfuse_exporter'
    const runId = 'run_langfuse_exporter'
    const startedAt = '2026-04-02T09:19:04.971Z'
    const completedAt = '2026-04-02T09:19:06.571Z'
    const outputText = 'Alice completed the exporter verification run.'
    const usage = {
      cachedTokens: 5,
      inputTokens: 34,
      completion_tokens: 13,
      prompt_tokens_details: {
        audio_tokens: 2,
      },
      reasoningTokens: 3,
      someOtherTokenCount: 9,
      totalTokens: 47,
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
        title: 'Langfuse Exporter Session',
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
        title: 'Langfuse Exporter Thread',
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
        configSnapshot: {
          apiBasePath: '/api',
          model: null,
          modelAlias: 'gpt-5.4',
          provider: 'openai',
          reasoning: {
            effort: 'medium',
          },
          version: 'v1',
        },
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
          responseId: 'resp_langfuse_exporter',
          usage,
        },
        rootRunId: runId,
        sessionId,
        sourceCallId: null,
        startedAt,
        status: 'completed',
        targetKind: 'agent',
        task: 'Export this run through the Langfuse SDK.',
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
        task: 'Export this run through the Langfuse SDK.',
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
            content: [{ text: 'You are Alice. Reply briefly and helpfully.', type: 'text' }],
            role: 'system',
          },
          {
            content: [
              { text: 'Export this run through the Langfuse SDK.', type: 'text' },
              {
                detail: 'high',
                type: 'image_url',
                url: 'https://example.com/reference.png',
              },
            ],
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

    const webSearchProgress = eventStore.append({
      actorAccountId: accountId,
      aggregateId: runId,
      aggregateType: 'run',
      payload: {
        ...basePayload,
        patterns: ['langfuse exporter'],
        provider: 'openai',
        queries: ['langfuse tracing observation types'],
        references: [
          {
            domain: 'langfuse.com',
            title: 'Observation Types',
            url: 'https://langfuse.com/docs/observability/features/observation-types',
          },
        ],
        responseId: 'resp_langfuse_exporter',
        searchId: 'search_langfuse_exporter',
        status: 'completed',
        targetUrls: [],
        turn: 1,
      },
      tenantId,
      type: 'web_search.progress',
    })

    const reasoningDone = eventStore.append({
      actorAccountId: accountId,
      aggregateId: runId,
      aggregateType: 'run',
      payload: {
        ...basePayload,
        itemId: 'rsn_langfuse_exporter',
        text: 'Reasoning summary for OTEL exporter verification.',
        turn: 1,
      },
      tenantId,
      type: 'reasoning.summary.done',
    })

    const generationCompleted = eventStore.append({
      actorAccountId: accountId,
      aggregateId: runId,
      aggregateType: 'run',
      payload: {
        ...basePayload,
        model: 'gpt-5.4-2026-03-05',
        outputItemCount: 1,
        outputMessages: [
          {
            content: [{ text: outputText, type: 'text' }],
            phase: 'final_answer',
            providerMessageId: 'msg_langfuse_exporter',
            role: 'assistant',
          },
        ],
        outputText,
        provider: 'openai',
        providerRequestId: 'req_langfuse_exporter',
        responseId: 'resp_langfuse_exporter',
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
        assistantMessageId: 'msg_langfuse_exporter',
        model: 'gpt-5.4-2026-03-05',
        outputText,
        provider: 'openai',
        responseId: 'resp_langfuse_exporter',
        status: 'completed',
        usage,
      },
      tenantId,
      type: 'run.completed',
    })

    assert.equal(runCreated.ok, true)
    assert.equal(generationStarted.ok, true)
    assert.equal(webSearchProgress.ok, true)
    assert.equal(reasoningDone.ok, true)
    assert.equal(generationCompleted.ok, true)
    assert.equal(runCompleted.ok, true)

    if (!runCompleted.ok) {
      throw new Error(runCompleted.error.message)
    }

    const eventRow = runtime.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.id, runCompleted.value.id))
      .get()

    assert.ok(eventRow)

    const spanExporter = new InMemorySpanExporter()
    const exporter = createLangfuseExporter({
      config: {
        baseUrl: 'https://langfuse.local',
        enabled: true,
        environment: 'test',
        publicKey: 'pk_test',
        secretKey: 'sk_test',
        timeoutMs: 1_000,
      },
      db: runtime.db,
      logger: runtime.services.logger,
      spanExporter,
    })

    const result = await exporter.exportOutboxEntry({
      attempts: 0,
      availableAt: startedAt,
      createdAt: startedAt,
      event: {
        actorAccountId: eventRow?.actorAccountId ? asAccountId(eventRow.actorAccountId) : undefined,
        aggregateId: eventRow?.aggregateId ?? runId,
        aggregateType: eventRow?.aggregateType ?? 'run',
        category: eventRow?.category ?? 'domain',
        causationId: eventRow?.causationId ?? undefined,
        createdAt: eventRow?.createdAt ?? completedAt,
        eventNo: eventRow?.eventNo ?? 0,
        id: asEventId(eventRow?.id ?? runCompleted.value.id),
        payload: eventRow?.payload ?? runCompleted.value.payload,
        tenantId: eventRow?.tenantId ? asTenantId(eventRow.tenantId) : undefined,
        traceId: eventRow?.traceId ?? undefined,
        type: eventRow?.type ?? 'run.completed',
      },
      eventId: asEventId(runCompleted.value.id),
      id: 'obx_langfuse_exporter',
      lastError: null,
      processedAt: null,
      status: 'pending',
      tenantId: asTenantId(tenantId),
      topic: 'observability',
    })

    assert.equal(result.ok, true)

    const spans = spanExporter.getFinishedSpans()
    const rootAgent = spans.find((span) => span.name === 'Alice')
    const generation = spans.find((span) => span.name === 'turn-1')
    const reasoning = spans.find((span) => span.name === 'reasoning')
    const webSearch = spans.find((span) => span.name === 'web_search')

    assert.ok(rootAgent)
    assert.ok(generation)
    assert.ok(reasoning)
    assert.ok(webSearch)
    assert.equal(rootAgent?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE], 'agent')
    assert.equal(generation?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE], 'generation')
    assert.equal(reasoning?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE], 'event')
    assert.equal(webSearch?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE], 'retriever')
    assert.equal(generation?.parentSpanContext?.spanId, rootAgent?.spanContext().spanId)
    assert.equal(reasoning?.parentSpanContext?.spanId, generation?.spanContext().spanId)
    assert.equal(webSearch?.parentSpanContext?.spanId, generation?.spanContext().spanId)
    assert.deepEqual(
      readJsonAttribute(generation?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_INPUT]),
      [
        {
          content: [{ text: 'You are Alice. Reply briefly and helpfully.', type: 'text' }],
          role: 'system',
        },
        {
          content: [
            { text: 'Export this run through the Langfuse SDK.', type: 'text' },
            {
              image_url: {
                detail: 'high',
                url: 'https://example.com/reference.png',
              },
              type: 'image_url',
            },
          ],
          role: 'user',
        },
      ],
    )
    assert.deepEqual(
      readJsonAttribute(generation?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_OUTPUT]),
      [
        {
          content: [{ text: outputText, type: 'text' }],
          phase: 'final_answer',
          providerMessageId: 'msg_langfuse_exporter',
          role: 'assistant',
        },
      ],
    )
    assert.deepEqual(
      readJsonAttribute(
        generation?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_MODEL_PARAMETERS],
      ),
      {
        maxOutputTokens: 400,
        temperature: 0.2,
      },
    )
    assert.deepEqual(
      readJsonAttribute(
        generation?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_USAGE_DETAILS],
      ),
      {
        input: 34,
        input_audio_tokens: 2,
        input_cached_tokens: 5,
        output: 13,
        output_reasoning_tokens: 3,
        some_other_token_count: 9,
        total: 47,
      },
    )
    assert.equal(
      rootAgent?.attributes[LangfuseOtelSpanAttributes.TRACE_NAME],
      'Alice: Export this run through the Langfuse SDK.',
    )
    assert.deepEqual(
      readStringArrayAttribute(rootAgent?.attributes[LangfuseOtelSpanAttributes.TRACE_TAGS]),
      [
        '05_04_api',
        'target:agent',
        'status:completed',
        'provider:openai',
        'model:gpt-5.4-2026-03-05',
      ],
    )
    const rootMetadata = readObservationMetadata(rootAgent?.attributes)
    assert.equal(rootMetadata.agentName, 'Alice')
    assert.equal(rootMetadata.actorAccountId, accountId)
    assert.equal(rootMetadata.tenantId, tenantId)
    assert.equal(rootMetadata.rootRunId, runId)
    assert.equal(rootMetadata.runId, runId)
    assert.equal(rootMetadata.sessionId, sessionId)
    assert.equal(rootMetadata.threadId, threadId)
    assert.equal(rootMetadata.toolProfileId, assistantToolProfileId)
    assert.equal(rootMetadata.runtimeApiBasePath, '/api')
    assert.equal(rootMetadata.runtimeModelAlias, 'gpt-5.4')
    assert.equal(rootMetadata.runtimeProvider, 'openai')
    assert.equal(rootMetadata.runtimeReasoningEffort, 'medium')
    assert.equal(rootMetadata.runtimeVersion, 'v1')
    assert.equal(rootMetadata.assistantMessageId, 'msg_langfuse_exporter')
    assert.equal(rootMetadata.provider, 'openai')
    assert.equal(rootMetadata.responseId, 'resp_langfuse_exporter')
    assert.equal(rootMetadata.model, 'gpt-5.4-2026-03-05')
    assert.equal(typeof rootMetadata.observationId, 'string')
    assert.equal(typeof rootMetadata.traceId, 'string')
    assert.equal(
      fetchCalls.some((url) => url === 'https://langfuse.local/api/public/scores'),
      true,
    )

    await exporter.shutdown()
  } finally {
    restore()
  }
})

test('langfuse exporter maps tool calls and delegated child runs into explicit taxonomy stages', async () => {
  const { restore } = installLangfuseFetchMock()

  try {
    const { runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { accountId, assistantToolProfileId, tenantId } = seedApiKeyAuth(runtime)
    const eventStore = createEventStore(runtime.db)
    const sessionId = 'ses_langfuse_taxonomy'
    const threadId = 'thr_langfuse_taxonomy'
    const rootRunId = 'run_langfuse_taxonomy_root'
    const childRunId = 'run_langfuse_taxonomy_child'
    const callId = 'call_langfuse_taxonomy_delegate'
    const rootStartedAt = '2026-04-02T10:00:00.000Z'
    const childStartedAt = '2026-04-02T10:00:01.100Z'
    const childCompletedAt = '2026-04-02T10:00:02.250Z'
    const rootCompletedAt = '2026-04-02T10:00:03.500Z'
    const childTask = 'Research the Langfuse observation taxonomy.'
    const childOutputText = 'Researcher mapped the observation taxonomy.'
    const rootOutputText = 'Alice used the delegated research to confirm the taxonomy mapping.'
    const rootUsage = {
      cachedTokens: 2,
      inputTokens: 31,
      outputTokens: 11,
      totalTokens: 44,
    }

    runtime.db
      .insert(workSessions)
      .values({
        archivedAt: null,
        createdAt: rootStartedAt,
        createdByAccountId: accountId,
        deletedAt: null,
        id: sessionId,
        metadata: null,
        rootRunId: null,
        status: 'active',
        tenantId,
        title: 'Langfuse Taxonomy Session',
        updatedAt: rootCompletedAt,
        workspaceId: null,
        workspaceRef: null,
      })
      .run()

    runtime.db
      .insert(sessionThreads)
      .values({
        branchFromMessageId: null,
        branchFromSequence: null,
        createdAt: rootStartedAt,
        createdByAccountId: accountId,
        id: threadId,
        parentThreadId: null,
        sessionId,
        status: 'active',
        tenantId,
        title: 'Langfuse Taxonomy Thread',
        titleSource: 'user',
        updatedAt: rootCompletedAt,
      })
      .run()

    runtime.db
      .insert(runs)
      .values([
        {
          actorAccountId: accountId,
          agentId: null,
          agentRevisionId: null,
          completedAt: rootCompletedAt,
          configSnapshot: {
            apiBasePath: '/api',
            model: null,
            modelAlias: 'gpt-5.4',
            provider: 'openai',
            reasoning: {
              effort: 'high',
            },
            version: 'v1',
          },
          createdAt: rootStartedAt,
          errorJson: null,
          id: rootRunId,
          jobId: null,
          lastProgressAt: rootCompletedAt,
          parentRunId: null,
          resultJson: {
            model: 'gpt-5.4-2026-03-05',
            outputText: rootOutputText,
            provider: 'openai',
            responseId: 'resp_langfuse_taxonomy_root',
            usage: rootUsage,
          },
          rootRunId,
          sessionId,
          sourceCallId: null,
          startedAt: rootStartedAt,
          status: 'completed',
          targetKind: 'agent',
          task: 'Verify the Langfuse observation taxonomy.',
          tenantId,
          threadId,
          toolProfileId: assistantToolProfileId,
          turnCount: 1,
          updatedAt: rootCompletedAt,
          version: 4,
          workspaceId: null,
          workspaceRef: null,
        },
        {
          actorAccountId: accountId,
          agentId: null,
          agentRevisionId: null,
          completedAt: childCompletedAt,
          configSnapshot: {
            model: 'gpt-5.4-2026-03-05',
            modelAlias: 'gpt-5.4',
            provider: 'openai',
            reasoning: {
              effort: 'medium',
            },
            version: 'v1',
          },
          createdAt: childStartedAt,
          errorJson: null,
          id: childRunId,
          jobId: null,
          lastProgressAt: childCompletedAt,
          parentRunId: rootRunId,
          resultJson: {
            outputText: childOutputText,
          },
          rootRunId,
          sessionId,
          sourceCallId: callId,
          startedAt: childStartedAt,
          status: 'completed',
          targetKind: 'agent',
          task: childTask,
          tenantId,
          threadId,
          toolProfileId: assistantToolProfileId,
          turnCount: 0,
          updatedAt: childCompletedAt,
          version: 2,
          workspaceId: null,
          workspaceRef: null,
        },
      ])
      .run()

    runtime.db
      .update(workSessions)
      .set({
        rootRunId,
      })
      .where(eq(workSessions.id, sessionId))
      .run()

    const rootPayload = {
      rootRunId,
      runId: rootRunId,
      sessionId,
      threadId,
    }

    const childPayload = {
      parentRunId: rootRunId,
      rootRunId,
      runId: childRunId,
      sessionId,
      sourceCallId: callId,
      threadId,
    }

    const rootRunCreated = eventStore.append({
      actorAccountId: accountId,
      aggregateId: rootRunId,
      aggregateType: 'run',
      payload: {
        ...rootPayload,
        agentName: 'Alice',
        status: 'pending',
        targetKind: 'agent',
        task: 'Verify the Langfuse observation taxonomy.',
      },
      tenantId,
      type: 'run.created',
    })

    const generationStarted = eventStore.append({
      actorAccountId: accountId,
      aggregateId: rootRunId,
      aggregateType: 'run',
      payload: {
        ...rootPayload,
        inputMessages: [
          {
            content: [
              { text: 'You are Alice. Delegate focused research when useful.', type: 'text' },
            ],
            role: 'system',
          },
          {
            content: [{ text: 'Verify the Langfuse observation taxonomy.', type: 'text' }],
            role: 'user',
          },
        ],
        tools: [
          {
            description: 'Create a private delegated child run.',
            kind: 'function',
            name: 'spawn_agent',
            parameters: {
              additionalProperties: false,
              properties: {
                task: {
                  type: 'string',
                },
              },
              required: ['task'],
              type: 'object',
            },
            strict: true,
            type: 'function',
          },
        ],
        provider: 'openai',
        requestedModel: 'gpt-5.4',
        startedAt: rootStartedAt,
        status: 'running',
        turn: 1,
      },
      tenantId,
      type: 'generation.started',
    })

    const toolCalled = eventStore.append({
      actorAccountId: accountId,
      aggregateId: callId,
      aggregateType: 'tool_execution',
      payload: {
        ...rootPayload,
        args: {
          task: childTask,
        },
        callId,
        tool: 'spawn_agent',
        turn: 1,
      },
      tenantId,
      type: 'tool.called',
    })

    const childRunCreated = eventStore.append({
      actorAccountId: accountId,
      aggregateId: childRunId,
      aggregateType: 'run',
      payload: {
        ...childPayload,
        agentAlias: 'researcher',
        agentId: 'agt_researcher',
        agentName: 'Researcher',
        agentRevisionId: 'agr_researcher_1',
        status: 'pending',
        targetKind: 'agent',
        task: childTask,
      },
      tenantId,
      type: 'run.created',
    })

    const childRunCompleted = eventStore.append({
      actorAccountId: accountId,
      aggregateId: childRunId,
      aggregateType: 'run',
      payload: {
        ...childPayload,
        model: 'gpt-5.4-2026-03-05',
        outputText: childOutputText,
        provider: 'openai',
        responseId: 'resp_langfuse_taxonomy_child',
        status: 'completed',
      },
      tenantId,
      type: 'run.completed',
    })

    const toolCompleted = eventStore.append({
      actorAccountId: accountId,
      aggregateId: callId,
      aggregateType: 'tool_execution',
      payload: {
        ...rootPayload,
        callId,
        outcome: {
          childRunId,
          status: 'completed',
        },
        tool: 'spawn_agent',
        turn: 1,
      },
      tenantId,
      type: 'tool.completed',
    })

    const generationCompleted = eventStore.append({
      actorAccountId: accountId,
      aggregateId: rootRunId,
      aggregateType: 'run',
      payload: {
        ...rootPayload,
        model: 'gpt-5.4-2026-03-05',
        outputItems: [
          {
            arguments: {
              task: childTask,
            },
            argumentsJson: JSON.stringify({
              task: childTask,
            }),
            callId,
            name: 'spawn_agent',
            type: 'function_call',
          },
        ],
        outputMessages: [
          {
            content: [{ text: rootOutputText, type: 'text' }],
            phase: 'final_answer',
            role: 'assistant',
          },
        ],
        outputText: rootOutputText,
        provider: 'openai',
        providerRequestId: 'req_langfuse_taxonomy_root',
        responseId: 'resp_langfuse_taxonomy_root',
        startedAt: rootStartedAt,
        status: 'completed',
        toolCalls: [
          {
            arguments: {
              task: childTask,
            },
            argumentsJson: JSON.stringify({
              task: childTask,
            }),
            callId,
            name: 'spawn_agent',
          },
        ],
        toolCallCount: 1,
        turn: 1,
        usage: rootUsage,
      },
      tenantId,
      type: 'generation.completed',
    })

    const rootRunCompleted = eventStore.append({
      actorAccountId: accountId,
      aggregateId: rootRunId,
      aggregateType: 'run',
      payload: {
        ...rootPayload,
        assistantMessageId: 'msg_langfuse_taxonomy_root',
        model: 'gpt-5.4-2026-03-05',
        outputText: rootOutputText,
        provider: 'openai',
        responseId: 'resp_langfuse_taxonomy_root',
        status: 'completed',
        usage: rootUsage,
      },
      tenantId,
      type: 'run.completed',
    })

    assert.equal(rootRunCreated.ok, true)
    assert.equal(generationStarted.ok, true)
    assert.equal(toolCalled.ok, true)
    assert.equal(childRunCreated.ok, true)
    assert.equal(childRunCompleted.ok, true)
    assert.equal(toolCompleted.ok, true)
    assert.equal(generationCompleted.ok, true)
    assert.equal(rootRunCompleted.ok, true)

    if (!rootRunCompleted.ok) {
      throw new Error(rootRunCompleted.error.message)
    }

    const eventRow = runtime.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.id, rootRunCompleted.value.id))
      .get()

    assert.ok(eventRow)

    const spanExporter = new InMemorySpanExporter()
    const exporter = createLangfuseExporter({
      config: {
        baseUrl: 'https://langfuse.local',
        enabled: true,
        environment: 'test',
        publicKey: 'pk_test',
        secretKey: 'sk_test',
        timeoutMs: 1_000,
      },
      db: runtime.db,
      logger: runtime.services.logger,
      spanExporter,
    })

    const result = await exporter.exportOutboxEntry({
      attempts: 0,
      availableAt: rootStartedAt,
      createdAt: rootStartedAt,
      event: {
        actorAccountId: eventRow?.actorAccountId ? asAccountId(eventRow.actorAccountId) : undefined,
        aggregateId: eventRow?.aggregateId ?? rootRunId,
        aggregateType: eventRow?.aggregateType ?? 'run',
        category: eventRow?.category ?? 'domain',
        causationId: eventRow?.causationId ?? undefined,
        createdAt: eventRow?.createdAt ?? rootCompletedAt,
        eventNo: eventRow?.eventNo ?? 0,
        id: asEventId(eventRow?.id ?? rootRunCompleted.value.id),
        payload: eventRow?.payload ?? rootRunCompleted.value.payload,
        tenantId: eventRow?.tenantId ? asTenantId(eventRow.tenantId) : undefined,
        traceId: eventRow?.traceId ?? undefined,
        type: eventRow?.type ?? 'run.completed',
      },
      eventId: asEventId(rootRunCompleted.value.id),
      id: 'obx_langfuse_taxonomy',
      lastError: null,
      processedAt: null,
      status: 'pending',
      tenantId: asTenantId(tenantId),
      topic: 'observability',
    })

    assert.equal(result.ok, true)

    const spans = spanExporter.getFinishedSpans()
    const rootAgent = spans.find((span) => span.name === 'Alice')
    const generation = spans.find((span) => span.name === 'turn-1')
    const tool = spans.find((span) => span.name === 'spawn_agent')
    const childAgent = spans.find((span) => span.name === 'Researcher')

    assert.ok(rootAgent)
    assert.ok(generation)
    assert.ok(tool)
    assert.ok(childAgent)
    assert.equal(rootAgent?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE], 'agent')
    assert.equal(generation?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE], 'generation')
    assert.equal(tool?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE], 'tool')
    assert.equal(childAgent?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE], 'agent')
    assert.equal(generation?.parentSpanContext?.spanId, rootAgent?.spanContext().spanId)
    assert.equal(tool?.parentSpanContext?.spanId, generation?.spanContext().spanId)
    assert.equal(childAgent?.parentSpanContext?.spanId, tool?.spanContext().spanId)
    assert.deepEqual(
      readJsonAttribute(generation?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_INPUT]),
      {
        messages: [
          {
            content: [
              { text: 'You are Alice. Delegate focused research when useful.', type: 'text' },
            ],
            role: 'system',
          },
          {
            content: [{ text: 'Verify the Langfuse observation taxonomy.', type: 'text' }],
            role: 'user',
          },
        ],
        provider: 'openai',
        requestedModel: 'gpt-5.4',
        tools: [
          {
            description: 'Create a private delegated child run.',
            kind: 'function',
            name: 'spawn_agent',
            parameters: {
              additionalProperties: false,
              properties: {
                task: {
                  type: 'string',
                },
              },
              required: ['task'],
              type: 'object',
            },
            strict: true,
            type: 'function',
          },
        ],
      },
    )
    assert.deepEqual(
      readJsonAttribute(generation?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_OUTPUT]),
      [
        {
          arguments: {
            task: childTask,
          },
          argumentsJson: JSON.stringify({
            task: childTask,
          }),
          callId,
          name: 'spawn_agent',
          type: 'function_call',
        },
      ],
    )
    assert.deepEqual(
      readJsonAttribute(tool?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_INPUT]),
      {
        task: childTask,
      },
    )
    assert.deepEqual(
      readJsonAttribute(tool?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_OUTPUT]),
      {
        childRunId,
        status: 'completed',
      },
    )
    const generationMetadata = readObservationMetadata(generation?.attributes)
    assert.equal(generationMetadata.agentName, 'Alice')
    assert.equal(generationMetadata.tenantId, tenantId)
    assert.equal(generationMetadata.runId, rootRunId)
    assert.equal(generationMetadata.rootRunId, rootRunId)
    assert.equal(generationMetadata.sessionId, sessionId)
    assert.equal(generationMetadata.targetKind, 'agent')
    assert.equal(generationMetadata.toolProfileId, assistantToolProfileId)
    assert.equal(generationMetadata.runtimeApiBasePath, '/api')
    assert.equal(generationMetadata.runtimeModelAlias, 'gpt-5.4')
    assert.equal(generationMetadata.runtimeProvider, 'openai')
    assert.equal(generationMetadata.runtimeReasoningEffort, 'high')
    assert.equal(generationMetadata.runtimeVersion, 'v1')
    assert.equal(generationMetadata.providerRequestId, 'req_langfuse_taxonomy_root')
    assert.equal(generationMetadata.responseId, 'resp_langfuse_taxonomy_root')
    assert.deepEqual(generationMetadata.toolNames, ['spawn_agent'])
    assert.deepEqual(generationMetadata.toolCallIds, [callId])
    assert.deepEqual(generationMetadata.toolStatuses, ['completed'])
    assert.deepEqual(generationMetadata.delegatedChildRunIds, [childRunId])
    assert.ok(Array.isArray(generationMetadata.delegatedChildObservationIds))
    assert.ok(Array.isArray(generationMetadata.delegatedChildTraceIds))
    assert.deepEqual(generationMetadata.delegatedChildAgentNames, ['Researcher'])
    assert.deepEqual(generationMetadata.delegatedChildAgentAliases, ['researcher'])
    assert.deepEqual(generationMetadata.delegatedChildAgentIds, ['agt_researcher'])
    assert.deepEqual(generationMetadata.delegatedChildAgentRevisionIds, ['agr_researcher_1'])
    assert.deepEqual(generationMetadata.toolSummaries, [
      `spawn_agent #${callId} completed child:Researcher`,
    ])
    assert.equal(
      generationMetadata.toolSummary,
      `spawn_agent #${callId} completed child:Researcher`,
    )
    assert.equal(generationMetadata.delegationSummary, 'Researcher')
    assert.ok(Array.isArray(generationMetadata.toolObservationIds))
    const toolMetadata = readObservationMetadata(tool?.attributes)
    assert.equal(toolMetadata.callId, callId)
    assert.equal(toolMetadata.runId, rootRunId)
    assert.equal(toolMetadata.rootRunId, rootRunId)
    assert.equal(toolMetadata.sessionId, sessionId)
    assert.equal(toolMetadata.threadId, threadId)
    assert.equal(toolMetadata.tool, 'spawn_agent')
    assert.equal(toolMetadata.childRunCount, 1)
    assert.deepEqual(toolMetadata.childRunIds, [childRunId])
    assert.deepEqual(toolMetadata.childAgentNames, ['Researcher'])
    assert.deepEqual(toolMetadata.childAgentAliases, ['researcher'])
    assert.deepEqual(toolMetadata.childAgentIds, ['agt_researcher'])
    assert.deepEqual(toolMetadata.childAgentRevisionIds, ['agr_researcher_1'])
    assert.ok(Array.isArray(toolMetadata.childObservationIds))
    assert.ok(Array.isArray(toolMetadata.childTraceIds))

    await exporter.shutdown()
  } finally {
    restore()
  }
})

test('langfuse exporter marks waiting tools and waiting delegated runs with warning semantics', async () => {
  const { restore } = installLangfuseFetchMock()

  try {
    const { runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { accountId, assistantToolProfileId, tenantId } = seedApiKeyAuth(runtime)
    const eventStore = createEventStore(runtime.db)
    const sessionId = 'ses_langfuse_waiting'
    const threadId = 'thr_langfuse_waiting'
    const rootRunId = 'run_langfuse_waiting_root'
    const childRunId = 'run_langfuse_waiting_child'
    const callId = 'call_langfuse_waiting_human'
    const waitId = 'wte_langfuse_waiting_human'
    const rootStartedAt = '2026-04-02T11:00:00.000Z'
    const childStartedAt = '2026-04-02T11:00:01.000Z'
    const waitingAt = '2026-04-02T11:00:02.000Z'
    const failedAt = '2026-04-02T11:00:03.000Z'
    const childTask = 'Review the release copy before publishing.'
    const confirmationDescription = 'Approve the release copy before publishing.'

    runtime.db
      .insert(workSessions)
      .values({
        archivedAt: null,
        createdAt: rootStartedAt,
        createdByAccountId: accountId,
        deletedAt: null,
        id: sessionId,
        metadata: null,
        rootRunId: null,
        status: 'active',
        tenantId,
        title: 'Langfuse Waiting Session',
        updatedAt: failedAt,
        workspaceId: null,
        workspaceRef: null,
      })
      .run()

    runtime.db
      .insert(sessionThreads)
      .values({
        branchFromMessageId: null,
        branchFromSequence: null,
        createdAt: rootStartedAt,
        createdByAccountId: accountId,
        id: threadId,
        parentThreadId: null,
        sessionId,
        status: 'active',
        tenantId,
        title: 'Langfuse Waiting Thread',
        titleSource: 'user',
        updatedAt: failedAt,
      })
      .run()

    runtime.db
      .insert(runs)
      .values([
        {
          actorAccountId: accountId,
          agentId: null,
          agentRevisionId: null,
          completedAt: failedAt,
          configSnapshot: {},
          createdAt: rootStartedAt,
          errorJson: {
            message: 'Release approval timed out.',
          },
          id: rootRunId,
          jobId: null,
          lastProgressAt: failedAt,
          parentRunId: null,
          resultJson: null,
          rootRunId,
          sessionId,
          sourceCallId: null,
          startedAt: rootStartedAt,
          status: 'failed',
          targetKind: 'agent',
          task: 'Prepare and publish the release copy.',
          tenantId,
          threadId,
          toolProfileId: assistantToolProfileId,
          turnCount: 1,
          updatedAt: failedAt,
          version: 4,
          workspaceId: null,
          workspaceRef: null,
        },
        {
          actorAccountId: accountId,
          agentId: null,
          agentRevisionId: null,
          completedAt: null,
          configSnapshot: {},
          createdAt: childStartedAt,
          errorJson: null,
          id: childRunId,
          jobId: null,
          lastProgressAt: waitingAt,
          parentRunId: rootRunId,
          resultJson: {
            outputText: 'Waiting for human approval.',
          },
          rootRunId,
          sessionId,
          sourceCallId: callId,
          startedAt: childStartedAt,
          status: 'waiting',
          targetKind: 'agent',
          task: childTask,
          tenantId,
          threadId,
          toolProfileId: assistantToolProfileId,
          turnCount: 0,
          updatedAt: waitingAt,
          version: 2,
          workspaceId: null,
          workspaceRef: null,
        },
      ])
      .run()

    runtime.db
      .update(workSessions)
      .set({
        rootRunId,
      })
      .where(eq(workSessions.id, sessionId))
      .run()

    const rootPayload = {
      rootRunId,
      runId: rootRunId,
      sessionId,
      threadId,
    }

    const childPayload = {
      parentRunId: rootRunId,
      rootRunId,
      runId: childRunId,
      sessionId,
      sourceCallId: callId,
      threadId,
    }

    const rootRunCreated = eventStore.append({
      actorAccountId: accountId,
      aggregateId: rootRunId,
      aggregateType: 'run',
      payload: {
        ...rootPayload,
        agentName: 'Alice',
        status: 'pending',
        targetKind: 'agent',
        task: 'Prepare and publish the release copy.',
      },
      tenantId,
      type: 'run.created',
    })

    const generationStarted = eventStore.append({
      actorAccountId: accountId,
      aggregateId: rootRunId,
      aggregateType: 'run',
      payload: {
        ...rootPayload,
        inputMessages: [
          {
            content: [
              {
                text: 'You are Alice. Request explicit human approval before publishing.',
                type: 'text',
              },
            ],
            role: 'system',
          },
          {
            content: [{ text: 'Prepare and publish the release copy.', type: 'text' }],
            role: 'user',
          },
        ],
        provider: 'openai',
        requestedModel: 'gpt-5.4',
        startedAt: rootStartedAt,
        status: 'running',
        turn: 1,
      },
      tenantId,
      type: 'generation.started',
    })

    const toolCalled = eventStore.append({
      actorAccountId: accountId,
      aggregateId: callId,
      aggregateType: 'tool_execution',
      payload: {
        ...rootPayload,
        args: {
          prompt: confirmationDescription,
        },
        callId,
        tool: 'ask_human',
        turn: 1,
      },
      tenantId,
      type: 'tool.called',
    })

    const childRunCreated = eventStore.append({
      actorAccountId: accountId,
      aggregateId: childRunId,
      aggregateType: 'run',
      payload: {
        ...childPayload,
        agentAlias: 'reviewer',
        agentId: 'agt_reviewer',
        agentName: 'Reviewer',
        agentRevisionId: 'agr_reviewer_1',
        status: 'pending',
        targetKind: 'agent',
        task: childTask,
      },
      tenantId,
      type: 'run.created',
    })

    const toolConfirmationRequested = eventStore.append({
      actorAccountId: accountId,
      aggregateId: callId,
      aggregateType: 'tool_execution',
      payload: {
        ...rootPayload,
        args: {
          prompt: confirmationDescription,
        },
        callId,
        description: confirmationDescription,
        tool: 'ask_human',
        turn: 1,
        waitId,
        waitTargetKind: 'human_response',
        waitTargetRef: 'release-copy-approval',
        waitType: 'human',
      },
      tenantId,
      type: 'tool.confirmation_requested',
    })

    const childRunWaiting = eventStore.append({
      actorAccountId: accountId,
      aggregateId: childRunId,
      aggregateType: 'run',
      payload: {
        ...childPayload,
        outputText: 'Waiting for reviewer approval.',
        pendingWaits: [
          {
            description: confirmationDescription,
            targetKind: 'human_response',
            targetRef: 'release-copy-approval',
            type: 'human',
            waitId,
          },
        ],
        waitIds: [waitId],
      },
      tenantId,
      type: 'run.waiting',
    })

    const generationFailed = eventStore.append({
      actorAccountId: accountId,
      aggregateId: rootRunId,
      aggregateType: 'run',
      payload: {
        ...rootPayload,
        error: {
          message: 'Release approval timed out.',
        },
        provider: 'openai',
        startedAt: rootStartedAt,
        turn: 1,
      },
      tenantId,
      type: 'generation.failed',
    })

    const rootRunFailed = eventStore.append({
      actorAccountId: accountId,
      aggregateId: rootRunId,
      aggregateType: 'run',
      payload: {
        ...rootPayload,
        error: {
          message: 'Release approval timed out.',
        },
        outputText: 'Waiting for reviewer approval.',
      },
      tenantId,
      type: 'run.failed',
    })

    assert.equal(rootRunCreated.ok, true)
    assert.equal(generationStarted.ok, true)
    assert.equal(toolCalled.ok, true)
    assert.equal(childRunCreated.ok, true)
    assert.equal(toolConfirmationRequested.ok, true)
    assert.equal(childRunWaiting.ok, true)
    assert.equal(generationFailed.ok, true)
    assert.equal(rootRunFailed.ok, true)

    if (!rootRunFailed.ok) {
      throw new Error(rootRunFailed.error.message)
    }

    const eventRow = runtime.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.id, rootRunFailed.value.id))
      .get()

    assert.ok(eventRow)

    const spanExporter = new InMemorySpanExporter()
    const exporter = createLangfuseExporter({
      config: {
        baseUrl: 'https://langfuse.local',
        enabled: true,
        environment: 'test',
        publicKey: 'pk_test',
        secretKey: 'sk_test',
        timeoutMs: 1_000,
      },
      db: runtime.db,
      logger: runtime.services.logger,
      spanExporter,
    })

    const result = await exporter.exportOutboxEntry({
      attempts: 0,
      availableAt: rootStartedAt,
      createdAt: rootStartedAt,
      event: {
        actorAccountId: eventRow?.actorAccountId ? asAccountId(eventRow.actorAccountId) : undefined,
        aggregateId: eventRow?.aggregateId ?? rootRunId,
        aggregateType: eventRow?.aggregateType ?? 'run',
        category: eventRow?.category ?? 'domain',
        causationId: eventRow?.causationId ?? undefined,
        createdAt: eventRow?.createdAt ?? failedAt,
        eventNo: eventRow?.eventNo ?? 0,
        id: asEventId(eventRow?.id ?? rootRunFailed.value.id),
        payload: eventRow?.payload ?? rootRunFailed.value.payload,
        tenantId: eventRow?.tenantId ? asTenantId(eventRow.tenantId) : undefined,
        traceId: eventRow?.traceId ?? undefined,
        type: eventRow?.type ?? 'run.failed',
      },
      eventId: asEventId(rootRunFailed.value.id),
      id: 'obx_langfuse_waiting',
      lastError: null,
      processedAt: null,
      status: 'pending',
      tenantId: asTenantId(tenantId),
      topic: 'observability',
    })

    assert.equal(result.ok, true)

    const spans = spanExporter.getFinishedSpans()
    const generation = spans.find((span) => span.name === 'turn-1')
    const tool = spans.find((span) => span.name === 'ask_human')
    const childAgent = spans.find((span) => span.name === 'Reviewer')

    assert.ok(generation)
    assert.ok(tool)
    assert.ok(childAgent)
    assert.equal(generation?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_LEVEL], 'ERROR')
    assert.equal(
      generation?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE],
      'Release approval timed out.',
    )
    assert.equal(tool?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_LEVEL], 'WARNING')
    assert.equal(
      tool?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE],
      'tool.confirmation_requested',
    )
    assert.equal(childAgent?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_LEVEL], 'WARNING')
    assert.equal(
      childAgent?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE],
      'run.waiting:1',
    )
    assert.deepEqual(
      readJsonAttribute(tool?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_OUTPUT]),
      {
        description: confirmationDescription,
        waitId,
        waitTargetKind: 'human_response',
        waitTargetRef: 'release-copy-approval',
        waitType: 'human',
      },
    )

    await exporter.shutdown()
  } finally {
    restore()
  }
})
