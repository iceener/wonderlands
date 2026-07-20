import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'
import {
  accountPreferences,
  agentRevisions,
  agentSubagentLinks,
  agents,
  domainEvents,
  runs,
  toolProfiles,
} from '../src/db/schema'
import type { AiInteractionRequest, AiInteractionResponse } from '../src/domain/ai/types'
import { ok } from '../src/shared/result'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { assertAcceptedThreadInteraction } from './helpers/assert-accepted-thread-interaction'
import { createTestHarness } from './helpers/create-test-app'

const seedActiveAgent = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    accountId: string
    agentId: string
    description?: string
    modelAlias: string
    name: string
    nativeTools?: string[]
    provider: 'openai' | 'google'
    reasoning: Record<string, unknown> | null
    revisionId: string
    slug: string
    tenantId?: string
    toolProfileId?: string | null
  },
) => {
  const tenantId = input.tenantId ?? 'ten_test'
  const createdAt = '2026-03-30T05:00:00.000Z'

  if (input.toolProfileId) {
    runtime.db
      .insert(toolProfiles)
      .values({
        accountId: input.accountId,
        createdAt,
        id: input.toolProfileId,
        name: `${input.name} tools`,
        scope: 'account_private',
        status: 'active',
        tenantId,
        updatedAt: createdAt,
      })
      .onConflictDoNothing()
      .run()
  }

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
      tenantId,
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
        ...(input.description ? { description: input.description } : {}),
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
        ...(input.reasoning ? { reasoning: input.reasoning } : {}),
      },
      resolvedConfigJson: {},
      sourceMarkdown: `---\nname: ${input.name}\n${input.description ? `description: ${input.description}\n` : ''}schema: agent/v1\nslug: ${input.slug}\nvisibility: account_private\nkind: primary\n---\n${input.name} instructions`,
      tenantId,
      toolProfileId: input.toolProfileId ?? null,
      toolPolicyJson: {
        ...(input.toolProfileId
          ? {
              toolProfileId: input.toolProfileId,
            }
          : {}),
        ...(input.nativeTools?.length
          ? {
              native: input.nativeTools,
            }
          : {}),
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
    delegationMode: 'async_join'
    id: string
    parentAgentRevisionId: string
    tenantId?: string
  },
) => {
  runtime.db
    .insert(agentSubagentLinks)
    .values({
      alias: input.alias,
      childAgentId: input.childAgentId,
      createdAt: '2026-03-30T05:00:00.000Z',
      delegationMode: input.delegationMode,
      id: input.id,
      parentAgentRevisionId: input.parentAgentRevisionId,
      position: 0,
      tenantId: input.tenantId ?? 'ten_test',
    })
    .run()
}

test('bootstrap session binds the root run to an explicit active agent revision', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers } = seedApiKeyAuth(runtime)

  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_research',
    modelAlias: 'gpt-5.4',
    name: 'Researcher',
    provider: 'openai',
    reasoning: {
      effort: 'high',
    },
    revisionId: 'agr_research_v1',
    slug: 'researcher',
    toolProfileId: 'tpf_research',
  })

  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Plan the research work',
      target: {
        agentId: 'agt_research',
        kind: 'agent',
      },
      title: 'Research session',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const body = await response.json()

  assert.equal(response.status, 201)
  assert.equal(body.ok, true)

  const runRow = runtime.db.select().from(runs).where(eq(runs.id, body.data.runId)).get()

  assert.equal(runRow?.agentId, 'agt_research')
  assert.equal(runRow?.agentRevisionId, 'agr_research_v1')
  assert.equal(runRow?.toolProfileId, 'tpf_research')
  assert.deepEqual(runRow?.configSnapshot, {
    apiBasePath: '/api',
    model: null,
    modelAlias: 'gpt-5.4',
    provider: 'openai',
    reasoning: {
      effort: 'high',
    },
    version: 'v1',
  })
})

test('bootstrap session applies an explicit model without retaining a conflicting agent alias', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers } = seedApiKeyAuth(runtime)

  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_alice',
    modelAlias: 'gpt-5.6',
    name: 'Alice',
    provider: 'openai',
    reasoning: {
      effort: 'high',
    },
    revisionId: 'agr_alice_v1',
    slug: 'alice',
  })

  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Use an explicit model for this run',
      model: 'gpt-5.4',
      provider: 'openai',
      target: {
        agentId: 'agt_alice',
        kind: 'agent',
      },
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const body = await response.json()

  assert.equal(response.status, 201)
  assert.equal(body.ok, true)

  const runRow = runtime.db.select().from(runs).where(eq(runs.id, body.data.runId)).get()

  assert.deepEqual(runRow?.configSnapshot, {
    apiBasePath: '/api',
    model: 'gpt-5.4',
    modelAlias: null,
    provider: 'openai',
    reasoning: {
      effort: 'high',
    },
    version: 'v1',
  })
})

