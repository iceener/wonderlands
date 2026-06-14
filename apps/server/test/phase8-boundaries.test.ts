import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createExecuteRunCommand } from '../src/application/commands/execute-run'
import { createInternalCommandContext } from '../src/application/commands/internal-command-context'
import {
  agentRevisions,
  agentSubagentLinks,
  agents,
  contextSummaries,
  fileLinks,
  files,
  items,
  mcpToolAssignments,
  memoryRecords,
  runs,
  toolProfiles,
} from '../src/db/schema'
import type { AiInteractionRequest, AiInteractionResponse } from '../src/domain/ai/types'
import type { ToolSpec } from '../src/domain/tooling/tool-registry'
import { ok } from '../src/shared/result'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const seedActiveAgent = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    accountId: string
    agentId: string
    modelAlias: string
    name: string
    nativeTools?: string[]
    provider: 'openai' | 'google'
    reasoning?: Record<string, unknown> | null
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
      sourceMarkdown: `---\nname: ${input.name}\nschema: agent/v1\nslug: ${input.slug}\nvisibility: account_private\nkind: primary\n---\n${input.name} instructions`,
      tenantId,
      toolProfileId: input.toolProfileId ?? null,
      toolPolicyJson: {
        ...(input.toolProfileId ? { toolProfileId: input.toolProfileId } : {}),
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
    tenantId?: string
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
      tenantId: input.tenantId ?? 'ten_test',
    })
    .run()
}

const assignMcpToolToProfile = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    runtimeName: string
    serverId: string
    tenantId?: string
    toolProfileId: string
  },
) => {
  const createdAt = '2026-03-30T05:00:00.000Z'

  runtime.db
    .insert(mcpToolAssignments)
    .values({
      createdAt,
      id: `mta_${input.toolProfileId}_${input.runtimeName}`,
      requiresConfirmation: false,
      runtimeName: input.runtimeName,
      serverId: input.serverId,
      tenantId: input.tenantId ?? 'ten_test',
      toolProfileId: input.toolProfileId,
      updatedAt: createdAt,
    })
    .onConflictDoNothing()
    .run()
}

