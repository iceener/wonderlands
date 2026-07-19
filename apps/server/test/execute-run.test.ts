import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'

import { createCancelRunCommand } from '../src/application/commands/cancel-run'
import { createInternalCommandContext } from '../src/application/commands/internal-command-context'
import { executeRunTurnLoop } from '../src/application/runtime/execution/drive-run'
import type { ToolContext } from '../src/application/tooling/tool-registry'
import {
  contextSummaries,
  domainEvents,
  eventOutbox,
  fileLinks,
  files,
  items,
  jobs,
  memoryRecordSources,
  memoryRecords,
  runDependencies,
  runs,
  sessionMessages,
  toolExecutions,
  usageLedger,
} from '../src/db/schema'
import type { AiInteractionRequest, AiInteractionResponse } from '../src/domain/ai/types'
import { createRunRepository } from '../src/adapters/persistence/sqlite/runtime/run-repository'
import { asAccountId, asRunId, asTenantId } from '../src/shared/ids'
import { err, ok } from '../src/shared/result'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'
import { grantNativeToolToDefaultAgent } from './helpers/grant-native-tool-agent'

const bootstrapRun = async (
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

const registerFunctionTool = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    execute: (
      args: unknown,
      context: ToolContext,
    ) => Promise<ReturnType<typeof ok> | ReturnType<typeof err>>
    name: string
  },
) => {
  grantNativeToolToDefaultAgent(runtime, input.name)

  runtime.services.tools.register({
    description: `Test tool ${input.name}`,
    domain: 'native',
    execute: async (context, args) => input.execute(args, context),
    inputSchema: {
      additionalProperties: false,
      properties: {},
      required: [],
      type: 'object',
    },
    name: input.name,
  })
}

const insertChildRun = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    parentRunId: string
    runId: string
    task: string
  },
) => {
  const parentRun = runtime.db
    .select()
    .from(runs)
    .all()
    .find((candidate) => candidate.id === input.parentRunId)

  assert.ok(parentRun)

  if (parentRun.status === 'pending') {
    runtime.db
      .update(runs)
      .set({
        completedAt: '2026-03-29T00:04:59.000Z',
        resultJson: {
          outputText: 'Parent run is already settled for child execution tests.',
        },
        status: 'completed',
        updatedAt: '2026-03-29T00:04:59.000Z',
        version: parentRun.version + 1,
      })
      .where(eq(runs.id, input.parentRunId))
      .run()
  }

  const childWorkItemId = `job_${input.runId}`
  const rootJobId = parentRun.jobId ?? childWorkItemId

  runtime.db
    .insert(jobs)
    .values({
      assignedAgentId: parentRun.agentId,
      assignedAgentRevisionId: parentRun.agentRevisionId,
      completedAt: null,
      createdAt: '2026-03-29T00:05:00.000Z',
      currentRunId: input.runId,
      id: childWorkItemId,
      inputJson: null,
      kind: 'task',
      lastHeartbeatAt: null,
      lastSchedulerSyncAt: null,
      nextSchedulerCheckAt: null,
      parentJobId: parentRun.jobId,
      priority: 100,
      queuedAt: null,
      resultJson: null,
      rootJobId,
      sessionId: parentRun.sessionId,
      statusReasonJson: {
        reason: 'test.child_seed',
        runId: input.runId,
      },
      status: 'blocked',
      tenantId: parentRun.tenantId,
      threadId: parentRun.threadId,
      title: input.task,
      updatedAt: '2026-03-29T00:05:00.000Z',
      version: 1,
    })
    .run()

  runtime.db
    .insert(runs)
    .values({
      actorAccountId: parentRun.actorAccountId,
      agentId: parentRun.agentId,
      agentRevisionId: parentRun.agentRevisionId,
      completedAt: null,
      configSnapshot: {},
      createdAt: '2026-03-29T00:05:00.000Z',
      errorJson: null,
      id: input.runId,
      lastProgressAt: null,
      parentRunId: input.parentRunId,
      resultJson: null,
      rootRunId: parentRun.rootRunId,
      sessionId: parentRun.sessionId,
      sourceCallId: null,
      startedAt: null,
      status: 'pending',
      task: input.task,
      tenantId: parentRun.tenantId,
      targetKind: parentRun.targetKind,
      threadId: null,
      toolProfileId: parentRun.toolProfileId,
      turnCount: 0,
      updatedAt: '2026-03-29T00:05:00.000Z',
      version: 1,
      jobId: childWorkItemId,
      workspaceId: parentRun.workspaceId,
      workspaceRef: parentRun.workspaceRef,
    })
    .run()
}

const waitForAbort = async (signal?: AbortSignal): Promise<string> => {
  if (!signal) {
    return 'Run cancelled'
  }

  if (signal.aborted) {
    return typeof signal.reason === 'string' ? signal.reason : 'Run cancelled'
  }

  return await new Promise<string>((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve(typeof signal.reason === 'string' ? signal.reason : 'Run cancelled')
      },
      { once: true },
    )
  })
}

test('execute run calls the AI interaction seam and persists assistant output, usage, and events', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)

  let capturedRequest: AiInteractionRequest | null = null

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequest = request

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [
            {
              text: 'Start with run execution, then add SSE and retries.',
              type: 'text',
            },
          ],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [
            {
              text: 'Start with run execution, then add SSE and retries.',
              type: 'text',
            },
          ],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Start with run execution, then add SSE and retries.',
      provider: 'openai',
      providerRequestId: 'req_openai_123',
      raw: { stub: true },
      responseId: 'resp_openai_123',
      status: 'completed',
      toolCalls: [],
      usage: {
        cachedTokens: 10,
        inputTokens: 120,
        outputTokens: 32,
        reasoningTokens: 8,
        totalTokens: 152,
      },
    })
  }

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({
      maxOutputTokens: 128,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.ok(capturedRequest)
  assert.equal(capturedRequest?.maxOutputTokens, 128)
  assert.equal(capturedRequest?.messages.length, 1)
  assert.deepEqual(capturedRequest?.messages[0], {
    content: [{ text: 'Plan the next milestone for the API backend', type: 'text' }],
    role: 'user',
  })

  const runRow = runtime.db.select().from(runs).get()
  const failedResultJson = runRow?.resultJson as {
    assistantMessageId?: string
    outputText?: string
  } | null
  const itemRows = runtime.db.select().from(items).all()
  const messageRows = runtime.db.select().from(sessionMessages).all()
  const usageRows = runtime.db.select().from(usageLedger).all()
  const eventRows = runtime.db.select().from(domainEvents).all()
  const outboxRows = runtime.db.select().from(eventOutbox).all()

  assert.equal(runRow?.status, 'completed')
  assert.equal(runRow?.version, 4)
  assert.equal(runRow?.turnCount, 1)
  assert.deepEqual(runRow?.resultJson, {
    assistantMessageId: body.data.assistantMessageId,
    model: 'gpt-5.4',
    outputText: 'Start with run execution, then add SSE and retries.',
    provider: 'openai',
    providerRequestId: 'req_openai_123',
    responseId: 'resp_openai_123',
    usage: body.data.usage,
  })

  assert.equal(itemRows.length, 2)
  assert.equal(itemRows[1]?.role, 'assistant')
  assert.equal(itemRows[1]?.sequence, 2)
  assert.deepEqual(itemRows[1]?.content, [
    { text: 'Start with run execution, then add SSE and retries.', type: 'text' },
  ])

  assert.equal(messageRows.length, 2)
  assert.equal(messageRows[1]?.authorKind, 'assistant')
  assert.equal(messageRows[1]?.sequence, 2)
  assert.deepEqual(messageRows[1]?.content, [
    { text: 'Start with run execution, then add SSE and retries.', type: 'text' },
  ])

  assert.equal(usageRows.length, 1)
  assert.equal(usageRows[0]?.provider, 'openai')
  assert.equal(usageRows[0]?.model, 'gpt-5.4')
  assert.equal(usageRows[0]?.inputTokens, 120)
  assert.equal(usageRows[0]?.outputTokens, 32)
  assert.equal(usageRows[0]?.cachedTokens, 10)
  assert.equal(usageRows[0]?.estimatedOutputTokens, 128)
  assert.equal(typeof usageRows[0]?.estimatedInputTokens, 'number')
  assert.equal((usageRows[0]?.estimatedInputTokens ?? 0) > 0, true)

  const eventTypes = eventRows
    .slice()
    .sort((left, right) => left.eventNo - right.eventNo)
    .map((event) => event.type)

  assert.deepEqual(eventTypes, [
    'workspace.created',
    'workspace.resolved',
    'session.created',
    'thread.created',
    'message.posted',
    'job.created',
    'job.queued',
    'run.created',
    'run.started',
    'turn.started',
    'progress.reported',
    'generation.started',
    'progress.reported',
    'stream.delta',
    'stream.done',
    'generation.completed',
    'turn.completed',
    'progress.reported',
    'message.posted',
    'run.completed',
    'job.completed',
    'progress.reported',
  ])
  const expectedOutboxRows = eventRows.reduce(
    (total, event) =>
      total + (event.category === 'telemetry' ? 1 : 2) + (event.type === 'run.completed' ? 1 : 0),
    0,
  )

  assert.equal(outboxRows.length, expectedOutboxRows)
  const telemetryTypes = new Set([
    'generation.started',
    'generation.completed',
    'progress.reported',
    'stream.delta',
    'stream.done',
    'turn.completed',
    'turn.started',
  ])

  assert.equal(
    eventRows
      .filter((event) => telemetryTypes.has(event.type))
      .every((event) => event.category === 'telemetry'),
    true,
  )
  assert.equal(
    eventRows
      .filter((event) => !telemetryTypes.has(event.type))
      .every((event) => event.category === 'domain'),
    true,
  )
})

test('execute run falls back to assistant message text when the provider omits outputText', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const assistantText = 'Jenny is doing well and ready to help.'

  runtime.services.ai.interactions.generate = async () =>
    ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: assistantText, type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: assistantText, type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: '',
      provider: 'openai',
      providerRequestId: 'req_missing_output_text',
      raw: { stub: true },
      responseId: 'resp_missing_output_text',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  const body = await response.json()
  const runRow = runtime.db.select().from(runs).get()
  const eventRows = runtime.db.select().from(domainEvents).all()
  const streamDoneEvent = eventRows.find((event) => event.type === 'stream.done')
  const generationCompletedEvent = eventRows.find((event) => event.type === 'generation.completed')
  const runCompletedEvent = eventRows.find((event) => event.type === 'run.completed')

  assert.equal(response.status, 200)
  assert.equal(body.data.outputText, assistantText)
  assert.deepEqual(runRow?.resultJson, {
    assistantMessageId: body.data.assistantMessageId,
    model: 'gpt-5.4',
    outputText: assistantText,
    provider: 'openai',
    providerRequestId: 'req_missing_output_text',
    responseId: 'resp_missing_output_text',
    usage: body.data.usage,
  })
  assert.equal((streamDoneEvent?.payload as { text?: string } | undefined)?.text, assistantText)
  assert.equal(
    (generationCompletedEvent?.payload as { outputText?: string } | undefined)?.outputText,
    assistantText,
  )
  assert.equal(
    (runCompletedEvent?.payload as { outputText?: string } | undefined)?.outputText,
    assistantText,
  )
})

