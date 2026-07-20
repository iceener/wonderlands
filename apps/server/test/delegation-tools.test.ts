import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createInternalCommandContext } from '../src/application/commands/internal-command-context'
import { toToolContext } from '../src/application/runtime/execution/run-tool-execution'
import { isParentDeliverableChildWait } from '../src/application/runtime/waits/delegated-child-waits'
import {
  agentRevisions,
  agentSubagentLinks,
  agents,
  items,
  runDependencies,
  runs,
  toolExecutions,
  toolProfiles,
} from '../src/db/schema'
import type { AiInteractionResponse } from '../src/domain/ai/types'
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
    profile: string
    provider: 'openai' | 'google'
    reasoning?: Record<string, unknown> | null
    revisionId: string
    slug: string
    tenantId?: string
  },
) => {
  const tenantId = input.tenantId ?? 'ten_test'
  const createdAt = '2026-03-30T05:00:00.000Z'
  const toolProfileId = `tpf_${input.profile}`

  runtime.db
    .insert(toolProfiles)
    .values({
      accountId: input.accountId,
      createdAt,
      id: toolProfileId,
      name: `${input.name} tools`,
      scope: 'account_private',
      status: 'active',
      tenantId,
      updatedAt: createdAt,
    })
    .onConflictDoNothing()
    .run()

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
      toolProfileId,
      toolPolicyJson: {
        toolProfileId,
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
    delegationMode?: 'async_join'
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
      delegationMode: input.delegationMode ?? 'async_join',
      id: input.id,
      parentAgentRevisionId: input.parentAgentRevisionId,
      position: 0,
      tenantId: input.tenantId ?? 'ten_test',
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
      initialMessage: 'Coordinate the next slice of work',
      target: {
        agentId,
        kind: 'agent',
      },
      title: 'Delegation test',
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

test('delegated child wait delivery ignores runtime-managed external tool waits', () => {
  assert.equal(
    isParentDeliverableChildWait({
      targetKind: 'external',
      type: 'tool',
    }),
    false,
  )
  assert.equal(
    isParentDeliverableChildWait({
      targetKind: 'run',
      type: 'agent',
    }),
    false,
  )
  assert.equal(
    isParentDeliverableChildWait({
      targetKind: 'human_response',
      type: 'human',
    }),
    true,
  )
  assert.equal(
    isParentDeliverableChildWait({
      targetKind: 'upload',
      type: 'upload',
    }),
    true,
  )
  assert.equal(
    isParentDeliverableChildWait({
      targetKind: 'mcp_operation',
      type: 'mcp',
    }),
    true,
  )
})

test('resume_delegated_run tolerates a delegated child wait that was already auto-resolved', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)

  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_parent',
    modelAlias: 'gpt-5.4',
    name: 'Parent',
    nativeTools: ['resume_delegated_run'],
    profile: 'parent',
    provider: 'openai',
    revisionId: 'agr_parent_v1',
    slug: 'parent',
    tenantId,
  })
  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_child',
    modelAlias: 'gpt-5.4',
    name: 'Child',
    profile: 'child',
    provider: 'openai',
    revisionId: 'agr_child_v1',
    slug: 'child',
    tenantId,
  })

  const bootstrap = await bootstrapSession(app, headers, 'agt_parent')
  const parentRun = runtime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id === bootstrap.data.runId)

  assert.ok(parentRun)

  runtime.db
    .insert(runs)
    .values({
      agentId: 'agt_child',
      agentRevisionId: 'agr_child_v1',
      configSnapshot: {
        model: 'gpt-5.4',
        provider: 'openai',
      },
      createdAt: '2026-04-08T09:02:16.469Z',
      id: 'run_child_resolved_wait',
      parentRunId: parentRun!.id,
      rootRunId: parentRun!.rootRunId,
      sessionId: parentRun!.sessionId,
      startedAt: '2026-04-08T09:02:16.470Z',
      status: 'running',
      task: 'Continue researching Mythos',
      tenantId,
      targetKind: 'agent',
      threadId: parentRun!.threadId,
      toolProfileId: parentRun!.toolProfileId,
      updatedAt: '2026-04-08T09:02:24.026Z',
    })
    .run()

  runtime.db
    .insert(runDependencies)
    .values({
      callId: 'call_child_execute_1',
      createdAt: '2026-04-08T09:02:23.342Z',
      description: 'Waiting for sandbox execution sbx_test_1',
      id: 'wte_child_execute_1',
      resolutionJson: {
        output: {
          sandboxExecutionId: 'sbx_test_1',
          status: 'completed',
          stdout: '/vault/overment',
        },
      },
      resolvedAt: '2026-04-08T09:02:24.026Z',
      runId: 'run_child_resolved_wait',
      status: 'resolved',
      targetKind: 'external',
      targetRef: 'sandbox_execution:sbx_test_1',
      tenantId,
      timeoutAt: null,
      type: 'tool',
    })
    .run()

  const tool = runtime.services.tools.get('resume_delegated_run')

  assert.ok(tool)

  const context = toToolContext(
    createInternalCommandContext(runtime, {
      accountId,
      tenantId,
    }),
    parentRun!,
    'call_parent_resume_1',
  )
  const result = await tool!.execute(context, {
    childRunId: 'run_child_resolved_wait',
    output: {
      acknowledged: true,
    },
    waitId: 'wte_child_execute_1',
  })

  assert.equal(result.ok, true)
  assert.equal(result.value.kind, 'waiting')
  assert.deepEqual(result.value.wait, {
    description: 'Waiting for delegated child run "Continue researching Mythos" to continue',
    targetKind: 'run',
    targetRef: 'run_child_resolved_wait',
    targetRunId: 'run_child_resolved_wait',
    type: 'agent',
  })
})