test('thread interaction falls back to the current account default agent when target is omitted', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  let capturedRequest: AiInteractionRequest | null = null

  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_writer',
    modelAlias: 'gemini-2.5-pro',
    name: 'Writer',
    provider: 'google',
    reasoning: {
      effort: 'medium',
    },
    revisionId: 'agr_writer_v1',
    slug: 'writer',
    toolProfileId: 'tpf_writer',
  })
  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_researcher',
    description: 'Research specialist for source gathering and verification.',
    modelAlias: 'gpt-5.4',
    name: 'Researcher',
    nativeTools: ['web_search'],
    provider: 'openai',
    reasoning: null,
    revisionId: 'agr_researcher_v1',
    slug: 'researcher',
    toolProfileId: 'tpf_research',
  })
  seedSubagentLink(runtime, {
    alias: 'researcher',
    childAgentId: 'agt_researcher',
    delegationMode: 'async_join',
    id: 'asl_writer_researcher',
    parentAgentRevisionId: 'agr_writer_v1',
    tenantId,
  })

  runtime.db
    .update(accountPreferences)
    .set({
      defaultAgentId: 'agt_writer',
      defaultTargetKind: 'agent',
      updatedAt: '2026-03-30T05:00:00.000Z',
    })
    .where(eq(accountPreferences.accountId, accountId))
    .run()

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequest = request

    return ok({
      messages: [
        {
          content: [{ text: 'Draft ready.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gemini-2.5-pro',
      output: [
        {
          content: [{ text: 'Draft ready.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Draft ready.',
      provider: 'google',
      providerRequestId: 'req_google_writer',
      raw: { stub: true },
      responseId: 'resp_google_writer',
      status: 'completed',
      toolCalls: [],
      usage: {
        cachedTokens: 0,
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 5,
        totalTokens: 120,
      },
    } satisfies AiInteractionResponse)
  }

  const sessionResponse = await app.request('http://local/v1/sessions', {
    body: JSON.stringify({
      title: 'Drafting',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const sessionBody = await sessionResponse.json()

  const threadResponse = await app.request(
    `http://local/v1/sessions/${sessionBody.data.id}/threads`,
    {
      body: JSON.stringify({
        title: 'Main thread',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const threadBody = await threadResponse.json()

  const interactionResponse = await app.request(
    `http://local/v1/threads/${threadBody.data.id}/interactions`,
    {
      body: JSON.stringify({
        text: 'Draft the first outline',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const interactionBody = await interactionResponse.json()

  const interactionRunId = assertAcceptedThreadInteraction(interactionResponse, interactionBody)
  const executeResponse = await app.request(`http://local/v1/runs/${interactionRunId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(executeResponse.status, 200)

  const runRow = runtime.db.select().from(runs).where(eq(runs.id, interactionRunId)).get()

  assert.equal(runRow?.agentId, 'agt_writer')
  assert.equal(runRow?.agentRevisionId, 'agr_writer_v1')
  assert.equal(runRow?.toolProfileId, 'tpf_writer')
  assert.deepEqual(runRow?.configSnapshot, {
    apiBasePath: '/api',
    maxOutputTokens: null,
    model: null,
    modelAlias: 'gemini-2.5-pro',
    provider: 'google',
    reasoning: {
      effort: 'medium',
    },
    temperature: null,
    version: 'v1',
  })
  assert.ok(
    capturedRequest?.messages.some(
      (message) =>
        message.role === 'developer' &&
        message.content.some(
          (part) =>
            part.type === 'text' &&
            part.text.includes('Writer instructions') &&
            part.text.includes(
              'Allowed subagents for this run. Use the alias value as agentAlias when calling delegate_to_agent.',
            ) &&
            part.text.includes('- alias: researcher') &&
            part.text.includes(
              'description: Research specialist for source gathering and verification.',
            ) &&
            part.text.includes('tools: web_search'),
        ),
    ),
  )

  const eventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .slice()
    .sort((left, right) => left.eventNo - right.eventNo)
    .map((event) => event.type)

  assert.equal(eventTypes.includes('workspace.created'), true)
  assert.equal(eventTypes.includes('workspace.resolved'), true)
  assert.equal(eventTypes.includes('run.created'), true)
})

test('thread interaction omits deleted subagents from the agent profile message', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  let capturedRequest: AiInteractionRequest | null = null

  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_writer',
    modelAlias: 'gpt-5.4',
    name: 'Writer',
    nativeTools: ['delegate_to_agent'],
    provider: 'openai',
    reasoning: {
      effort: 'medium',
    },
    revisionId: 'agr_writer_v1',
    slug: 'writer',
    toolProfileId: 'tpf_writer',
  })

  runtime.db
    .insert(agents)
    .values({
      activeRevisionId: null,
      archivedAt: '2026-03-30T05:05:00.000Z',
      baseAgentId: null,
      createdAt: '2026-03-30T05:00:00.000Z',
      createdByAccountId: accountId,
      id: 'agt_deleted_researcher',
      kind: 'specialist',
      name: 'Researcher',
      ownerAccountId: accountId,
      slug: 'researcher',
      status: 'deleted',
      tenantId,
      updatedAt: '2026-03-30T05:05:00.000Z',
      visibility: 'account_private',
    })
    .run()

  seedSubagentLink(runtime, {
    alias: 'researcher',
    childAgentId: 'agt_deleted_researcher',
    delegationMode: 'async_join',
    id: 'asl_writer_deleted_researcher',
    parentAgentRevisionId: 'agr_writer_v1',
    tenantId,
  })

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequest = request
    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Drafting the outline.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Drafting the outline.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Drafting the outline.',
      provider: 'openai',
      providerRequestId: 'req_deleted_subagent',
      raw: { stub: true },
      responseId: 'resp_deleted_subagent',
      status: 'completed',
    })
  }

  const bootstrapResponse = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Draft the first outline',
      target: {
        agentId: 'agt_writer',
        kind: 'agent',
      },
      title: 'Writer session',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const bootstrapBody = await bootstrapResponse.json()

  assert.equal(bootstrapResponse.status, 201)
  assert.equal(bootstrapBody.ok, true)

  const profileMessage = capturedRequest?.messages.find(
    (message) =>
      message.role === 'developer' &&
      message.content.some(
        (part) =>
          part.type === 'text' &&
          part.text.includes('Allowed subagents for this run. Use the alias value as agentAlias'),
      ),
  )

  assert.equal(profileMessage, undefined)
})