test('execute run persists attachment order on assistant messages created from run-produced files', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const runId = bootstrap.data.runId as string

  runtime.services.ai.interactions.generate = async () =>
    ok<AiInteractionResponse>({
      messages: [],
      model: 'gpt-5.4',
      output: [],
      outputText: '',
      provider: 'openai',
      providerRequestId: 'req_run_files_only',
      raw: { stub: true },
      responseId: 'resp_run_files_only',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })

  runtime.db
    .insert(files)
    .values([
      {
        accessScope: 'session_local',
        checksumSha256: null,
        createdAt: '2026-04-07T10:00:01.000Z',
        createdByAccountId: accountId,
        createdByRunId: runId,
        id: 'fil_first',
        metadata: { source: 'kernel-test' },
        mimeType: 'image/png',
        originUploadId: null,
        originalFilename: 'first.png',
        sizeBytes: 10,
        sourceKind: 'artifact',
        status: 'ready',
        storageKey: `workspaces/ten_${tenantId}/acc_${accountId}/vault/attachments/2026/04/07/fi/fil_first.png`,
        tenantId,
        title: 'first.png',
        updatedAt: '2026-04-07T10:00:01.000Z',
      },
      {
        accessScope: 'session_local',
        checksumSha256: null,
        createdAt: '2026-04-07T10:00:02.000Z',
        createdByAccountId: accountId,
        createdByRunId: runId,
        id: 'fil_second',
        metadata: { source: 'kernel-test' },
        mimeType: 'text/html',
        originUploadId: null,
        originalFilename: 'second.html',
        sizeBytes: 20,
        sourceKind: 'artifact',
        status: 'ready',
        storageKey: `workspaces/ten_${tenantId}/acc_${accountId}/vault/attachments/2026/04/07/se/fil_second.html`,
        tenantId,
        title: 'second.html',
        updatedAt: '2026-04-07T10:00:02.000Z',
      },
    ])
    .run()

  runtime.db
    .insert(fileLinks)
    .values([
      {
        createdAt: '2026-04-07T10:00:01.000Z',
        fileId: 'fil_first',
        id: 'flk_run_first',
        linkType: 'run',
        targetId: runId,
        tenantId,
      },
      {
        createdAt: '2026-04-07T10:00:02.000Z',
        fileId: 'fil_second',
        id: 'flk_run_second',
        linkType: 'run',
        targetId: runId,
        tenantId,
      },
    ])
    .run()

  const response = await app.request(`http://local/v1/runs/${runId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  const body = await response.json()
  const assistantMessage = runtime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.id, body.data.assistantMessageId))
    .get()

  assert.equal(response.status, 200)
  assert.deepEqual(assistantMessage?.metadata?.attachmentFileIds, ['fil_first', 'fil_second'])
})

test('execute run persists streamed Gemini text when the terminal response omits assistant content', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const assistantText = 'Gemini streamed answer that must survive refresh.'

  runtime.services.ai.interactions.stream = async () =>
    ok(
      (async function* (): AsyncGenerator<import('../src/domain/ai/types').AiStreamEvent> {
        yield {
          model: 'gemini-2.5-flash',
          provider: 'google',
          responseId: 'resp_google_stream_missing_1',
          type: 'response.started',
        }
        yield {
          delta: assistantText,
          type: 'text.delta',
        }
        yield {
          response: {
            messages: [],
            model: 'gemini-2.5-flash',
            output: [],
            outputText: '',
            provider: 'google',
            providerRequestId: 'req_google_stream_missing_1',
            raw: { stub: 'missing_final_message' },
            responseId: 'resp_google_stream_missing_1',
            status: 'completed',
            toolCalls: [],
            usage: null,
            webSearches: [],
          },
          type: 'response.completed',
        }
      })(),
    )

  const executeResponse = await app.request(
    `http://local/v1/runs/${bootstrap.data.runId}/execute`,
    {
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        provider: 'google',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  const executeBody = await executeResponse.json()
  const threadMessagesResponse = await app.request(
    `http://local/v1/threads/${bootstrap.data.threadId}/messages`,
    {
      headers,
      method: 'GET',
    },
  )
  const threadMessagesBody = await threadMessagesResponse.json()
  const runRow = runtime.db.select().from(runs).where(eq(runs.id, bootstrap.data.runId)).get()

  assert.equal(executeResponse.status, 200)
  assert.equal(executeBody.data.outputText, assistantText)
  assert.equal(
    (runRow?.resultJson as { outputText?: string } | null | undefined)?.outputText,
    assistantText,
  )
  assert.equal(threadMessagesResponse.status, 200)
  assert.equal(threadMessagesBody.data.at(-1)?.authorKind, 'assistant')
  assert.deepEqual(threadMessagesBody.data.at(-1)?.content, [
    {
      text: assistantText,
      type: 'text',
    },
  ])
})

test('execute run batches consecutive streamed text and reasoning deltas before persisting telemetry', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)

  runtime.services.ai.interactions.stream = async () =>
    ok(
      (async function* (): AsyncGenerator<import('../src/domain/ai/types').AiStreamEvent> {
        yield {
          model: 'gpt-5.4',
          provider: 'openai',
          responseId: 'resp_batched_stream_1',
          type: 'response.started',
        }
        yield {
          delta: 'Need',
          itemId: 'rs_batched_stream_1',
          text: 'Need',
          type: 'reasoning.summary.delta',
        }
        yield {
          delta: ' one more',
          itemId: 'rs_batched_stream_1',
          text: 'Need one more',
          type: 'reasoning.summary.delta',
        }
        yield {
          delta: ' check.',
          itemId: 'rs_batched_stream_1',
          text: 'Need one more check.',
          type: 'reasoning.summary.delta',
        }
        yield {
          itemId: 'rs_batched_stream_1',
          text: 'Need one more check.',
          type: 'reasoning.summary.done',
        }
        yield {
          delta: 'Hello',
          type: 'text.delta',
        }
        yield {
          delta: ' world',
          type: 'text.delta',
        }
        yield {
          delta: '!',
          type: 'text.delta',
        }
        yield {
          response: {
            messages: [
              {
                content: [{ text: 'Hello world!', type: 'text' }],
                role: 'assistant',
              },
            ],
            model: 'gpt-5.4',
            output: [
              {
                id: 'rs_batched_stream_1',
                summary: [{ text: 'Need one more check.', type: 'summary_text' }],
                text: 'Need one more check.',
                thought: true,
                type: 'reasoning',
              },
              {
                content: [{ text: 'Hello world!', type: 'text' }],
                role: 'assistant',
                type: 'message',
              },
            ],
            outputText: 'Hello world!',
            provider: 'openai',
            providerRequestId: 'req_batched_stream_1',
            raw: { stub: true },
            responseId: 'resp_batched_stream_1',
            status: 'completed',
            toolCalls: [],
            usage: null,
            webSearches: [],
          },
          type: 'response.completed',
        }
      })(),
    )

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 200)

  const eventRows = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .sort((left, right) => left.eventNo - right.eventNo)

  const reasoningDeltaEvents = eventRows.filter((event) => event.type === 'reasoning.summary.delta')
  const streamDeltaEvents = eventRows.filter((event) => event.type === 'stream.delta')

  assert.equal(reasoningDeltaEvents.length, 1)
  assert.equal(streamDeltaEvents.length, 1)
  assert.deepEqual(reasoningDeltaEvents[0]?.payload, {
    itemId: 'rs_batched_stream_1',
    rootRunId: bootstrap.data.runId,
    runId: bootstrap.data.runId,
    sessionId: bootstrap.data.sessionId,
    status: 'running',
    threadId: bootstrap.data.threadId,
    turn: 1,
    delta: 'Need one more check.',
    text: 'Need one more check.',
  })
  assert.deepEqual(streamDeltaEvents[0]?.payload, {
    model: 'gpt-5.4',
    provider: 'openai',
    responseId: 'resp_batched_stream_1',
    rootRunId: bootstrap.data.runId,
    runId: bootstrap.data.runId,
    sessionId: bootstrap.data.sessionId,
    status: 'running',
    threadId: bootstrap.data.threadId,
    turn: 1,
    delta: 'Hello world!',
  })
})

test('execute run marks the run as failed and emits run.failed when the AI interaction returns an error', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)

  runtime.services.ai.interactions.generate = async () => ({
    error: {
      message: 'OpenAI provider error: upstream unavailable',
      provider: 'openai',
      type: 'provider' as const,
    },
    ok: false as const,
  })

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  const body = await response.json()

  assert.equal(response.status, 502)
  assert.equal(body.ok, false)
  assert.equal(body.error.type, 'provider')

  const runRow = runtime.db.select().from(runs).get()
  const failedResultJson = runRow?.resultJson as {
    assistantMessageId?: string
    outputText?: string
  } | null
  const itemRows = runtime.db.select().from(items).all()
  const messageRows = runtime.db.select().from(sessionMessages).all()
  const usageRows = runtime.db.select().from(usageLedger).all()
  const eventRows = runtime.db.select().from(domainEvents).all()

  assert.equal(runRow?.status, 'failed')
  assert.equal(runRow?.version, 4)
  assert.equal(runRow?.turnCount, 1)
  assert.deepEqual(runRow?.errorJson, {
    message: 'OpenAI provider error: upstream unavailable',
    outputText: 'OpenAI provider error: upstream unavailable',
    provider: 'openai',
    type: 'provider',
  })

  assert.equal(itemRows.length, 1)
  assert.equal(messageRows.length, 2)
  assert.equal(usageRows.length, 0)
  assert.deepEqual(messageRows[1]?.content, [
    {
      text: 'OpenAI provider error: upstream unavailable',
      type: 'text',
    },
  ])
  assert.equal(failedResultJson?.assistantMessageId, messageRows[1]?.id)
  assert.equal(failedResultJson?.outputText, 'OpenAI provider error: upstream unavailable')
  assert.deepEqual(
    (
      messageRows[1]?.metadata as
        | {
            finishReason?: string
          }
        | null
        | undefined
    )?.finishReason,
    'error',
  )

  const eventTypes = eventRows
    .slice()
    .sort((left, right) => left.eventNo - right.eventNo)
    .map((event) => event.type)

  assert.deepEqual(eventTypes, [
    'workspace.created',
    'workspace.resolved',
    'session.created',
    'thread.created',
    'message.posted',
    'job.created',
    'job.queued',
    'run.created',
    'run.started',
    'turn.started',
    'progress.reported',
    'generation.started',
    'generation.failed',
    'message.posted',
    'run.failed',
    'job.blocked',
    'progress.reported',
  ])
})