const bootstrapSession = async (
  app: ReturnType<typeof createTestHarness>['app'],
  headers: Record<string, string>,
  agentId: string,
  options: {
    execute?: boolean
  } = {},
) => {
  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      ...(options.execute === true ? { execute: true } : {}),
      initialMessage: 'Coordinate the next slice',
      target: {
        agentId,
        kind: 'agent',
      },
      title: 'Phase 8 boundary test',
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

const executeRun = async (
  app: ReturnType<typeof createTestHarness>['app'],
  headers: Record<string, string>,
  runId: string,
) => {
  const response = await app.request(`http://local/v1/runs/${runId}/execute`, {
    body: JSON.stringify({}),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  return {
    body: await response.json(),
    response,
  }
}

const storeLinkedFile = async (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    accountId: string
    body: string
    createdByRunId?: string | null
    fileId: string
    filename: string
    linkType: 'message' | 'run' | 'session'
    mimeType?: string
    targetId: string
    tenantId: string
  },
) => {
  const storageKey = `${input.tenantId}/${input.fileId}`
  const stored = await runtime.services.files.blobStore.put({
    data: Buffer.from(input.body),
    storageKey,
  })

  assert.equal(stored.ok, true)

  runtime.db
    .insert(files)
    .values({
      accessScope: 'session_local',
      checksumSha256: null,
      createdAt: '2026-03-30T05:00:00.000Z',
      createdByAccountId: input.accountId,
      createdByRunId: input.createdByRunId ?? null,
      id: input.fileId,
      metadata: null,
      mimeType: input.mimeType ?? 'text/plain',
      originUploadId: null,
      originalFilename: input.filename,
      sizeBytes: Buffer.byteLength(input.body),
      sourceKind: input.createdByRunId ? 'generated' : 'upload',
      status: 'ready',
      storageKey,
      tenantId: input.tenantId,
      title: input.filename,
      updatedAt: '2026-03-30T05:00:00.000Z',
    })
    .run()

  runtime.db
    .insert(fileLinks)
    .values({
      createdAt: '2026-03-30T05:00:00.000Z',
      fileId: input.fileId,
      id: `${input.linkType}_${input.fileId}`,
      linkType: input.linkType,
      targetId: input.targetId,
      tenantId: input.tenantId,
    })
    .run()
}

const collectMessageText = (request: AiInteractionRequest | null): string =>
  JSON.stringify(request?.messages ?? [])

const immediateTool: ToolSpec = {
  domain: 'mcp',
  execute: async () =>
    ok({
      kind: 'immediate',
      output: {
        ok: true,
      },
    }),
  inputSchema: {
    additionalProperties: false,
    properties: {},
    type: 'object',
  },
  isAvailable: () => true,
  name: 'search_docs',
}

const systemTool: ToolSpec = {
  domain: 'system',
  execute: async () =>
    ok({
      kind: 'immediate',
      output: {
        ok: true,
      },
    }),
  inputSchema: {
    additionalProperties: false,
    properties: {},
    type: 'object',
  },
  isAvailable: () => true,
  name: 'system_debug',
}

test('agent revision tool policy filters native, mcp, and system tools', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const capturedRequests: AiInteractionRequest[] = []

  runtime.services.tools.register(immediateTool)
  runtime.services.tools.register(systemTool)

  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_locked',
    modelAlias: 'gpt-5.4',
    name: 'Locked',
    nativeTools: [],
    provider: 'openai',
    revisionId: 'agr_locked_v1',
    slug: 'locked',
    tenantId,
    toolProfileId: null,
  })
  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_open',
    modelAlias: 'gpt-5.4',
    name: 'Open',
    nativeTools: ['delegate_to_agent'],
    provider: 'openai',
    revisionId: 'agr_open_v1',
    slug: 'open',
    tenantId,
    toolProfileId: 'tpf_research',
  })
  assignMcpToolToProfile(runtime, {
    runtimeName: 'search_docs',
    serverId: 'srv_docs',
    tenantId,
    toolProfileId: 'tpf_research',
  })

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Done.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Done.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Done.',
      provider: 'openai',
      providerRequestId: 'req_phase8_tools',
      raw: { stub: true },
      responseId: 'resp_phase8_tools',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const locked = await bootstrapSession(app, headers, 'agt_locked', {
    execute: true,
  })
  const open = await bootstrapSession(app, headers, 'agt_open', {
    execute: true,
  })

  assert.equal(locked.data.status, 'completed')
  assert.equal(open.data.status, 'completed')
  assert.deepEqual(capturedRequests[0]?.tools?.map((tool) => tool.name) ?? [], [])
  assert.deepEqual(capturedRequests[1]?.tools?.map((tool) => tool.name) ?? [], [
    'delegate_to_agent',
    'resume_delegated_run',
    'search_docs',
  ])
})

