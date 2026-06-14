import assert from 'node:assert/strict'
import { test } from 'vitest'
import { agentRevisions, agentSubagentLinks, agents, domainEvents, runs } from '../src/db/schema'
import type { AiInteractionRequest, AiInteractionResponse } from '../src/domain/ai/types'
import { ok } from '../src/shared/result'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const parseSse = (body: string) => {
  return body
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => {
      const event = chunk
        .split('\n')
        .find((line) => line.startsWith('event: '))
        ?.slice('event: '.length)
      const id = chunk
        .split('\n')
        .find((line) => line.startsWith('id: '))
        ?.slice('id: '.length)
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '))

      return {
        data: dataLine ? JSON.parse(dataLine.slice('data: '.length)) : null,
        event,
        id,
      }
    })
}

const wireStreamingStub = (runtime: ReturnType<typeof createTestHarness>['runtime']) => {
  runtime.services.ai.interactions.stream = async (request) => {
    const generated = await runtime.services.ai.interactions.generate(request)

    if (!generated.ok) {
      return generated
    }

    return ok(
      (async function* () {
        yield {
          model: generated.value.model,
          provider: generated.value.provider,
          responseId: generated.value.responseId,
          type: 'response.started' as const,
        }

        if (generated.value.outputText.length > 0) {
          yield {
            delta: generated.value.outputText,
            type: 'text.delta' as const,
          }
        }

        for (const toolCall of generated.value.toolCalls) {
          yield {
            call: toolCall,
            type: 'tool.call' as const,
          }
        }

        yield {
          response: generated.value,
          type: 'response.completed' as const,
        }
      })(),
    )
  }
}

const seedActiveAgent = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    accountId: string
    agentId: string
    modelAlias: string
    name: string
    nativeTools?: string[]
    profile: string
    provider: 'openai' | 'google'
    revisionId: string
    slug: string
    tenantId: string
  },
) => {
  const createdAt = '2026-03-30T05:00:00.000Z'

  runtime.db
    .insert(agents)
    .values({
      activeRevisionId: input.revisionId,
      archivedAt: null,
      baseAgentId: null,
      createdAt,
      createdByAccountId: input.accountId,
      id: input.agentId,
      kind: 'primary',
      name: input.name,
      ownerAccountId: input.accountId,
      slug: input.slug,
      status: 'active',
      tenantId: input.tenantId,
      updatedAt: createdAt,
      visibility: 'account_private',
    })
    .run()

  runtime.db
    .insert(agentRevisions)
    .values({
      agentId: input.agentId,
      checksumSha256: `${input.revisionId}_checksum`,
      createdAt,
      createdByAccountId: input.accountId,
      frontmatterJson: {
        agent_id: input.agentId,
        kind: 'primary',
        name: input.name,
        revision_id: input.revisionId,
        schema: 'agent/v1',
        slug: input.slug,
        visibility: 'account_private',
      },
      gardenFocusJson: {},
      id: input.revisionId,
      instructionsMd: `${input.name} instructions`,
      kernelPolicyJson: {},
      memoryPolicyJson: {},
      modelConfigJson: {
        modelAlias: input.modelAlias,
        provider: input.provider,
      },
      resolvedConfigJson: {},
      sourceMarkdown: `---\nname: ${input.name}\nschema: agent/v1\nslug: ${input.slug}\nvisibility: account_private\nkind: primary\n---\n${input.name} instructions`,
      tenantId: input.tenantId,
      toolProfileId: `tpf_${input.profile}`,
      toolPolicyJson: {
        toolProfileId: `tpf_${input.profile}`,
        ...(input.nativeTools ? { native: input.nativeTools } : {}),
      },
      version: 1,
      sandboxPolicyJson: {},
      workspacePolicyJson: {},
    })
    .run()
}

const seedSubagentLink = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    alias: string
    childAgentId: string
    id: string
    parentAgentRevisionId: string
    tenantId: string
  },
) => {
  runtime.db
    .insert(agentSubagentLinks)
    .values({
      alias: input.alias,
      childAgentId: input.childAgentId,
      createdAt: '2026-03-30T05:00:00.000Z',
      delegationMode: 'async_join',
      id: input.id,
      parentAgentRevisionId: input.parentAgentRevisionId,
      position: 0,
      tenantId: input.tenantId,
    })
    .run()
}