test('execute run forwards reasoning overrides and persists them in the run snapshot', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)

  let capturedRequest: AiInteractionRequest | null = null

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequest = request

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [
            {
              text: 'Reasoning config preserved.',
              type: 'text',
            },
          ],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [
            {
              text: 'Reasoning config preserved.',
              type: 'text',
            },
          ],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Reasoning config preserved.',
      provider: 'openai',
      providerRequestId: 'req_openai_reasoning',
      raw: { stub: true },
      responseId: 'resp_openai_reasoning',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({
      reasoning: {
        effort: 'high',
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 200)
  assert.deepEqual(capturedRequest?.reasoning, {
    effort: 'high',
  })

  const runRow = runtime.db.select().from(runs).get()

  assert.deepEqual(runRow?.configSnapshot, {
    apiBasePath: '/api',
    maxOutputTokens: null,
    model: null,
    modelAlias: null,
    provider: 'openai',
    reasoning: {
      effort: 'high',
    },
    temperature: null,
    version: 'v1',
  })
})

test('execute run clears inherited reasoning when switching providers without an explicit override', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)

  runtime.db
    .update(runs)
    .set({
      configSnapshot: {
        apiBasePath: '/v1',
        model: null,
        modelAlias: 'default',
        provider: 'openai',
        reasoning: {
          effort: 'medium',
        },
        version: 'v1',
      },
    })
    .where(eq(runs.id, bootstrap.data.runId))
    .run()

  let capturedRequest: AiInteractionRequest | null = null

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequest = request

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [
            {
              text: 'Gemini request completed.',
              type: 'text',
            },
          ],
          role: 'assistant',
        },
      ],
      model: 'gemini-2.5-flash',
      output: [
        {
          content: [
            {
              text: 'Gemini request completed.',
              type: 'text',
            },
          ],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Gemini request completed.',
      provider: 'google',
      providerRequestId: 'req_google_123',
      raw: { stub: true },
      responseId: 'resp_google_123',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      provider: 'google',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 200)
  assert.equal(capturedRequest?.model, 'gemini-2.5-flash')
  assert.equal(capturedRequest?.provider, 'google')
  assert.equal(capturedRequest?.reasoning, undefined)

  const runRow = runtime.db.select().from(runs).where(eq(runs.id, bootstrap.data.runId)).get()

  assert.deepEqual(runRow?.configSnapshot, {
    apiBasePath: '/api',
    maxOutputTokens: null,
    model: 'gemini-2.5-flash',
    modelAlias: 'default',
    provider: 'google',
    reasoning: null,
    temperature: null,
    version: 'v1',
  })
})

test('execute run persists function calls, tool audit, and tool outputs before completing the assistant reply', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const capturedRequests: AiInteractionRequest[] = []

  registerFunctionTool(runtime, {
    execute: async () =>
      ok({
        kind: 'immediate' as const,
        output: {
          forecast: 'sunny',
        },
      }),
    name: 'get_weather',
  })

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    if (capturedRequests.length === 1) {
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: { location: 'Paris' },
            argumentsJson: '{"location":"Paris"}',
            callId: 'call_weather_1',
            name: 'get_weather',
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_openai_tool_1',
        raw: { stub: 'tool_call' },
        responseId: 'resp_openai_tool_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: { location: 'Paris' },
            argumentsJson: '{"location":"Paris"}',
            callId: 'call_weather_1',
            name: 'get_weather',
          },
        ],
        usage: {
          cachedTokens: 0,
          inputTokens: 90,
          outputTokens: 15,
          reasoningTokens: 4,
          totalTokens: 105,
        },
      })
    }

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'It is sunny in Paris.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'It is sunny in Paris.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'It is sunny in Paris.',
      provider: 'openai',
      providerRequestId: 'req_openai_tool_2',
      raw: { stub: 'final' },
      responseId: 'resp_openai_tool_2',
      status: 'completed',
      toolCalls: [],
      usage: {
        cachedTokens: 0,
        inputTokens: 40,
        outputTokens: 12,
        reasoningTokens: 0,
        totalTokens: 52,
      },
    })
  }

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 200)
  assert.equal(capturedRequests.length, 2)
  const assistantToolCallMessage = capturedRequests[1]?.messages.find(
    (message) =>
      message.role === 'assistant' &&
      message.content.some((content) => content.type === 'function_call'),
  )
  const toolResultMessage = capturedRequests[1]?.messages.find(
    (message) =>
      message.role === 'tool' &&
      message.content.some((content) => content.type === 'function_result'),
  )

  assert.equal(assistantToolCallMessage?.role, 'assistant')
  assert.equal(assistantToolCallMessage?.content[0]?.type, 'function_call')
  assert.equal(toolResultMessage?.role, 'tool')
  assert.equal(toolResultMessage?.content[0]?.type, 'function_result')

  const itemRows = runtime.db.select().from(items).all()
  const toolRows = runtime.db.select().from(toolExecutions).all()
  const usageRows = runtime.db.select().from(usageLedger).all()
  const eventRows = runtime.db.select().from(domainEvents).all()

  assert.equal(toolRows.length, 1)
  assert.equal(toolRows[0]?.id, 'call_weather_1')
  assert.equal(toolRows[0]?.tool, 'get_weather')
  assert.deepEqual(toolRows[0]?.outcomeJson, { forecast: 'sunny' })
  assert.equal(toolRows[0]?.errorText, null)

  assert.deepEqual(
    itemRows.map((item) => ({ callId: item.callId, output: item.output, type: item.type })),
    [
      { callId: null, output: null, type: 'message' },
      { callId: 'call_weather_1', output: null, type: 'function_call' },
      {
        callId: 'call_weather_1',
        output: JSON.stringify({ forecast: 'sunny' }),
        type: 'function_call_output',
      },
      { callId: null, output: null, type: 'message' },
    ],
  )

  assert.equal(usageRows.length, 2)
  assert.deepEqual(
    eventRows
      .slice()
      .sort((left, right) => left.eventNo - right.eventNo)
      .map((event) => event.type),
    [
      'workspace.created',
      'workspace.resolved',
      'session.created',
      'thread.created',
      'message.posted',
      'job.created',
      'job.queued',
      'run.created',
      'run.started',
      'turn.started',
      'progress.reported',
      'generation.started',
      'progress.reported',
      'stream.done',
      'generation.completed',
      'turn.completed',
      'progress.reported',
      'progress.reported',
      'tool.called',
      'tool.completed',
      'turn.started',
      'progress.reported',
      'generation.started',
      'progress.reported',
      'stream.delta',
      'stream.done',
      'generation.completed',
      'turn.completed',
      'progress.reported',
      'message.posted',
      'run.completed',
      'job.completed',
      'progress.reported',
    ],
  )
})

test('execute run persists and replays OpenAI reasoning item ids across turns', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const capturedRequests: AiInteractionRequest[] = []

  registerFunctionTool(runtime, {
    execute: async () =>
      ok({
        kind: 'immediate' as const,
        output: {
          ok: true,
        },
      }),
    name: 'get_status',
  })

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    if (capturedRequests.length === 1) {
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            encryptedContent: 'enc_reasoning_1',
            id: 'rs_reasoning_1',
            summary: [{ text: 'Need the tool result before answering.', type: 'summary_text' }],
            type: 'reasoning',
          },
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_status_1',
            name: 'get_status',
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_openai_reasoning_1',
        raw: { stub: 'reasoning_turn_1' },
        responseId: 'resp_openai_reasoning_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_status_1',
            name: 'get_status',
          },
        ],
        usage: null,
      })
    }

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'The tool completed successfully.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'The tool completed successfully.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'The tool completed successfully.',
      provider: 'openai',
      providerRequestId: 'req_openai_reasoning_2',
      raw: { stub: 'reasoning_turn_2' },
      responseId: 'resp_openai_reasoning_2',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 200)
  assert.equal(capturedRequests.length, 2)

  const replayedReasoningPart = capturedRequests[1]?.messages
    .flatMap((message) => message.content)
    .find((part) => part.type === 'reasoning')

  assert.equal(replayedReasoningPart?.type, 'reasoning')
  assert.equal(replayedReasoningPart?.id, 'rs_reasoning_1')

  const reasoningRows = runtime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.type === 'reasoning')

  assert.equal(reasoningRows.length, 1)
  assert.equal(
    (
      reasoningRows[0]?.providerPayload as {
        providerItemId?: string | null
      } | null
    )?.providerItemId,
    'rs_reasoning_1',
  )

  const assistantMessageRow = runtime.db
    .select()
    .from(sessionMessages)
    .all()
    .find((message) => message.authorKind === 'assistant')
  const transcriptBlocks = (
    assistantMessageRow?.metadata as {
      transcript?: {
        blocks?: Array<{
          content?: string
          toolCallId?: string
          type?: string
        }>
      }
    } | null
  )?.transcript?.blocks

  assert.deepEqual(
    transcriptBlocks?.map((block) => block.type),
    ['thinking', 'tool_interaction'],
  )
  assert.equal(transcriptBlocks?.[0]?.content, 'Need the tool result before answering.')
  assert.equal(transcriptBlocks?.[1]?.toolCallId, 'call_status_1')
})