test('delegated child run inherits parent input files and keeps child-only run files private from the parent', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)

  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_orchestrator',
    modelAlias: 'gpt-5.4',
    name: 'Orchestrator',
    nativeTools: ['delegate_to_agent'],
    provider: 'openai',
    revisionId: 'agr_orchestrator_v1',
    slug: 'orchestrator',
    tenantId,
    toolProfileId: null,
  })
  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_researcher',
    modelAlias: 'gpt-5.4',
    name: 'Researcher',
    nativeTools: [],
    provider: 'openai',
    revisionId: 'agr_researcher_v1',
    slug: 'researcher',
    tenantId,
    toolProfileId: null,
  })
  seedSubagentLink(runtime, {
    alias: 'researcher',
    childAgentId: 'agt_researcher',
    id: 'asl_orchestrator_researcher',
    parentAgentRevisionId: 'agr_orchestrator_v1',
    tenantId,
  })

  const bootstrap = await bootstrapSession(app, headers, 'agt_orchestrator')

  await storeLinkedFile(runtime, {
    accountId,
    body: 'Input file for the child: additive SQLite migrations only.',
    fileId: 'fil_parent_input',
    filename: 'migration-plan.md',
    linkType: 'message',
    targetId: bootstrap.data.messageId,
    tenantId,
  })
  runtime.db
    .insert(fileLinks)
    .values({
      createdAt: '2026-03-30T05:00:00.000Z',
      fileId: 'fil_parent_input',
      id: 'session_fil_parent_input',
      linkType: 'session',
      targetId: bootstrap.data.sessionId,
      tenantId,
    })
    .run()

  const rootRunId = bootstrap.data.runId
  let rootCallCount = 0
  let childRequest: AiInteractionRequest | null = null
  let resumedParentRequest: AiInteractionRequest | null = null

  runtime.services.ai.interactions.generate = async (request) => {
    const runId = request.metadata?.runId

    if (runId === rootRunId && rootCallCount === 0) {
      rootCallCount += 1
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: {
              agentAlias: 'researcher',
              task: 'Inspect attached migration notes',
            },
            argumentsJson: '{"agentAlias":"researcher","task":"Inspect attached migration notes"}',
            callId: 'call_delegate_file_1',
            name: 'delegate_to_agent',
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_delegate_file_1',
        raw: { stub: true },
        responseId: 'resp_delegate_file_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: {
              agentAlias: 'researcher',
              task: 'Inspect attached migration notes',
            },
            argumentsJson: '{"agentAlias":"researcher","task":"Inspect attached migration notes"}',
            callId: 'call_delegate_file_1',
            name: 'delegate_to_agent',
          },
        ],
        usage: null,
      })
    }

    if (runId !== rootRunId) {
      childRequest = request

      return ok<AiInteractionResponse>({
        messages: [
          {
            content: [{ text: 'Child finished.', type: 'text' }],
            role: 'assistant',
          },
        ],
        model: 'gpt-5.4',
        output: [
          {
            content: [{ text: 'Child finished.', type: 'text' }],
            role: 'assistant',
            type: 'message',
          },
        ],
        outputText: 'Child finished.',
        provider: 'openai',
        providerRequestId: 'req_child_file_1',
        raw: { stub: true },
        responseId: 'resp_child_file_1',
        status: 'completed',
        toolCalls: [],
        usage: null,
      })
    }

    resumedParentRequest = request

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Parent resumed.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Parent resumed.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Parent resumed.',
      provider: 'openai',
      providerRequestId: 'req_parent_resume_1',
      raw: { stub: true },
      responseId: 'resp_parent_resume_1',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const executeResponse = await executeRun(app, headers, rootRunId)

  assert.equal(executeResponse.response.status, 202)

  const childRunId = runtime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id !== rootRunId)?.id

  assert.ok(childRunId)

  await storeLinkedFile(runtime, {
    accountId,
    body: 'child secret artifact',
    createdByRunId: childRunId,
    fileId: 'fil_child_private',
    filename: 'child-secret.txt',
    linkType: 'run',
    targetId: childRunId,
    tenantId,
  })

  const childScope = {
    accountId: accountId as ReturnType<typeof seedApiKeyAuth>['accountId'],
    role: 'admin' as const,
    tenantId: tenantId as ReturnType<typeof seedApiKeyAuth>['tenantId'],
  }
  const childExecution = await createExecuteRunCommand().execute(
    createInternalCommandContext(runtime, childScope),
    childRunId,
    {},
  )

  assert.equal(childExecution.ok, true)

  await runtime.services.multiagent.processAvailableDecisions()
  await runtime.services.multiagent.processAvailableDecisions()

  const childText = collectMessageText(childRequest)
  const parentText = collectMessageText(resumedParentRequest)
  const childRunLinks = runtime.db
    .select()
    .from(fileLinks)
    .all()
    .filter((link) => link.linkType === 'run' && link.targetId === childRunId)

  assert.match(childText, /migration-plan\.md/)
  assert.match(childText, /Input file for the child: additive SQLite migrations only\./)
  assert.match(childText, /child-secret\.txt/)
  assert.match(parentText, /migration-plan\.md/)
  assert.doesNotMatch(parentText, /child-secret\.txt/)
  assert.equal(
    childRunLinks.some((link) => link.fileId === 'fil_parent_input'),
    true,
  )
})