const bootstrapSession = async (
  app: ReturnType<typeof createTestHarness>['app'],
  headers: Record<string, string>,
  agentId: string,
) => {
  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Coordinate the multiagent work',
      target: {
        agentId,
        kind: 'agent',
      },
      title: 'Event stream delegation test',
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

const drainWorker = async (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  maxIterations = 20,
) => {
  for (let index = 0; index < maxIterations; index += 1) {
    const worked = await runtime.services.multiagent.processAvailableDecisions()

    if (!worked) {
      break
    }
  }
}

const buildDelegateResponse = (input: {
  instructions?: string
  task: string
}): AiInteractionResponse => ({
  messages: [],
  model: 'gpt-5.4',
  output: [
    {
      arguments: {
        agentAlias: 'researcher',
        ...(input.instructions ? { instructions: input.instructions } : {}),
        task: input.task,
      },
      argumentsJson: JSON.stringify({
        agentAlias: 'researcher',
        ...(input.instructions ? { instructions: input.instructions } : {}),
        task: input.task,
      }),
      callId: 'call_delegate_1',
      name: 'delegate_to_agent',
      type: 'function_call',
    },
  ],
  outputText: '',
  provider: 'openai',
  providerRequestId: 'req_delegate_1',
  raw: { stub: true },
  responseId: 'resp_delegate_1',
  status: 'completed',
  toolCalls: [
    {
      arguments: {
        agentAlias: 'researcher',
        ...(input.instructions ? { instructions: input.instructions } : {}),
        task: input.task,
      },
      argumentsJson: JSON.stringify({
        agentAlias: 'researcher',
        ...(input.instructions ? { instructions: input.instructions } : {}),
        task: input.task,
      }),
      callId: 'call_delegate_1',
      name: 'delegate_to_agent',
    },
  ],
  usage: null,
})

const buildToolCallResponse = (): AiInteractionResponse => ({
  messages: [],
  model: 'gpt-5.4',
  output: [
    {
      arguments: {},
      argumentsJson: '{}',
      callId: 'call_lookup_1',
      name: 'lookup_status',
      type: 'function_call',
    },
  ],
  outputText: '',
  provider: 'openai',
  providerRequestId: 'req_lookup_1',
  raw: { stub: true },
  responseId: 'resp_lookup_1',
  status: 'completed',
  toolCalls: [
    {
      arguments: {},
      argumentsJson: '{}',
      callId: 'call_lookup_1',
      name: 'lookup_status',
    },
  ],
  usage: null,
})

const buildAssistantResponse = (text: string): AiInteractionResponse => ({
  messages: [
    {
      content: [{ text, type: 'text' }],
      role: 'assistant',
    },
  ],
  model: 'gpt-5.4',
  output: [
    {
      content: [{ text, type: 'text' }],
      role: 'assistant',
      type: 'message',
    },
  ],
  outputText: text,
  provider: 'openai',
  providerRequestId: 'req_text',
  raw: { stub: true },
  responseId: 'resp_text',
  status: 'completed',
  toolCalls: [],
  usage: null,
})

test('event stream replays durable domain events by default and can include telemetry on demand', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const bootstrapResponse = await app.request('http://local/v1/sessions/bootstrap', {
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
  const bootstrap = await bootstrapResponse.json()
  const bootstrapCursor =
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .sort((left, right) => left.eventNo - right.eventNo)
      .at(-1)?.eventNo ?? 0

  runtime.services.ai.interactions.generate = async () =>
    ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Start with run execution.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Start with run execution.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Start with run execution.',
      provider: 'openai',
      providerRequestId: 'req_sse_1',
      raw: { stub: true },
      responseId: 'resp_sse_1',
      status: 'completed',
      toolCalls: [],
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

  assert.equal(executeResponse.status, 200)

  const sseResponse = await app.request(
    `http://local/v1/events/stream?follow=false&cursor=${bootstrapCursor}&threadId=${bootstrap.data.threadId}`,
    {
      headers,
      method: 'GET',
    },
  )

  assert.equal(sseResponse.status, 200)
  assert.match(sseResponse.headers.get('content-type') ?? '', /text\/event-stream/)

  const events = parseSse(await sseResponse.text())

  assert.deepEqual(
    events.map((event) => event.event),
    ['run.started', 'message.posted', 'run.completed', 'job.completed'],
  )
  assert.deepEqual(
    events.map((event) => event.id),
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.eventNo > bootstrapCursor && event.category === 'domain')
      .map((event) => String(event.eventNo)),
  )
  assert.equal(events[0]?.data.payload.threadId, bootstrap.data.threadId)
  assert.deepEqual(
    events.map((event) => event.data?.category),
    ['domain', 'domain', 'domain', 'domain'],
  )

  const runScopedResponse = await app.request(
    `http://local/v1/events/stream?follow=false&cursor=${bootstrapCursor}&runId=${bootstrap.data.runId}`,
    {
      headers,
      method: 'GET',
    },
  )

  assert.equal(runScopedResponse.status, 200)

  const runScopedEvents = parseSse(await runScopedResponse.text())

  assert.deepEqual(
    runScopedEvents.map((event) => event.event),
    ['run.started', 'message.posted', 'run.completed', 'job.completed'],
  )

  const allSseResponse = await app.request(
    `http://local/v1/events/stream?follow=false&cursor=${bootstrapCursor}&threadId=${bootstrap.data.threadId}&category=all`,
    {
      headers,
      method: 'GET',
    },
  )

  assert.equal(allSseResponse.status, 200)

  const allEvents = parseSse(await allSseResponse.text())

  assert.deepEqual(
    allEvents.map((event) => event.event),
    [
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
    ],
  )
  assert.equal(
    allEvents.some((event) => event.data?.category === 'telemetry'),
    true,
  )
})

test('all-category thread event streams include delegated child activity without binding child messages to the parent thread', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  wireStreamingStub(runtime)

  runtime.services.tools.register({
    description: 'Test lookup tool',
    domain: 'native',
    execute: async () =>
      ok({
        kind: 'immediate' as const,
        output: {
          status: 'ready',
        },
      }),
    inputSchema: {
      additionalProperties: false,
      properties: {},
      required: [],
      type: 'object',
    },
    name: 'lookup_status',
  })

  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_orchestrator',
    modelAlias: 'gpt-5.4',
    name: 'Orchestrator',
    nativeTools: ['delegate_to_agent'],
    profile: 'orchestrator',
    provider: 'openai',
    revisionId: 'agr_orchestrator_v1',
    slug: 'orchestrator',
    tenantId,
  })
  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_researcher',
    modelAlias: 'gpt-5.4',
    name: 'Researcher',
    nativeTools: ['lookup_status'],
    profile: 'research',
    provider: 'openai',
    revisionId: 'agr_researcher_v1',
    slug: 'researcher',
    tenantId,
  })
  seedSubagentLink(runtime, {
    alias: 'researcher',
    childAgentId: 'agt_researcher',
    id: 'asl_orchestrator_researcher',
    parentAgentRevisionId: 'agr_orchestrator_v1',
    tenantId,
  })

  const bootstrap = await bootstrapSession(app, headers, 'agt_orchestrator')
  const bootstrapCursor =
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .sort((left, right) => left.eventNo - right.eventNo)
      .at(-1)?.eventNo ?? 0
  let parentTurnCount = 0

  runtime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    const runId = request.metadata?.runId

    if (runId === bootstrap.data.runId && parentTurnCount === 0) {
      parentTurnCount += 1
      return ok(
        buildDelegateResponse({
          instructions: 'Use the lookup tool and then answer briefly.',
          task: 'Inspect child-thread event visibility',
        }),
      )
    }

    if (runId !== bootstrap.data.runId) {
      if (request.messages.at(-1)?.role === 'tool') {
        return ok(buildAssistantResponse('Child run streamed its answer after using a tool.'))
      }

      return ok(buildToolCallResponse())
    }

    assert.equal(request.messages.at(-1)?.role, 'tool')
    return ok(buildAssistantResponse('Parent resumed after delegated child work completed.'))
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

  assert.equal(executeResponse.status, 202)

  await drainWorker(runtime)

  const childRun = runtime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id !== bootstrap.data.runId)

  assert.ok(childRun)
  assert.equal(childRun?.threadId, null)

  const sseResponse = await app.request(
    `http://local/v1/events/stream?follow=false&cursor=${bootstrapCursor}&threadId=${bootstrap.data.threadId}&category=all`,
    {
      headers,
      method: 'GET',
    },
  )

  assert.equal(sseResponse.status, 200)

  const events = parseSse(await sseResponse.text())
  const childEvents = events.filter((event) => event.data?.payload?.runId === childRun?.id)

  assert.equal(childEvents.length > 0, true)
  assert.equal(
    childEvents.every((event) => event.data?.payload?.threadId === bootstrap.data.threadId),
    true,
  )
  assert.equal(
    childEvents.some((event) => event.event === 'tool.called'),
    true,
  )
  assert.equal(
    childEvents.some((event) => event.event === 'tool.completed'),
    true,
  )
  assert.equal(
    childEvents.some((event) => event.event === 'stream.delta'),
    true,
  )
  assert.equal(
    childEvents.some((event) => event.event === 'stream.done'),
    true,
  )
  assert.equal(
    childEvents.some((event) => event.event === 'generation.completed'),
    true,
  )
  assert.equal(
    childEvents.some((event) => event.event === 'message.posted'),
    false,
  )
})