test('execute run preserves streamed reasoning and web search order in persisted transcript blocks', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)

  const finalWebSearch = {
    id: 'web_search:resp_openai_search_1',
    patterns: ['battery'],
    provider: 'openai' as const,
    queries: ['site:apple.com AirPods Max 2 Apple official'],
    references: [
      {
        domain: 'www.apple.com',
        title: 'Apple introduces AirPods Max 2 - Apple',
        url: 'https://www.apple.com/newsroom/2026/03/apple-introduces-airpods-max-2-powered-by-h2/',
      },
    ],
    responseId: 'resp_openai_search_1',
    status: 'completed' as const,
    targetUrls: [
      'https://www.apple.com/newsroom/2026/03/apple-introduces-airpods-max-2-powered-by-h2/',
    ],
  }

  runtime.services.ai.interactions.stream = async () =>
    ok(
      (async function* (): AsyncGenerator<import('../src/domain/ai/types').AiStreamEvent> {
        yield {
          model: 'gpt-5.4',
          provider: 'openai',
          responseId: 'resp_openai_search_1',
          type: 'response.started',
        }
        yield {
          delta: 'Need the official Apple announcement before answering.',
          itemId: 'rs_reasoning_search_1',
          text: 'Need the official Apple announcement before answering.',
          type: 'reasoning.summary.delta',
        }
        yield {
          activity: {
            ...finalWebSearch,
            queries: [],
            references: [],
            status: 'searching',
            targetUrls: [],
          },
          type: 'web_search',
        }
        yield {
          itemId: 'rs_reasoning_search_1',
          text: 'Need the official Apple announcement before answering.',
          type: 'reasoning.summary.done',
        }
        yield {
          activity: finalWebSearch,
          type: 'web_search',
        }
        yield {
          delta: 'Apple introduced AirPods Max 2 in March 2026.',
          type: 'text.delta',
        }
        yield {
          response: {
            messages: [
              {
                content: [{ text: 'Apple introduced AirPods Max 2 in March 2026.', type: 'text' }],
                role: 'assistant',
              },
            ],
            model: 'gpt-5.4',
            output: [
              {
                id: 'rs_reasoning_search_1',
                summary: [
                  {
                    text: 'Need the official Apple announcement before answering.',
                    type: 'summary_text',
                  },
                ],
                text: 'Need the official Apple announcement before answering.',
                type: 'reasoning',
              },
              {
                content: [
                  {
                    text: 'Apple introduced AirPods Max 2 in March 2026.',
                    type: 'text',
                  },
                ],
                role: 'assistant',
                type: 'message',
              },
            ],
            outputText: 'Apple introduced AirPods Max 2 in March 2026.',
            provider: 'openai',
            providerRequestId: 'req_openai_search_1',
            raw: { stub: 'streamed_search' },
            responseId: 'resp_openai_search_1',
            status: 'completed',
            toolCalls: [],
            usage: null,
            webSearches: [finalWebSearch],
          },
          type: 'response.completed',
        }
      })(),
    )

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 200)

  const assistantMessageRow = runtime.db
    .select()
    .from(sessionMessages)
    .all()
    .find((message) => message.authorKind === 'assistant')
  const transcriptBlocks = (
    assistantMessageRow?.metadata as {
      transcript?: {
        blocks?: Array<{
          queries?: string[]
          references?: Array<{ title?: string; url?: string }>
          toolCallId?: string
          type?: string
        }>
      }
    } | null
  )?.transcript?.blocks

  assert.deepEqual(
    transcriptBlocks?.map((block) => block.type),
    ['thinking', 'web_search'],
  )
  assert.deepEqual(transcriptBlocks?.[1]?.queries, ['site:apple.com AirPods Max 2 Apple official'])
  assert.equal(
    transcriptBlocks?.[1]?.references?.[0]?.title,
    'Apple introduces AirPods Max 2 - Apple',
  )
})

test('execute run persists transcript and partial text when the provider stream fails mid-response', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)

  runtime.services.ai.interactions.stream = async () =>
    ok(
      (async function* (): AsyncGenerator<import('../src/domain/ai/types').AiStreamEvent> {
        yield {
          model: 'gpt-5.4',
          provider: 'openai',
          responseId: 'resp_failed_stream_1',
          type: 'response.started',
        }
        yield {
          itemId: 'rs_failed_stream_1',
          text: 'Need one more check before finalizing.',
          type: 'reasoning.summary.done',
        }
        yield {
          delta: 'Partial answer before the provider failed.',
          type: 'text.delta',
        }
        throw new Error('provider stream interrupted')
      })(),
    )

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 502)

  const runRow = runtime.db.select().from(runs).get()
  const assistantMessageRow = runtime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.authorKind, 'assistant'))
    .get()
  const resultJson = runRow?.resultJson as {
    assistantMessageId?: string
    outputText?: string
    transcript?: {
      blocks?: Array<{
        content?: string
        type?: string
      }>
    }
  } | null

  assert.equal(runRow?.status, 'failed')
  assert.equal(resultJson?.outputText, 'Partial answer before the provider failed.')
  assert.equal(resultJson?.assistantMessageId, assistantMessageRow?.id)
  assert.deepEqual(
    resultJson?.transcript?.blocks?.map((block) => block.type),
    ['thinking'],
  )
  assert.equal(
    resultJson?.transcript?.blocks?.[0]?.content,
    'Need one more check before finalizing.',
  )
  assert.deepEqual(assistantMessageRow?.content, [
    {
      text: 'Partial answer before the provider failed.',
      type: 'text',
    },
  ])
})

test('execute run compacts long main-thread history into a summary plus live tail', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    MEMORY_OBSERVATION_TAIL_RATIO: '0.1',
    MEMORY_OBSERVATION_TRIGGER_RATIO: '0.0005',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const longA = `A${' very long history'.repeat(80)}`
  const longB = `B${' more preserved detail'.repeat(80)}`
  const longC = `C${' newest turn should stay raw'.repeat(15)}`
  const capturedRequests: AiInteractionRequest[] = []

  for (const text of [longA, longB, longC]) {
    const postResponse = await app.request(
      `http://local/v1/threads/${bootstrap.data.threadId}/messages`,
      {
        body: JSON.stringify({ text }),
        headers: {
          ...headers,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    )

    assert.equal(postResponse.status, 201)
  }

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    if (request.metadata?.stage === 'observer') {
      return ok<AiInteractionResponse>({
        messages: [
          {
            content: [
              {
                text: JSON.stringify({
                  observations: [
                    { text: 'The thread is planning API backend milestone sequencing.' },
                    {
                      text: 'Earlier context emphasized run execution and SSE as durable priorities.',
                    },
                  ],
                }),
                type: 'text',
              },
            ],
            role: 'assistant',
          },
        ],
        model: 'gpt-5.4',
        output: [
          {
            content: [
              {
                text: JSON.stringify({
                  observations: [
                    { text: 'The thread is planning API backend milestone sequencing.' },
                    {
                      text: 'Earlier context emphasized run execution and SSE as durable priorities.',
                    },
                  ],
                }),
                type: 'text',
              },
            ],
            role: 'assistant',
            type: 'message',
          },
        ],
        outputText: JSON.stringify({
          observations: [
            { text: 'The thread is planning API backend milestone sequencing.' },
            { text: 'Earlier context emphasized run execution and SSE as durable priorities.' },
          ],
        }),
        provider: 'openai',
        providerRequestId: 'req_observer_1',
        raw: { stub: 'observer' },
        responseId: 'resp_observer_1',
        status: 'completed',
        toolCalls: [],
        usage: null,
      })
    }

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Compaction worked.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Compaction worked.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Compaction worked.',
      provider: 'openai',
      providerRequestId: 'req_compaction_1',
      raw: { stub: true },
      responseId: 'resp_compaction_1',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 200)
  assert.equal(capturedRequests.length, 2)
  assert.equal(capturedRequests[0]?.metadata?.stage, 'observer')
  assert.equal(capturedRequests[1]?.messages[0]?.role, 'developer')
  assert.equal(capturedRequests[1]?.messages[1]?.role, 'developer')
  assert.deepEqual(capturedRequests[1]?.messages.at(-1)?.content, [{ text: longC, type: 'text' }])
  assert.match(
    String((capturedRequests[1]?.messages[0]?.content[0] as { text?: string } | undefined)?.text),
    /Summary of earlier main-thread context:/,
  )
  assert.match(
    String((capturedRequests[1]?.messages[1]?.content[0] as { text?: string } | undefined)?.text),
    /Durable observations from earlier sealed main-thread context:/,
  )

  const summaryRows = runtime.db.select().from(contextSummaries).all()
  const memoryRows = runtime.db.select().from(memoryRecords).all()
  const sourceRows = runtime.db.select().from(memoryRecordSources).all()

  assert.equal(summaryRows.length, 1)
  assert.equal(summaryRows[0]?.runId, bootstrap.data.runId)
  assert.equal(summaryRows[0]?.fromSequence, 1)
  assert.equal(memoryRows.length, 1)
  assert.equal(memoryRows[0]?.kind, 'observation')
  assert.equal(sourceRows.length, 1)
  assert.equal(sourceRows[0]?.sourceSummaryId, summaryRows[0]?.id)
})