test('root observation memory is written to agent_profile scope', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)

  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_memory',
    modelAlias: 'gpt-5.4',
    name: 'Memory Agent',
    nativeTools: [],
    provider: 'openai',
    revisionId: 'agr_memory_v1',
    slug: 'memory-agent',
    tenantId,
    toolProfileId: null,
  })

  const bootstrap = await bootstrapSession(app, headers, 'agt_memory')
  const runRow = runtime.db.select().from(runs).get()

  assert.ok(runRow?.threadId)

  runtime.db
    .insert(items)
    .values([
      {
        arguments: null,
        callId: null,
        content: [{ text: 'Long earlier context A', type: 'text' }],
        createdAt: '2026-03-29T00:00:01.000Z',
        id: 'itm_memory_a',
        name: null,
        output: null,
        providerPayload: null,
        role: 'user',
        runId: bootstrap.data.runId,
        sequence: 1,
        summary: null,
        tenantId,
        type: 'message',
      },
      {
        arguments: null,
        callId: null,
        content: [{ text: 'Long earlier context B', type: 'text' }],
        createdAt: '2026-03-29T00:00:02.000Z',
        id: 'itm_memory_b',
        name: null,
        output: null,
        providerPayload: null,
        role: 'assistant',
        runId: bootstrap.data.runId,
        sequence: 2,
        summary: null,
        tenantId,
        type: 'message',
      },
      {
        arguments: null,
        callId: null,
        content: [{ text: 'Current turn for memory write scope.', type: 'text' }],
        createdAt: '2026-03-29T00:00:03.000Z',
        id: 'itm_memory_c',
        name: null,
        output: null,
        providerPayload: null,
        role: 'user',
        runId: bootstrap.data.runId,
        sequence: 3,
        summary: null,
        tenantId,
        type: 'message',
      },
    ])
    .run()

  runtime.db
    .insert(contextSummaries)
    .values({
      content:
        'Summary of earlier main-thread context:\n- user: Long earlier context A\n- assistant: Long earlier context B',
      createdAt: '2026-03-29T00:00:04.000Z',
      fromSequence: 1,
      id: 'sum_memory_agent_1',
      modelKey: 'main_thread_compaction_v1',
      previousSummaryId: null,
      runId: bootstrap.data.runId,
      tenantId,
      throughSequence: 2,
      tokensAfter: 20,
      tokensBefore: 60,
      turnNumber: 0,
    })
    .run()

  runtime.services.ai.interactions.generate = async (request) => {
    if (request.metadata?.stage === 'observer') {
      return ok<AiInteractionResponse>({
        messages: [
          {
            content: [
              {
                text: JSON.stringify({
                  observations: [{ text: 'Carry the migration safety rule forward.' }],
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
                  observations: [{ text: 'Carry the migration safety rule forward.' }],
                }),
                type: 'text',
              },
            ],
            role: 'assistant',
            type: 'message',
          },
        ],
        outputText: JSON.stringify({
          observations: [{ text: 'Carry the migration safety rule forward.' }],
        }),
        provider: 'openai',
        providerRequestId: 'req_observer_agent_profile',
        raw: { stub: true },
        responseId: 'resp_observer_agent_profile',
        status: 'completed',
        toolCalls: [],
        usage: null,
      })
    }

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Done.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Done.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Done.',
      provider: 'openai',
      providerRequestId: 'req_memory_agent_done',
      raw: { stub: true },
      responseId: 'resp_memory_agent_done',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const response = await executeRun(app, headers, bootstrap.data.runId)

  assert.equal(response.response.status, 200)

  const observation = runtime.db
    .select()
    .from(memoryRecords)
    .all()
    .find((row) => row.kind === 'observation')

  assert.ok(observation)
  assert.equal(observation?.scopeKind, 'agent_profile')
  assert.equal(observation?.scopeRef, 'agt_memory')
})