test('delegate_to_agent rejects aliases that are not allowed for the active parent revision', async () => {
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
  let callCount = 0

  runtime.services.ai.interactions.generate = async (request) => {
    callCount += 1

    if (callCount === 1) {
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: {
              agentAlias: 'writer',
              task: 'Write the summary',
            },
            argumentsJson: '{"agentAlias":"writer","task":"Write the summary"}',
            callId: 'call_delegate_invalid_1',
            name: 'delegate_to_agent',
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_delegate_invalid_1',
        raw: { stub: true },
        responseId: 'resp_delegate_invalid_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: {
              agentAlias: 'writer',
              task: 'Write the summary',
            },
            argumentsJson: '{"agentAlias":"writer","task":"Write the summary"}',
            callId: 'call_delegate_invalid_1',
            name: 'delegate_to_agent',
          },
        ],
        usage: null,
      })
    }

    assert.equal(request.messages.at(-1)?.role, 'tool')

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [
            { text: 'Delegation was rejected because the alias is not allowed.', type: 'text' },
          ],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [
            { text: 'Delegation was rejected because the alias is not allowed.', type: 'text' },
          ],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Delegation was rejected because the alias is not allowed.',
      provider: 'openai',
      providerRequestId: 'req_delegate_invalid_2',
      raw: { stub: true },
      responseId: 'resp_delegate_invalid_2',
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

  assert.equal(executeResponse.status, 200)
  assert.equal(executeBody.data.status, 'completed')

  const runRows = runtime.db.select().from(runs).all()
  const toolExecutionRow = runtime.db.select().from(toolExecutions).get()
  const functionOutput = runtime.db
    .select()
    .from(items)
    .all()
    .find((item) => item.type === 'function_call_output')

  assert.equal(runRows.length, 1)
  assert.equal(runtime.db.select().from(runDependencies).all().length, 0)
  assert.match(String(toolExecutionRow?.errorText), /agent alias "writer" is not allowed/)
  assert.match(String(functionOutput?.output), /agent alias \\"writer\\" is not allowed/)
})