test('execute run reflects run-local observations into a new generation and injects the reflection into prompt assembly', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    MEMORY_REFLECTION_TRIGGER_RATIO: '0.00005',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const runRow = runtime.db.select().from(runs).get()
  const capturedRequests: AiInteractionRequest[] = []

  assert.ok(runRow)
  assert.equal(typeof runRow.threadId, 'string')

  runtime.db
    .insert(items)
    .values([
      {
        arguments: null,
        callId: null,
        content: [
          { text: 'Earlier work prioritized run execution before SSE retries.', type: 'text' },
        ],
        createdAt: '2026-03-29T00:00:01.000Z',
        id: 'itm_reflect_1',
        name: null,
        output: null,
        providerPayload: null,
        role: 'user',
        runId: runRow.id,
        sequence: 1,
        summary: null,
        tenantId: runRow.tenantId,
        type: 'message',
      },
      {
        arguments: null,
        callId: null,
        content: [{ text: 'That sequencing was accepted as the working plan.', type: 'text' }],
        createdAt: '2026-03-29T00:00:02.000Z',
        id: 'itm_reflect_2',
        name: null,
        output: null,
        providerPayload: null,
        role: 'assistant',
        runId: runRow.id,
        sequence: 2,
        summary: null,
        tenantId: runRow.tenantId,
        type: 'message',
      },
      {
        arguments: null,
        callId: null,
        content: [{ text: 'Current turn: wire reflection and preserve provenance.', type: 'text' }],
        createdAt: '2026-03-29T00:00:03.000Z',
        id: 'itm_reflect_3',
        name: null,
        output: null,
        providerPayload: null,
        role: 'user',
        runId: runRow.id,
        sequence: 3,
        summary: null,
        tenantId: runRow.tenantId,
        type: 'message',
      },
    ])
    .run()

  runtime.db
    .insert(sessionMessages)
    .values({
      authorAccountId: null,
      authorKind: 'user',
      content: [{ text: 'Current turn: wire reflection and preserve provenance.', type: 'text' }],
      createdAt: '2026-03-29T00:00:03.000Z',
      id: 'msg_reflect_2',
      metadata: null,
      runId: null,
      sequence: 2,
      sessionId: runRow.sessionId,
      tenantId: runRow.tenantId,
      threadId: runRow.threadId!,
    })
    .run()

  runtime.db
    .insert(contextSummaries)
    .values({
      content: [
        'Summary of earlier main-thread context:',
        '- user: Earlier work prioritized run execution before SSE retries.',
        '- assistant: That sequencing was accepted as the working plan.',
      ].join('\n'),
      createdAt: '2026-03-29T00:00:04.000Z',
      fromSequence: 1,
      id: 'sum_reflect_1',
      modelKey: 'main_thread_compaction_v1',
      previousSummaryId: null,
      runId: runRow.id,
      tenantId: runRow.tenantId,
      throughSequence: 2,
      tokensAfter: 32,
      tokensBefore: 96,
      turnNumber: 0,
    })
    .run()

  runtime.db
    .insert(memoryRecords)
    .values([
      {
        content: {
          reflection:
            'The main thread is sequencing runtime work with run execution first and SSE after.',
          source: 'reflector_v1',
        },
        createdAt: '2026-03-29T00:00:05.000Z',
        generation: 1,
        id: 'mrec_reflection_1',
        kind: 'reflection',
        ownerRunId: runRow.id,
        parentRecordId: null,
        rootRunId: runRow.rootRunId,
        scopeKind: 'run_local',
        scopeRef: runRow.id,
        sessionId: runRow.sessionId,
        status: 'active',
        tenantId: runRow.tenantId,
        threadId: runRow.threadId!,
        tokenCount: 28,
        visibility: 'private',
      },
      {
        content: {
          observations: [
            {
              text: 'The current implementation must remain main-thread only until child runs exist.',
            },
          ],
          source: 'observer_v1',
        },
        createdAt: '2026-03-29T00:00:06.000Z',
        generation: 1,
        id: 'mrec_observation_1',
        kind: 'observation',
        ownerRunId: runRow.id,
        parentRecordId: null,
        rootRunId: runRow.rootRunId,
        scopeKind: 'run_local',
        scopeRef: runRow.id,
        sessionId: runRow.sessionId,
        status: 'active',
        tenantId: runRow.tenantId,
        threadId: runRow.threadId!,
        tokenCount: 18,
        visibility: 'private',
      },
      {
        content: {
          observations: [
            { text: 'Reflection should preserve provenance back to the superseded observations.' },
          ],
          source: 'observer_v1',
        },
        createdAt: '2026-03-29T00:00:07.000Z',
        generation: 1,
        id: 'mrec_observation_2',
        kind: 'observation',
        ownerRunId: runRow.id,
        parentRecordId: null,
        rootRunId: runRow.rootRunId,
        scopeKind: 'run_local',
        scopeRef: runRow.id,
        sessionId: runRow.sessionId,
        status: 'active',
        tenantId: runRow.tenantId,
        threadId: runRow.threadId!,
        tokenCount: 18,
        visibility: 'private',
      },
    ])
    .run()

  runtime.db
    .insert(memoryRecordSources)
    .values([
      {
        createdAt: '2026-03-29T00:00:06.000Z',
        fromSequence: 1,
        id: 'msrc_observation_1',
        recordId: 'mrec_observation_1',
        sourceRecordId: null,
        sourceRunId: runRow.id,
        sourceSummaryId: 'sum_reflect_1',
        tenantId: runRow.tenantId,
        throughSequence: 2,
      },
      {
        createdAt: '2026-03-29T00:00:07.000Z',
        fromSequence: 1,
        id: 'msrc_observation_2',
        recordId: 'mrec_observation_2',
        sourceRecordId: null,
        sourceRunId: runRow.id,
        sourceSummaryId: 'sum_reflect_1',
        tenantId: runRow.tenantId,
        throughSequence: 2,
      },
    ])
    .run()

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    if (request.metadata?.stage === 'reflector') {
      return ok<AiInteractionResponse>({
        messages: [
          {
            content: [
              {
                text: JSON.stringify({
                  reflection:
                    'Main-thread memory stays private to this run, keeps execution-before-SSE sequencing, and retains provenance when observations are compacted.',
                }),
                type: 'text',
              },
            ],
            role: 'assistant',
          },
        ],
        model: 'gpt-5.4',
        output: [
          {
            content: [
              {
                text: JSON.stringify({
                  reflection:
                    'Main-thread memory stays private to this run, keeps execution-before-SSE sequencing, and retains provenance when observations are compacted.',
                }),
                type: 'text',
              },
            ],
            role: 'assistant',
            type: 'message',
          },
        ],
        outputText: JSON.stringify({
          reflection:
            'Main-thread memory stays private to this run, keeps execution-before-SSE sequencing, and retains provenance when observations are compacted.',
        }),
        provider: 'openai',
        providerRequestId: 'req_reflector_1',
        raw: { stub: 'reflector' },
        responseId: 'resp_reflector_1',
        status: 'completed',
        toolCalls: [],
        usage: null,
      })
    }

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Reflection worked.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Reflection worked.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Reflection worked.',
      provider: 'openai',
      providerRequestId: 'req_reflector_2',
      raw: { stub: true },
      responseId: 'resp_reflector_2',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 200)
  assert.equal(capturedRequests.length, 2)
  assert.equal(capturedRequests[0]?.metadata?.stage, 'reflector')
  assert.match(
    String((capturedRequests[0]?.messages[1]?.content[0] as { text?: string } | undefined)?.text),
    /Previous reflection:\nThe main thread is sequencing runtime work with run execution first and SSE after\./,
  )
  assert.equal(capturedRequests[1]?.messages.length, 3)
  assert.match(
    String((capturedRequests[1]?.messages[0]?.content[0] as { text?: string } | undefined)?.text),
    /Summary of earlier main-thread context:/,
  )
  assert.match(
    String((capturedRequests[1]?.messages[1]?.content[0] as { text?: string } | undefined)?.text),
    /Compressed reflection from earlier run-local observations:/,
  )
  assert.deepEqual(capturedRequests[1]?.messages[2], {
    content: [{ text: 'Current turn: wire reflection and preserve provenance.', type: 'text' }],
    role: 'user',
  })

  const memoryRows = runtime.db.select().from(memoryRecords).all()
  const sourceRows = runtime.db.select().from(memoryRecordSources).all()
  const activeReflection = memoryRows.find(
    (row) => row.kind === 'reflection' && row.status === 'active',
  )
  const supersededObservations = memoryRows.filter(
    (row) => row.kind === 'observation' && row.status === 'superseded',
  )
  const supersededReflections = memoryRows.filter(
    (row) => row.kind === 'reflection' && row.status === 'superseded',
  )

  assert.ok(activeReflection)
  assert.equal(activeReflection?.generation, 2)
  assert.equal(supersededObservations.length, 2)
  assert.equal(supersededReflections.length, 1)
  assert.equal(
    memoryRows.filter((row) => row.kind === 'observation' && row.status === 'active').length,
    0,
  )

  const reflectionSources = sourceRows.filter((row) => row.recordId === activeReflection?.id)

  assert.equal(reflectionSources.length, 3)
  assert.equal(
    reflectionSources.every((row) => row.sourceRecordId !== null),
    true,
  )
  assert.equal(
    reflectionSources.some((row) => row.sourceRecordId === 'mrec_reflection_1'),
    true,
  )
  assert.equal(
    reflectionSources.every((row) => row.sourceSummaryId === null),
    true,
  )
})

test('execute run persists failed tool calls as error outputs and lets the model recover', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const capturedRequests: AiInteractionRequest[] = []

  registerFunctionTool(runtime, {
    execute: async () =>
      err({
        message: 'tool boom',
        type: 'conflict' as const,
      }),
    name: 'explode',
  })

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    if (capturedRequests.length === 1) {
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_explode_1',
            name: 'explode',
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_fail_1',
        raw: { stub: 'tool_call' },
        responseId: 'resp_fail_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_explode_1',
            name: 'explode',
          },
        ],
        usage: null,
      })
    }

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'The tool failed, so I used a fallback answer.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'The tool failed, so I used a fallback answer.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'The tool failed, so I used a fallback answer.',
      provider: 'openai',
      providerRequestId: 'req_fail_2',
      raw: { stub: 'final' },
      responseId: 'resp_fail_2',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 200)
  assert.equal(capturedRequests.length, 2)
  const toolResultMessage = capturedRequests[1]?.messages.find(
    (message) =>
      message.role === 'tool' &&
      message.content.some((content) => content.type === 'function_result'),
  )

  assert.equal(toolResultMessage?.role, 'tool')
  assert.deepEqual(toolResultMessage?.content[0], {
    callId: 'call_explode_1',
    isError: true,
    name: 'explode',
    outputJson: JSON.stringify({
      error: {
        message: 'tool boom',
        type: 'conflict',
      },
      ok: false,
    }),
    type: 'function_result',
  })

  const toolRows = runtime.db.select().from(toolExecutions).all()
  const eventRows = runtime.db.select().from(domainEvents).all()

  assert.equal(toolRows[0]?.errorText, 'tool boom')
  assert.deepEqual(toolRows[0]?.outcomeJson, {
    error: {
      message: 'tool boom',
      type: 'conflict',
    },
    ok: false,
  })
  assert.equal(
    eventRows.some((event) => event.type === 'tool.failed'),
    true,
  )
  assert.equal(
    eventRows.some((event) => event.type === 'run.completed'),
    true,
  )
})

test('execute run replays failed Gemini tool results with provider signatures and lets the model recover', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const capturedRequests: AiInteractionRequest[] = []

  registerFunctionTool(runtime, {
    execute: async () =>
      err({
        message: 'tool boom',
        type: 'conflict' as const,
      }),
    name: 'explode',
  })

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    if (capturedRequests.length === 1) {
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gemini-2.5-pro',
        output: [
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_explode_google_1',
            name: 'explode',
            providerSignature: 'sig_google_call_1',
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'google',
        providerRequestId: null,
        raw: { stub: 'tool_call' },
        responseId: 'int_google_fail_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_explode_google_1',
            name: 'explode',
            providerSignature: 'sig_google_call_1',
          },
        ],
        usage: null,
        webSearches: [],
      })
    }

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'The tool failed, so I used a Gemini fallback answer.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gemini-2.5-pro',
      output: [
        {
          content: [{ text: 'The tool failed, so I used a Gemini fallback answer.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'The tool failed, so I used a Gemini fallback answer.',
      provider: 'google',
      providerRequestId: null,
      raw: { stub: 'final' },
      responseId: 'int_google_fail_2',
      status: 'completed',
      toolCalls: [],
      usage: null,
      webSearches: [],
    })
  }

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({
      model: 'gemini-2.5-pro',
      provider: 'google',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 200)
  assert.equal(capturedRequests.length, 2)
  assert.equal(capturedRequests[0]?.provider, 'google')
  assert.equal(capturedRequests[1]?.provider, 'google')

  const toolResultMessage = capturedRequests[1]?.messages.find(
    (message) =>
      message.role === 'tool' &&
      message.content.some((content) => content.type === 'function_result'),
  )

  assert.equal(toolResultMessage?.role, 'tool')
  assert.deepEqual(toolResultMessage?.content[0], {
    callId: 'call_explode_google_1',
    isError: true,
    name: 'explode',
    outputJson: JSON.stringify({
      error: {
        message: 'tool boom',
        type: 'conflict',
      },
      ok: false,
    }),
    providerSignature: 'sig_google_call_1',
    type: 'function_result',
  })

  const toolRows = runtime.db.select().from(toolExecutions).all()
  const eventRows = runtime.db.select().from(domainEvents).all()

  assert.equal(toolRows[0]?.errorText, 'tool boom')
  assert.equal(
    eventRows.some((event) => event.type === 'tool.failed'),
    true,
  )
  assert.equal(
    eventRows.some((event) => event.type === 'run.completed'),
    true,
  )
})