test('parent agent-profile memory does not leak into delegated child runs', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)

  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_orchestrator',
    modelAlias: 'gpt-5.4',
    name: 'Orchestrator',
    nativeTools: ['delegate_to_agent'],
    provider: 'openai',
    revisionId: 'agr_orchestrator_v1',
    slug: 'orchestrator',
    tenantId,
    toolProfileId: null,
  })
  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_researcher',
    modelAlias: 'gpt-5.4',
    name: 'Researcher',
    nativeTools: [],
    provider: 'openai',
    revisionId: 'agr_researcher_v1',
    slug: 'researcher',
    tenantId,
    toolProfileId: null,
  })
  seedSubagentLink(runtime, {
    alias: 'researcher',
    childAgentId: 'agt_researcher',
    id: 'asl_memory_orchestrator_researcher',
    parentAgentRevisionId: 'agr_orchestrator_v1',
    tenantId,
  })

  const bootstrap = await bootstrapSession(app, headers, 'agt_orchestrator')
  const rootRunId = bootstrap.data.runId

  runtime.db
    .insert(memoryRecords)
    .values({
      content: {
        reflection: 'Parent-only orchestration memory should stay out of child prompts.',
        source: 'reflector_v1',
      },
      createdAt: '2026-03-30T05:00:00.000Z',
      generation: 1,
      id: 'mrec_orchestrator_memory_1',
      kind: 'reflection',
      ownerRunId: rootRunId,
      parentRecordId: null,
      rootRunId,
      scopeKind: 'agent_profile',
      scopeRef: 'agt_orchestrator',
      sessionId: bootstrap.data.sessionId,
      status: 'active',
      tenantId,
      threadId: runtime.db.select().from(runs).get()?.threadId ?? null,
      tokenCount: 18,
      visibility: 'private',
    })
    .run()

  let rootRequest: AiInteractionRequest | null = null
  let childRequest: AiInteractionRequest | null = null

  runtime.services.ai.interactions.generate = async (request) => {
    const runId = request.metadata?.runId

    if (runId === rootRunId) {
      rootRequest = request

      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: {
              agentAlias: 'researcher',
              task: 'Check the boundary',
            },
            argumentsJson: '{"agentAlias":"researcher","task":"Check the boundary"}',
            callId: 'call_delegate_memory_1',
            name: 'delegate_to_agent',
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_delegate_memory_1',
        raw: { stub: true },
        responseId: 'resp_delegate_memory_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: {
              agentAlias: 'researcher',
              task: 'Check the boundary',
            },
            argumentsJson: '{"agentAlias":"researcher","task":"Check the boundary"}',
            callId: 'call_delegate_memory_1',
            name: 'delegate_to_agent',
          },
        ],
        usage: null,
      })
    }

    childRequest = request

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Child done.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Child done.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Child done.',
      provider: 'openai',
      providerRequestId: 'req_child_memory_1',
      raw: { stub: true },
      responseId: 'resp_child_memory_1',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const response = await executeRun(app, headers, rootRunId)

  assert.equal(response.response.status, 202)

  const childRunId = runtime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id !== rootRunId)?.id

  assert.ok(childRunId)

  const childScope = {
    accountId: accountId as ReturnType<typeof seedApiKeyAuth>['accountId'],
    role: 'admin' as const,
    tenantId: tenantId as ReturnType<typeof seedApiKeyAuth>['tenantId'],
  }
  const childExecution = await createExecuteRunCommand().execute(
    createInternalCommandContext(runtime, childScope),
    childRunId,
    {},
  )

  assert.equal(childExecution.ok, true)
  assert.match(
    collectMessageText(rootRequest),
    /Parent-only orchestration memory should stay out of child prompts\./,
  )
  assert.doesNotMatch(
    collectMessageText(childRequest),
    /Parent-only orchestration memory should stay out of child prompts\./,
  )
})