test('execute run preserves model tool call order when parallel tools complete out of order', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)

  registerFunctionTool(runtime, {
    execute: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return ok({
        kind: 'immediate' as const,
        output: { result: 'slow' },
      })
    },
    name: 'slow_tool',
  })
  registerFunctionTool(runtime, {
    execute: async () =>
      ok({
        kind: 'immediate' as const,
        output: { result: 'fast' },
      }),
    name: 'fast_tool',
  })

  let callCount = 0
  runtime.services.ai.interactions.generate = async () => {
    callCount += 1

    if (callCount === 1) {
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_slow_1',
            name: 'slow_tool',
            type: 'function_call',
          },
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_fast_1',
            name: 'fast_tool',
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_parallel_1',
        raw: { stub: true },
        responseId: 'resp_parallel_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_slow_1',
            name: 'slow_tool',
          },
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_fast_1',
            name: 'fast_tool',
          },
        ],
        usage: null,
      })
    }

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Both tools completed.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Both tools completed.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Both tools completed.',
      provider: 'openai',
      providerRequestId: 'req_parallel_2',
      raw: { stub: true },
      responseId: 'resp_parallel_2',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const response = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 200)

  const outputItems = runtime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.type === 'function_call_output')

  assert.deepEqual(
    outputItems.map((item) => item.callId),
    ['call_slow_1', 'call_fast_1'],
  )
})

test('execute run can pause on a wait, resume with tool output, and then complete', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)

  registerFunctionTool(runtime, {
    execute: async () =>
      ok({
        kind: 'waiting' as const,
        wait: {
          description: 'Waiting for external report',
          targetKind: 'external' as const,
          targetRef: 'job_123',
          type: 'tool' as const,
        },
      }),
    name: 'fetch_report',
  })

  let callCount = 0
  runtime.services.ai.interactions.generate = async (request) => {
    callCount += 1

    if (callCount === 1) {
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: { reportId: 'rpt_1' },
            argumentsJson: '{"reportId":"rpt_1"}',
            callId: 'call_report_1',
            name: 'fetch_report',
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_wait_1',
        raw: { stub: 'wait' },
        responseId: 'resp_wait_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: { reportId: 'rpt_1' },
            argumentsJson: '{"reportId":"rpt_1"}',
            callId: 'call_report_1',
            name: 'fetch_report',
          },
        ],
        usage: null,
      })
    }

    assert.equal(request.messages.at(-1)?.role, 'tool')

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'The report is ready.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'The report is ready.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'The report is ready.',
      provider: 'openai',
      providerRequestId: 'req_wait_2',
      raw: { stub: 'final' },
      responseId: 'resp_wait_2',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

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
  const executeBody = await executeResponse.json()

  assert.equal(executeResponse.status, 202)
  assert.equal(executeBody.data.status, 'waiting')

  const waitRows = runtime.db.select().from(runDependencies).all()
  const toolRowsBeforeResume = runtime.db.select().from(toolExecutions).all()

  assert.equal(waitRows.length, 1)
  assert.equal(waitRows[0]?.status, 'pending')
  assert.equal(toolRowsBeforeResume[0]?.completedAt, null)

  const resumeResponse = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/resume`, {
    body: JSON.stringify({
      output: {
        report: 'done',
      },
      waitId: waitRows[0]?.id,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  const resumeBody = await resumeResponse.json()

  assert.equal(resumeResponse.status, 202)
  assert.equal(resumeBody.data.status, 'accepted')

  await runtime.services.multiagent.processOneDecision()

  const waitRowsAfterResume = runtime.db.select().from(runDependencies).all()
  const toolRowsAfterResume = runtime.db.select().from(toolExecutions).all()
  const runRow = runtime.db.select().from(runs).get()
  const eventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .slice()
    .sort((left, right) => left.eventNo - right.eventNo)
    .map((event) => event.type)

  assert.equal(waitRowsAfterResume[0]?.status, 'resolved')
  assert.deepEqual(waitRowsAfterResume[0]?.resolutionJson, {
    output: { report: 'done' },
  })
  assert.deepEqual(toolRowsAfterResume[0]?.outcomeJson, { report: 'done' })
  assert.equal(runRow?.status, 'completed')
  assert.equal(eventTypes.includes('run.waiting'), true)
  assert.equal(eventTypes.includes('run.resumed'), true)
})

test('cancel run cancels pending waits and marks the run cancelled', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)

  registerFunctionTool(runtime, {
    execute: async () =>
      ok({
        kind: 'waiting' as const,
        wait: {
          description: 'Waiting for approval',
          targetKind: 'external' as const,
          targetRef: 'approval_1',
          type: 'tool' as const,
        },
      }),
    name: 'await_approval',
  })

  runtime.services.ai.interactions.generate = async () =>
    ok<AiInteractionResponse>({
      messages: [],
      model: 'gpt-5.4',
      output: [
        {
          arguments: {},
          argumentsJson: '{}',
          callId: 'call_wait_1',
          name: 'await_approval',
          type: 'function_call',
        },
      ],
      outputText: 'Need approval before I can finish.',
      provider: 'openai',
      providerRequestId: 'req_cancel_wait',
      raw: { stub: true },
      responseId: 'resp_cancel_wait',
      status: 'completed',
      toolCalls: [
        {
          arguments: {},
          argumentsJson: '{}',
          callId: 'call_wait_1',
          name: 'await_approval',
        },
      ],
      usage: null,
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

  assert.equal(executeResponse.status, 202)

  const cancelResponse = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/cancel`, {
    body: JSON.stringify({
      reason: 'User aborted',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(cancelResponse.status, 200)

  const waitRows = runtime.db.select().from(runDependencies).all()
  const toolRows = runtime.db.select().from(toolExecutions).all()
  const runRow = runtime.db.select().from(runs).get()
  const assistantMessageRow = runtime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.authorKind, 'assistant'))
    .get()
  const eventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .map((event) => event.type)

  assert.equal(waitRows[0]?.status, 'cancelled')
  assert.equal(toolRows[0]?.errorText, 'User aborted')
  assert.equal(runRow?.status, 'cancelled')
  assert.equal(assistantMessageRow?.runId, bootstrap.data.runId)
  assert.deepEqual(assistantMessageRow?.content, [
    { text: 'Need approval before I can finish.', type: 'text' },
  ])
  assert.deepEqual(
    (
      assistantMessageRow?.metadata as
        | {
            finishReason?: string
            transcript?: {
              blocks?: Array<{ type?: string }>
            }
          }
        | null
        | undefined
    )?.finishReason,
    'cancelled',
  )
  assert.deepEqual(
    (
      assistantMessageRow?.metadata as
        | {
            finishReason?: string
            transcript?: {
              blocks?: Array<{ type?: string }>
            }
          }
        | null
        | undefined
    )?.transcript?.blocks?.map((block) => block.type),
    ['tool_interaction'],
  )
  assert.equal(
    (
      runRow?.resultJson as
        | {
            assistantMessageId?: string
          }
        | null
        | undefined
    )?.assistantMessageId,
    assistantMessageRow?.id,
  )
  assert.equal(eventTypes.includes('run.cancelled'), true)
  assert.equal(eventTypes.filter((eventType) => eventType === 'message.posted').length, 2)
})

test('cancel run returns cancelling for an actively streaming root run and converges to cancelled', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  let abortReason: string | null = null
  let resolveStreamStarted: (() => void) | null = null
  const streamStarted = new Promise<void>((resolve) => {
    resolveStreamStarted = resolve
  })

  runtime.services.ai.interactions.stream = async (request: AiInteractionRequest) => {
    request.abortSignal?.addEventListener(
      'abort',
      () => {
        abortReason =
          typeof request.abortSignal?.reason === 'string'
            ? request.abortSignal.reason
            : 'Run cancelled'
      },
      { once: true },
    )
    resolveStreamStarted?.()

    return ok(
      (async function* () {
        await new Promise<void>((_, reject) => {
          request.abortSignal?.addEventListener(
            'abort',
            () => {
              reject(new Error('Generation aborted by cancellation'))
            },
            { once: true },
          )
        })
      })(),
    )
  }

  const executePromise = app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  await streamStarted

  const cancelResponse = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/cancel`, {
    body: JSON.stringify({
      reason: 'User aborted',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const cancelBody = await cancelResponse.json()
  const executeResponse = await executePromise
  const executeBody = await executeResponse.json()
  const runRow = runtime.db.select().from(runs).get()
  const assistantMessageRow = runtime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.authorKind, 'assistant'))
    .get()
  const eventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .map((event) => event.type)

  assert.equal(cancelResponse.status, 202)
  assert.equal(cancelBody.data.runId, bootstrap.data.runId)
  assert.equal(cancelBody.data.status, 'cancelling')
  assert.equal(executeResponse.status, 409)
  assert.equal(executeBody.error.type, 'conflict')
  assert.equal(runRow?.status, 'cancelled')
  assert.equal(abortReason, 'User aborted')
  assert.deepEqual(assistantMessageRow?.content, [
    {
      text: 'Cancelled: User aborted',
      type: 'text',
    },
  ])
  assert.equal(eventTypes.includes('run.cancelling'), true)
  assert.equal(eventTypes.includes('message.posted'), true)
  assert.equal(eventTypes.includes('run.cancelled'), true)
  assert.equal(runtime.services.activeRuns.get(asRunId(bootstrap.data.runId)), null)
})

test('cancel run finalizes an abandoned cancelling run when no active handle exists', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)

  runtime.db
    .update(runs)
    .set({
      resultJson: {
        cancelRequestedAt: '2026-03-31T00:00:00.000Z',
        reason: 'User aborted',
      },
      status: 'cancelling',
      updatedAt: '2026-03-31T00:00:00.000Z',
      version: 2,
    })
    .where(eq(runs.id, bootstrap.data.runId))
    .run()

  const cancelResponse = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/cancel`, {
    body: JSON.stringify({
      reason: 'User aborted',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const cancelBody = await cancelResponse.json()
  const runRow = runtime.db.select().from(runs).where(eq(runs.id, bootstrap.data.runId)).get()

  assert.equal(cancelResponse.status, 200)
  assert.equal(cancelBody.data.status, 'cancelled')
  assert.equal(runRow?.status, 'cancelled')
})

test('cancelling a running child run during a waiting tool prevents wait persistence and run.waiting', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const childRunId = 'run_child_wait_creation_race'
  const cancelRunCommand = createCancelRunCommand()
  const commandContext = createInternalCommandContext(runtime, {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  })
  let resolveToolStarted: (() => void) | null = null
  let cancelStatus: 'cancelled' | 'cancelling' | null = null
  let toolAbortReason: string | null = null
  const toolStarted = new Promise<void>((resolve) => {
    resolveToolStarted = resolve
  })
  const runStartedAt = '2026-03-31T00:10:00.000Z'

  insertChildRun(runtime, {
    parentRunId: bootstrap.data.runId,
    runId: childRunId,
    task: 'Wait creation cancellation race',
  })

  registerFunctionTool(runtime, {
    execute: async (_args, context) => {
      resolveToolStarted?.()
      toolAbortReason = await waitForAbort(context.abortSignal)
      return ok({
        kind: 'waiting' as const,
        wait: {
          description: 'Waiting for upstream approval',
          targetKind: 'external' as const,
          targetRef: 'approval_wait_creation_1',
          type: 'tool' as const,
        },
      })
    },
    name: 'await_upstream_race',
  })

  runtime.services.ai.interactions.generate = async (request) => {
    if (request.metadata?.runId !== childRunId) {
      return err({
        message: `Unexpected run ${request.metadata?.runId ?? 'unknown'}`,
        type: 'conflict',
      })
    }

    return ok<AiInteractionResponse>({
      messages: [],
      model: 'gpt-5.4',
      output: [
        {
          arguments: {},
          argumentsJson: '{}',
          callId: 'call_wait_creation_race',
          name: 'await_upstream_race',
          type: 'function_call',
        },
      ],
      outputText: '',
      provider: 'openai',
      providerRequestId: 'req_wait_creation_race',
      raw: { stub: true },
      responseId: 'resp_wait_creation_race',
      status: 'completed',
      toolCalls: [
        {
          arguments: {},
          argumentsJson: '{}',
          callId: 'call_wait_creation_race',
          name: 'await_upstream_race',
        },
      ],
      usage: null,
    })
  }

  runtime.db
    .update(runs)
    .set({
      startedAt: runStartedAt,
      status: 'running',
      updatedAt: runStartedAt,
      version: 2,
    })
    .where(eq(runs.id, childRunId))
    .run()
  runtime.db
    .update(jobs)
    .set({
      currentRunId: childRunId,
      lastHeartbeatAt: runStartedAt,
      lastSchedulerSyncAt: runStartedAt,
      statusReasonJson: {
        runId: childRunId,
      },
      status: 'running',
      updatedAt: runStartedAt,
      version: 2,
    })
    .where(eq(jobs.id, `job_${childRunId}`))
    .run()

  const currentRun = createRunRepository(runtime.db).getById(
    commandContext.tenantScope,
    asRunId(childRunId),
  )
  assert.equal(currentRun.ok, true, currentRun.ok ? undefined : currentRun.error.message)

  const executePromise = executeRunTurnLoop(
    commandContext,
    currentRun.ok ? currentRun.value : (undefined as never),
    {},
  )

  await toolStarted

  const cancelled = cancelRunCommand.execute(commandContext, asRunId(childRunId), {
    reason: 'User aborted',
  })
  assert.equal(cancelled.ok, true, cancelled.ok ? undefined : cancelled.error.message)

  if (cancelled.ok) {
    cancelStatus = cancelled.value.status
  }

  const executeResult = await executePromise

  const childRun = runtime.db
    .select()
    .from(runs)
    .all()
    .find((candidate) => candidate.id === childRunId)
  const childWaitRows = runtime.db
    .select()
    .from(runDependencies)
    .all()
    .filter((wait) => wait.runId === childRunId)
  const childToolRows = runtime.db
    .select()
    .from(toolExecutions)
    .all()
    .filter((toolExecution) => toolExecution.runId === childRunId)
  const childEventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .filter((event) => (event.payload as { runId?: string } | null)?.runId === childRunId)
    .map((event) => event.type)

  assert.equal(cancelStatus, 'cancelling')
  assert.equal(executeResult.ok, false)
  assert.equal(executeResult.ok ? null : executeResult.error.type, 'conflict')
  assert.equal(childRun?.status, 'cancelled')
  assert.equal(childWaitRows.length, 0)
  assert.equal(childToolRows[0]?.errorText, 'User aborted')
  assert.equal(toolAbortReason, 'User aborted')
  assert.equal(childEventTypes.includes('run.cancelling'), true)
  assert.equal(childEventTypes.includes('run.waiting'), false)
  assert.equal(childEventTypes.includes('run.cancelled'), true)
})

test('cancelling a running child run during active tool execution prevents another model turn', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const childRunId = 'run_child_between_turns_cancel'
  const cancelRunCommand = createCancelRunCommand()
  const commandContext = createInternalCommandContext(runtime, {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  })
  let resolveToolStarted: (() => void) | null = null
  let cancelStatus: 'cancelled' | 'cancelling' | null = null
  let toolAbortReason: string | null = null
  const toolStarted = new Promise<void>((resolve) => {
    resolveToolStarted = resolve
  })
  let generateCalls = 0
  let secondTurnStarted = false
  const runStartedAt = '2026-03-31T00:11:00.000Z'

  insertChildRun(runtime, {
    parentRunId: bootstrap.data.runId,
    runId: childRunId,
    task: 'Between-turn cancellation race',
  })

  registerFunctionTool(runtime, {
    execute: async (_args, context) => {
      resolveToolStarted?.()
      toolAbortReason = await waitForAbort(context.abortSignal)
      return ok({
        kind: 'immediate' as const,
        output: {
          status: 'done',
        },
      })
    },
    name: 'quick_tool',
  })

  runtime.services.ai.interactions.generate = async (request) => {
    if (request.metadata?.runId !== childRunId) {
      return err({
        message: `Unexpected run ${request.metadata?.runId ?? 'unknown'}`,
        type: 'conflict',
      })
    }

    generateCalls += 1

    if (generateCalls === 1) {
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_between_turns_cancel',
            name: 'quick_tool',
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_between_turns_cancel_1',
        raw: { stub: true },
        responseId: 'resp_between_turns_cancel_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_between_turns_cancel',
            name: 'quick_tool',
          },
        ],
        usage: null,
      })
    }

    secondTurnStarted = true

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'This second turn should never start.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'This second turn should never start.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'This second turn should never start.',
      provider: 'openai',
      providerRequestId: 'req_between_turns_cancel_2',
      raw: { stub: true },
      responseId: 'resp_between_turns_cancel_2',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  runtime.db
    .update(runs)
    .set({
      startedAt: runStartedAt,
      status: 'running',
      updatedAt: runStartedAt,
      version: 2,
    })
    .where(eq(runs.id, childRunId))
    .run()
  runtime.db
    .update(jobs)
    .set({
      currentRunId: childRunId,
      lastHeartbeatAt: runStartedAt,
      lastSchedulerSyncAt: runStartedAt,
      statusReasonJson: {
        runId: childRunId,
      },
      status: 'running',
      updatedAt: runStartedAt,
      version: 2,
    })
    .where(eq(jobs.id, `job_${childRunId}`))
    .run()

  const currentRun = createRunRepository(runtime.db).getById(
    commandContext.tenantScope,
    asRunId(childRunId),
  )
  assert.equal(currentRun.ok, true, currentRun.ok ? undefined : currentRun.error.message)

  const executePromise = executeRunTurnLoop(
    commandContext,
    currentRun.ok ? currentRun.value : (undefined as never),
    {},
  )

  await toolStarted

  const cancelled = cancelRunCommand.execute(commandContext, asRunId(childRunId), {
    reason: 'User aborted',
  })
  assert.equal(cancelled.ok, true, cancelled.ok ? undefined : cancelled.error.message)

  if (cancelled.ok) {
    cancelStatus = cancelled.value.status
  }

  const executeResult = await executePromise

  const childRun = runtime.db
    .select()
    .from(runs)
    .all()
    .find((candidate) => candidate.id === childRunId)
  const childMessages = runtime.db
    .select()
    .from(sessionMessages)
    .all()
    .filter((message) => message.runId === childRunId)
  const childUsageRows = runtime.db
    .select()
    .from(usageLedger)
    .all()
    .filter((entry) => entry.runId === childRunId)
  const childEventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .filter((event) => (event.payload as { runId?: string } | null)?.runId === childRunId)
    .map((event) => event.type)

  assert.equal(cancelStatus, 'cancelling')
  assert.equal(executeResult.ok, false)
  assert.equal(executeResult.ok ? null : executeResult.error.type, 'conflict')
  assert.equal(generateCalls, 1)
  assert.equal(secondTurnStarted, false)
  assert.equal(childRun?.status, 'cancelled')
  assert.equal(childMessages.length, 0)
  assert.equal(childUsageRows.length, 1)
  assert.equal(toolAbortReason, 'User aborted')
  assert.equal(childEventTypes.includes('run.completed'), false)
  assert.equal(childEventTypes.includes('run.cancelled'), true)
})

test('cancelling a running child run before atomic assistant completion leaves no late assistant artifacts', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const childRunId = 'run_child_atomic_complete_race'
  const cancelRunCommand = createCancelRunCommand()
  const commandContext = createInternalCommandContext(runtime, {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  })

  insertChildRun(runtime, {
    parentRunId: bootstrap.data.runId,
    runId: childRunId,
    task: 'Atomic assistant completion race',
  })

  runtime.services.ai.interactions.generate = async (request) => {
    if (request.metadata?.runId !== childRunId) {
      return err({
        message: `Unexpected run ${request.metadata?.runId ?? 'unknown'}`,
        type: 'conflict',
      })
    }

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Late assistant output should be dropped atomically.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Late assistant output should be dropped atomically.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Late assistant output should be dropped atomically.',
      provider: 'openai',
      providerRequestId: 'req_child_atomic_complete_race',
      raw: { stub: true },
      responseId: 'resp_child_atomic_complete_race',
      status: 'completed',
      toolCalls: [],
      usage: {
        cachedTokens: 0,
        inputTokens: 12,
        outputTokens: 8,
        reasoningTokens: 0,
        totalTokens: 20,
      },
    })
  }

  const originalTransaction = runtime.db.transaction.bind(runtime.db)
  let transactionCount = 0
  let cancelTriggered = false

  ;(
    runtime.db as unknown as {
      transaction: typeof runtime.db.transaction
    }
  ).transaction = ((callback: Parameters<typeof runtime.db.transaction>[0]) => {
    transactionCount += 1

    if (!cancelTriggered && transactionCount === 2) {
      cancelTriggered = true
      const cancelled = cancelRunCommand.execute(commandContext, childRunId, {
        reason: 'User aborted',
      })

      assert.equal(cancelled.ok, true, cancelled.ok ? undefined : cancelled.error.message)
    }

    return originalTransaction(callback)
  }) as typeof runtime.db.transaction

  try {
    const executeResponse = await app.request(`http://local/v1/runs/${childRunId}/execute`, {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    })
    const executeBody = await executeResponse.json()

    assert.equal(cancelTriggered, true)
    assert.equal(executeResponse.status, 409)
    assert.equal(executeBody.error.type, 'conflict')
  } finally {
    ;(
      runtime.db as unknown as {
        transaction: typeof runtime.db.transaction
      }
    ).transaction = originalTransaction
  }

  const childRun = runtime.db
    .select()
    .from(runs)
    .all()
    .find((candidate) => candidate.id === childRunId)
  const childItems = runtime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.runId === childRunId)
  const childUsageRows = runtime.db
    .select()
    .from(usageLedger)
    .all()
    .filter((entry) => entry.runId === childRunId)
  const childMessages = runtime.db
    .select()
    .from(sessionMessages)
    .all()
    .filter((message) => message.runId === childRunId)
  const childEventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .filter((event) => (event.payload as { runId?: string } | null)?.runId === childRunId)
    .map((event) => event.type)

  assert.equal(childRun?.status, 'cancelled')
  assert.equal(childItems.length, 0)
  assert.equal(childUsageRows.length, 0)
  assert.equal(childMessages.length, 0)
  assert.equal(childEventTypes.includes('run.completed'), false)
  assert.equal(childEventTypes.includes('run.cancelled'), true)
})

test('cancelling a running child run drops late assistant persistence after model generation finishes', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const childRunId = 'run_child_generation_race'
  const cancelRunCommand = createCancelRunCommand()
  const commandContext = createInternalCommandContext(runtime, {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  })
  const runStartedAt = '2026-03-31T00:12:00.000Z'

  insertChildRun(runtime, {
    parentRunId: bootstrap.data.runId,
    runId: childRunId,
    task: 'Child generation race',
  })

  let resolveGenerationStarted: (() => void) | null = null
  const generationStarted = new Promise<void>((resolve) => {
    resolveGenerationStarted = resolve
  })
  let releaseGeneration: (() => void) | null = null
  const generationGate = new Promise<void>((resolve) => {
    releaseGeneration = resolve
  })

  runtime.services.ai.interactions.generate = async (request) => {
    if (request.metadata?.runId !== childRunId) {
      return err({
        message: `Unexpected run ${request.metadata?.runId ?? 'unknown'}`,
        type: 'conflict',
      })
    }

    resolveGenerationStarted?.()
    await generationGate

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Late child output should be dropped.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Late child output should be dropped.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Late child output should be dropped.',
      provider: 'openai',
      providerRequestId: 'req_child_generation_race',
      raw: { stub: true },
      responseId: 'resp_child_generation_race',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  runtime.db
    .update(runs)
    .set({
      startedAt: runStartedAt,
      status: 'running',
      updatedAt: runStartedAt,
      version: 2,
    })
    .where(eq(runs.id, childRunId))
    .run()
  runtime.db
    .update(jobs)
    .set({
      currentRunId: childRunId,
      lastHeartbeatAt: runStartedAt,
      lastSchedulerSyncAt: runStartedAt,
      statusReasonJson: {
        runId: childRunId,
      },
      status: 'running',
      updatedAt: runStartedAt,
      version: 2,
    })
    .where(eq(jobs.id, `job_${childRunId}`))
    .run()

  const currentRun = createRunRepository(runtime.db).getById(
    commandContext.tenantScope,
    asRunId(childRunId),
  )
  assert.equal(currentRun.ok, true, currentRun.ok ? undefined : currentRun.error.message)

  const executePromise = executeRunTurnLoop(
    commandContext,
    currentRun.ok ? currentRun.value : (undefined as never),
    {},
  )

  await generationStarted

  const cancelled = cancelRunCommand.execute(commandContext, asRunId(childRunId), {
    reason: 'User aborted',
  })
  assert.equal(cancelled.ok, true, cancelled.ok ? undefined : cancelled.error.message)
  assert.equal(cancelled.ok ? cancelled.value.status : null, 'cancelling')

  releaseGeneration?.()

  const executeResult = await executePromise

  assert.equal(executeResult.ok, false)
  assert.equal(executeResult.ok ? null : executeResult.error.type, 'conflict')

  const childRun = runtime.db
    .select()
    .from(runs)
    .all()
    .find((candidate) => candidate.id === childRunId)
  const childItems = runtime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.runId === childRunId)
  const childUsageRows = runtime.db
    .select()
    .from(usageLedger)
    .all()
    .filter((entry) => entry.runId === childRunId)
  const childMessages = runtime.db
    .select()
    .from(sessionMessages)
    .all()
    .filter((message) => message.runId === childRunId)
  const childEventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .filter((event) => (event.payload as { runId?: string } | null)?.runId === childRunId)
    .map((event) => event.type)

  assert.equal(childRun?.status, 'cancelled')
  assert.equal(childItems.length, 0)
  assert.equal(childUsageRows.length, 0)
  assert.equal(childMessages.length, 0)
  assert.equal(childEventTypes.includes('run.completed'), false)
  assert.equal(childEventTypes.includes('run.cancelled'), true)
})

test('cancelling a running child run converts a late provider failure into the durable cancelled outcome', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const childRunId = 'run_child_failure_race'

  insertChildRun(runtime, {
    parentRunId: bootstrap.data.runId,
    runId: childRunId,
    task: 'Child provider failure race',
  })

  let resolveGenerationStarted: (() => void) | null = null
  const generationStarted = new Promise<void>((resolve) => {
    resolveGenerationStarted = resolve
  })
  let releaseGeneration: (() => void) | null = null
  const generationGate = new Promise<void>((resolve) => {
    releaseGeneration = resolve
  })

  runtime.services.ai.interactions.generate = async (request) => {
    if (request.metadata?.runId !== childRunId) {
      return err({
        message: `Unexpected run ${request.metadata?.runId ?? 'unknown'}`,
        type: 'conflict',
      })
    }

    resolveGenerationStarted?.()
    await generationGate

    return err({
      message: 'OpenAI provider error: upstream unavailable',
      provider: 'openai',
      type: 'provider',
    })
  }

  const executePromise = app.request(`http://local/v1/runs/${childRunId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  await generationStarted

  const cancelResponse = await app.request(`http://local/v1/runs/${childRunId}/cancel`, {
    body: JSON.stringify({
      reason: 'User aborted',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const cancelBody = await cancelResponse.json()

  assert.equal(cancelResponse.status, 202)
  assert.equal(cancelBody.data.status, 'cancelling')

  releaseGeneration?.()

  const executeResponse = await executePromise
  const executeBody = await executeResponse.json()

  assert.equal(executeResponse.status, 409)
  assert.equal(executeBody.error.type, 'conflict')
  assert.equal(executeBody.error.message, `run ${childRunId} was cancelled`)

  const childRun = runtime.db
    .select()
    .from(runs)
    .all()
    .find((candidate) => candidate.id === childRunId)
  const childEventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .filter((event) => (event.payload as { runId?: string } | null)?.runId === childRunId)
    .map((event) => event.type)

  assert.equal(childRun?.status, 'cancelled')
  assert.equal(childEventTypes.includes('run.failed'), false)
  assert.equal(childEventTypes.includes('run.cancelled'), true)
})

test('cancelling a running child run fails unfinished tool executions and ignores late tool results', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const childRunId = 'run_child_tool_race'

  insertChildRun(runtime, {
    parentRunId: bootstrap.data.runId,
    runId: childRunId,
    task: 'Child tool race',
  })

  let resolveToolStarted: (() => void) | null = null
  const toolStarted = new Promise<void>((resolve) => {
    resolveToolStarted = resolve
  })
  let releaseTool: (() => void) | null = null
  const toolGate = new Promise<void>((resolve) => {
    releaseTool = resolve
  })

  registerFunctionTool(runtime, {
    execute: async () => {
      resolveToolStarted?.()
      await toolGate

      return ok({
        kind: 'immediate' as const,
        output: {
          answer: 'Late tool output should be dropped.',
        },
      })
    },
    name: 'slow_tool',
  })

  runtime.services.ai.interactions.generate = async (request) => {
    if (request.metadata?.runId !== childRunId) {
      return err({
        message: `Unexpected run ${request.metadata?.runId ?? 'unknown'}`,
        type: 'conflict',
      })
    }

    return ok<AiInteractionResponse>({
      messages: [],
      model: 'gpt-5.4',
      output: [
        {
          arguments: {},
          argumentsJson: '{}',
          callId: 'call_child_tool_race',
          name: 'slow_tool',
          type: 'function_call',
        },
      ],
      outputText: '',
      provider: 'openai',
      providerRequestId: 'req_child_tool_race',
      raw: { stub: true },
      responseId: 'resp_child_tool_race',
      status: 'completed',
      toolCalls: [
        {
          arguments: {},
          argumentsJson: '{}',
          callId: 'call_child_tool_race',
          name: 'slow_tool',
        },
      ],
      usage: null,
    })
  }

  const executePromise = app.request(`http://local/v1/runs/${childRunId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  await toolStarted

  const cancelResponse = await app.request(`http://local/v1/runs/${childRunId}/cancel`, {
    body: JSON.stringify({
      reason: 'User aborted',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const cancelBody = await cancelResponse.json()

  assert.equal(cancelResponse.status, 202)
  assert.equal(cancelBody.data.status, 'cancelling')

  releaseTool?.()

  const executeResponse = await executePromise
  const executeBody = await executeResponse.json()

  assert.equal(executeResponse.status, 409)
  assert.equal(executeBody.error.type, 'conflict')

  const childRun = runtime.db
    .select()
    .from(runs)
    .all()
    .find((candidate) => candidate.id === childRunId)
  const childToolRows = runtime.db
    .select()
    .from(toolExecutions)
    .all()
    .filter((toolExecution) => toolExecution.runId === childRunId)
  const childItems = runtime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.runId === childRunId)
  const childEventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .filter((event) => (event.payload as { runId?: string } | null)?.runId === childRunId)
    .map((event) => event.type)

  assert.equal(childRun?.status, 'cancelled')
  assert.equal(childToolRows.length, 1)
  assert.equal(childToolRows[0]?.errorText, 'User aborted')
  assert.equal(childToolRows[0]?.completedAt === null, false)
  assert.equal(childItems.filter((item) => item.type === 'function_call').length, 1)
  assert.equal(childItems.filter((item) => item.type === 'function_call_output').length, 0)
  assert.equal(childEventTypes.filter((type) => type === 'tool.failed').length, 1)
  assert.equal(childEventTypes.includes('tool.completed'), false)
  assert.equal(childEventTypes.includes('run.cancelled'), true)
})
