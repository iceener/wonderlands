import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  agentRevisions,
  agentSubagentLinks,
  agents,
  domainEvents,
  items,
  jobDependencies,
  jobs,
  runDependencies,
  runs,
  sessionMessages,
  toolProfiles,
} from '../src/db/schema'
import type { AiInteractionRequest, AiInteractionResponse } from '../src/domain/ai/types'
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

const buildAssistantResponse = (text: string, outputText = text): AiInteractionResponse => ({
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
  outputText,
  provider: 'openai',
  providerRequestId: 'req_text',
  raw: { stub: true },
  responseId: 'resp_text',
  status: 'completed',
  toolCalls: [],
  usage: null,
})

const buildSingleToolCallResponse = (input: {
  arguments: Record<string, unknown>
  callId: string
  name: string
  outputText?: string
}): AiInteractionResponse => ({
  messages:
    input.outputText && input.outputText.length > 0
      ? [
          {
            content: [{ text: input.outputText, type: 'text' }],
            role: 'assistant',
          },
        ]
      : [],
  model: 'gpt-5.4',
  output: [
    ...(input.outputText && input.outputText.length > 0
      ? [
          {
            content: [{ text: input.outputText, type: 'text' }],
            role: 'assistant',
            type: 'message' as const,
          },
        ]
      : []),
    {
      arguments: input.arguments,
      argumentsJson: JSON.stringify(input.arguments),
      callId: input.callId,
      name: input.name,
      type: 'function_call',
    },
  ],
  outputText: input.outputText ?? '',
  provider: 'openai',
  providerRequestId: `req_${input.callId}`,
  raw: { stub: true },
  responseId: `resp_${input.callId}`,
  status: 'completed',
  toolCalls: [
    {
      arguments: input.arguments,
      argumentsJson: JSON.stringify(input.arguments),
      callId: input.callId,
      name: input.name,
    },
  ],
  usage: null,
})

const buildSuspendResponse = (input: {
  callId?: string
  details?: Record<string, unknown>
  outputText?: string
  reason: string
  targetKind?: 'external' | 'human_response' | 'mcp_operation' | 'upload'
  targetRef?: string
  waitType?: 'human' | 'mcp' | 'tool' | 'upload'
}): AiInteractionResponse =>
  buildSingleToolCallResponse({
    arguments: {
      ...(input.details ? { details: input.details } : {}),
      ...(input.targetKind ? { targetKind: input.targetKind } : {}),
      ...(input.targetRef ? { targetRef: input.targetRef } : {}),
      ...(input.waitType ? { waitType: input.waitType } : {}),
      reason: input.reason,
    },
    callId: input.callId ?? 'call_suspend_1',
    name: 'suspend_run',
    outputText: input.outputText,
  })

const buildResumeDelegatedRunResponse = (input: {
  callId?: string
  childRunId: string
  output: Record<string, unknown>
  waitId: string
}): AiInteractionResponse =>
  buildSingleToolCallResponse({
    arguments: {
      childRunId: input.childRunId,
      output: input.output,
      waitId: input.waitId,
    },
    callId: input.callId ?? 'call_resume_delegated_1',
    name: 'resume_delegated_run',
  })

test('delegate_to_agent creates a private child run, a parent agent wait, and a typed handoff bundle', async () => {
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
    nativeTools: ['delegate_to_agent', 'suspend_run'],
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
    nativeTools: ['suspend_run'],
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
  let capturedRequest: AiInteractionRequest | null = null

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequest = request

    return ok<AiInteractionResponse>({
      messages: [],
      model: 'gpt-5.4',
      output: [
        {
          arguments: {
            agentAlias: 'researcher',
            instructions:
              'Investigate why the SQLite migration rebuild fails and return a concise diagnosis.',
            task: 'Research the migration failure',
          },
          argumentsJson:
            '{"agentAlias":"researcher","task":"Research the migration failure","instructions":"Investigate why the SQLite migration rebuild fails and return a concise diagnosis."}',
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
            instructions:
              'Investigate why the SQLite migration rebuild fails and return a concise diagnosis.',
            task: 'Research the migration failure',
          },
          argumentsJson:
            '{"agentAlias":"researcher","task":"Research the migration failure","instructions":"Investigate why the SQLite migration rebuild fails and return a concise diagnosis."}',
          callId: 'call_delegate_1',
          name: 'delegate_to_agent',
        },
      ],
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
  assert.ok(capturedRequest)
  assert.deepEqual(
    capturedRequest?.tools?.map((tool) => tool.name),
    ['delegate_to_agent', 'suspend_run', 'resume_delegated_run'],
  )

  const runRows = runtime.db.select().from(runs).all()
  const parentRun = runRows.find((run) => run.id === bootstrap.data.runId)
  const childRun = runRows.find((run) => run.id !== bootstrap.data.runId)
  const waitRow = runtime.db.select().from(runDependencies).get()
  const workItemRows = runtime.db.select().from(jobs).all()
  const workItemEdgeRows = runtime.db.select().from(jobDependencies).all()
  const childItems = runtime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.runId === childRun?.id)
    .sort((left, right) => left.sequence - right.sequence)
  const childSessionMessages = runtime.db
    .select()
    .from(sessionMessages)
    .all()
    .filter((message) => message.runId === childRun?.id)
  const eventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .slice()
    .sort((left, right) => left.eventNo - right.eventNo)
    .map((event) => event.type)
  const parentWorkItem = workItemRows.find((workItem) => workItem.currentRunId === parentRun?.id)
  const childWorkItem = workItemRows.find((workItem) => workItem.currentRunId === childRun?.id)

  assert.equal(parentRun?.status, 'waiting')
  assert.ok(childRun)
  assert.equal(childRun?.agentId, 'agt_researcher')
  assert.equal(childRun?.agentRevisionId, 'agr_researcher_v1')
  assert.equal(childRun?.parentRunId, bootstrap.data.runId)
  assert.equal(childRun?.rootRunId, bootstrap.data.runId)
  assert.equal(childRun?.sourceCallId, 'call_delegate_1')
  assert.equal(childRun?.threadId, null)
  assert.equal(
    (childRun?.configSnapshot as { eventThreadId?: string } | null)?.eventThreadId,
    bootstrap.data.threadId,
  )
  assert.equal(childRun?.sessionId, bootstrap.data.sessionId)
  assert.equal(childRun?.toolProfileId, 'tpf_research')
  assert.equal(childRun?.status, 'pending')
  assert.equal(childRun?.jobId, childWorkItem?.id)
  assert.equal(childRun?.workspaceId, parentRun?.workspaceId ?? null)
  assert.match(String(childRun?.workspaceRef), new RegExp(`/runs/${childRun?.id}$`))
  assert.equal(parentWorkItem?.id, parentRun?.jobId)
  assert.equal(parentWorkItem?.status, 'waiting')
  assert.equal(childWorkItem?.kind, 'task')
  assert.equal(childWorkItem?.parentJobId, parentWorkItem?.id ?? null)
  assert.equal(childWorkItem?.rootJobId, parentWorkItem?.rootJobId ?? childWorkItem?.id)
  assert.equal(childWorkItem?.status, 'queued')
  assert.equal(childWorkItem?.threadId, bootstrap.data.threadId)
  assert.equal(childWorkItem?.title, 'Research the migration failure')
  assert.equal(
    (childWorkItem?.statusReasonJson as { reason?: string } | null)?.reason,
    'delegate_to_agent',
  )
  assert.equal(
    (childWorkItem?.statusReasonJson as { source?: string } | null)?.source,
    'delegate_to_agent',
  )
  assert.equal((childWorkItem?.statusReasonJson as { runId?: string } | null)?.runId, childRun?.id)
  assert.equal(
    (childWorkItem?.statusReasonJson as { parentRunId?: string } | null)?.parentRunId,
    bootstrap.data.runId,
  )
  assert.equal(
    (childWorkItem?.statusReasonJson as { sourceCallId?: string } | null)?.sourceCallId,
    'call_delegate_1',
  )
  assert.deepEqual(
    workItemEdgeRows.map((edge) => ({
      fromJobId: edge.fromJobId,
      toJobId: edge.toJobId,
      type: edge.type,
    })),
    [
      {
        fromJobId: parentWorkItem?.id,
        toJobId: childWorkItem?.id,
        type: 'depends_on',
      },
    ],
  )

  assert.equal(waitRow?.type, 'agent')
  assert.equal(waitRow?.targetKind, 'run')
  assert.equal(waitRow?.targetRunId, childRun?.id)
  assert.equal(waitRow?.targetRef, `researcher:${childRun?.id}`)

  assert.equal(childItems.length, 2)
  assert.equal(childItems[0]?.role, 'developer')
  assert.equal(childItems[1]?.role, 'user')
  assert.deepEqual(childItems[0]?.content, [
    {
      text:
        'Delegated run context.\n' +
        'You are Researcher.\n' +
        'Another agent delegated the next task to you.\n' +
        'Complete it directly, or suspend the run if you need additional input.',
      type: 'text',
    },
  ])
  assert.deepEqual(childItems[0]?.providerPayload, {
    kind: 'delegation_handoff',
    parent: {
      agentId: 'agt_orchestrator',
      agentRevisionId: 'agr_orchestrator_v1',
      runId: bootstrap.data.runId,
      sourceCallId: 'call_delegate_1',
    },
    sessionId: bootstrap.data.sessionId,
    target: {
      agentId: 'agt_researcher',
      agentName: 'Researcher',
      agentRevisionId: 'agr_researcher_v1',
      agentSlug: 'researcher',
      alias: 'researcher',
      delegationMode: 'async_join',
      inputFileIds: [],
      runId: childRun?.id,
    },
    version: 1,
  })
  assert.deepEqual(childItems[1]?.providerPayload, {
    instructions:
      'Investigate why the SQLite migration rebuild fails and return a concise diagnosis.',
    kind: 'delegation_task',
    task: 'Research the migration failure',
    version: 1,
  })
  assert.deepEqual(childItems[1]?.content, [
    {
      text: 'Task: Research the migration failure\n\nInstructions:\nInvestigate why the SQLite migration rebuild fails and return a concise diagnosis.',
      type: 'text',
    },
  ])
  assert.equal(childSessionMessages.length, 0)
  assert.equal(eventTypes.includes('delegation.started'), true)
  assert.equal(eventTypes.includes('child_run.created'), true)
  assert.equal(eventTypes.includes('job.created'), true)
  assert.equal(eventTypes.includes('job.queued'), true)
  assert.equal(eventTypes.includes('job.waiting'), true)
})

test('delegated child suspension wakes the parent, which can suspend for user input and later resume the child', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)

  wireStreamingStub(runtime)

  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_orchestrator',
    modelAlias: 'gpt-5.4',
    name: 'Orchestrator',
    nativeTools: ['delegate_to_agent', 'suspend_run'],
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
    nativeTools: ['suspend_run'],
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
  const rootRunId = bootstrap.data.runId
  let rootCallCount = 0
  let childCallCount = 0
  const exposedToolNamesByRunId = new Map<string, string[]>()
  let observedChildSuspendWaitId: string | null = null
  let observedChildRunId: string | null = null

  runtime.services.ai.interactions.generate = async (request) => {
    const runId = String(request.metadata?.runId ?? '')

    exposedToolNamesByRunId.set(runId, request.tools?.map((tool) => tool.name) ?? [])

    if (runId === rootRunId && rootCallCount === 0) {
      rootCallCount += 1

      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: {
              agentAlias: 'researcher',
              instructions: 'Ask for the exact failing migration step before diagnosing it.',
              task: 'Clarify the migration failure',
            },
            argumentsJson:
              '{"agentAlias":"researcher","task":"Clarify the migration failure","instructions":"Ask for the exact failing migration step before diagnosing it."}',
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
              instructions: 'Ask for the exact failing migration step before diagnosing it.',
              task: 'Clarify the migration failure',
            },
            argumentsJson:
              '{"agentAlias":"researcher","task":"Clarify the migration failure","instructions":"Ask for the exact failing migration step before diagnosing it."}',
            callId: 'call_delegate_1',
            name: 'delegate_to_agent',
          },
        ],
        usage: null,
      })
    }

    if (runId === rootRunId && rootCallCount === 1) {
      rootCallCount += 1

      const delegateResult = request.messages
        .flatMap((message) => message.content)
        .find(
          (content) =>
            content.type === 'function_result' &&
            content.name === 'delegate_to_agent' &&
            typeof content.outputJson === 'string',
        )

      assert.ok(delegateResult)
      const delegateOutput = JSON.parse(delegateResult.outputJson as string) as {
        childRunId?: string
        kind?: string
        waits?: Array<{ waitId?: string }>
      }

      assert.equal(delegateOutput.kind, 'suspended')
      assert.equal(typeof delegateOutput.childRunId, 'string')
      assert.equal(typeof delegateOutput.waits?.[0]?.waitId, 'string')

      observedChildRunId = delegateOutput.childRunId ?? null
      observedChildSuspendWaitId = delegateOutput.waits?.[0]?.waitId ?? null

      return ok(
        buildSuspendResponse({
          callId: 'call_root_suspend_1',
          details: {
            question: 'Which migration step failed?',
          },
          outputText: 'Which migration step failed?',
          reason: 'Need the exact failing migration step from the user before resuming the child.',
        }),
      )
    }

    if (runId === rootRunId && rootCallCount === 2) {
      rootCallCount += 1

      assert.ok(observedChildRunId)
      assert.ok(observedChildSuspendWaitId)

      return ok(
        buildResumeDelegatedRunResponse({
          childRunId: observedChildRunId,
          output: {
            kind: 'human_response',
            text: 'Step 7 rebuild table failed with duplicate column name users.email.',
          },
          waitId: observedChildSuspendWaitId,
        }),
      )
    }

    if (runId === rootRunId) {
      rootCallCount += 1
      return ok(buildAssistantResponse('The parent resumed after the child reply arrived.'))
    }

    if (childCallCount === 0) {
      childCallCount += 1
      return ok(
        buildSuspendResponse({
          reason: 'Need the exact migration step and error output from the user.',
        }),
      )
    }

    return ok(
      buildAssistantResponse('The child completed after the missing migration details arrived.'),
    )
  }

  const rootExecution = await executeRun(app, headers, rootRunId)

  assert.equal(rootExecution.response.status, 202)
  assert.equal(rootExecution.body.data.status, 'waiting')
  assert.deepEqual(exposedToolNamesByRunId.get(rootRunId), [
    'delegate_to_agent',
    'suspend_run',
    'resume_delegated_run',
  ])

  const childRunId = runtime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id !== rootRunId)?.id

  assert.ok(childRunId)

  const childExecution = await executeRun(app, headers, childRunId!)

  assert.equal(childExecution.response.status, 202)
  assert.equal(childExecution.body.data.status, 'waiting')
  assert.deepEqual(exposedToolNamesByRunId.get(childRunId!), ['suspend_run'])

  const waitsAfterChildSuspend = runtime.db.select().from(runDependencies).all()
  const childWait = waitsAfterChildSuspend.find((wait) => wait.runId === childRunId)
  const parentWait = waitsAfterChildSuspend.find((wait) => wait.runId === rootRunId)
  const childRunAfterSuspend = runtime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id === childRunId)

  assert.equal(childRunAfterSuspend?.status, 'waiting')
  assert.equal(childWait?.status, 'pending')
  assert.equal(childWait?.type, 'human')
  assert.equal(childWait?.targetKind, 'human_response')
  assert.equal(childWait?.targetRef, 'user_response')
  assert.equal(parentWait?.status, 'pending')

  await drainWorker(runtime)

  const waitsAfterParentHandledSuspend = runtime.db.select().from(runDependencies).all()
  const childWaitAfterParentHandledSuspend = waitsAfterParentHandledSuspend.find(
    (wait) => wait.id === childWait?.id,
  )
  const parentDelegateWaitAfterChildSuspend = waitsAfterParentHandledSuspend.find(
    (wait) => wait.id === parentWait?.id,
  )
  const parentHumanWait = waitsAfterParentHandledSuspend.find(
    (wait) =>
      wait.runId === rootRunId &&
      wait.id !== parentWait?.id &&
      wait.type === 'human' &&
      wait.targetKind === 'human_response',
  )
  const parentRunAfterChildSuspend = runtime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id === rootRunId)
  const delegateToolOutput = runtime.db
    .select()
    .from(items)
    .all()
    .find((item) => item.runId === rootRunId && item.type === 'function_call_output')

  assert.equal(parentRunAfterChildSuspend?.status, 'waiting')
  assert.equal(parentDelegateWaitAfterChildSuspend?.status, 'resolved')
  assert.equal(childWaitAfterParentHandledSuspend?.status, 'pending')
  assert.equal(parentHumanWait?.status, 'pending')
  assert.ok(delegateToolOutput)
  assert.equal(JSON.parse(String(delegateToolOutput?.output))?.kind, 'suspended')

  const parentResumeResponse = await app.request(`http://local/v1/runs/${rootRunId}/resume`, {
    body: JSON.stringify({
      output: {
        kind: 'human_response',
        text: 'Step 7 rebuild table failed with duplicate column name users.email.',
      },
      waitId: parentHumanWait?.id,
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const parentResumeBody = await parentResumeResponse.json()

  assert.equal(parentResumeResponse.status, 202)
  assert.equal(parentResumeBody.data.status, 'accepted')

  await drainWorker(runtime)

  const finalRuns = runtime.db.select().from(runs).all()
  const finalParentRun = finalRuns.find((run) => run.id === rootRunId)
  const finalChildRun = finalRuns.find((run) => run.id === childRunId)
  const finalWaits = runtime.db.select().from(runDependencies).all()
  const resumeWait = finalWaits.find(
    (wait) =>
      wait.runId === rootRunId &&
      wait.id !== parentWait?.id &&
      wait.id !== parentHumanWait?.id &&
      wait.type === 'agent' &&
      wait.targetRunId === childRunId,
  )
  const eventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .map((event) => event.type)

  assert.equal(rootCallCount, 4)
  assert.equal(childCallCount, 1)
  assert.equal(finalChildRun?.status, 'completed')
  assert.equal(finalParentRun?.status, 'completed')
  assert.equal(finalWaits.find((wait) => wait.id === parentWait?.id)?.status, 'resolved')
  assert.equal(finalWaits.find((wait) => wait.id === parentHumanWait?.id)?.status, 'resolved')
  assert.equal(finalWaits.find((wait) => wait.id === resumeWait?.id)?.status, 'resolved')
  assert.equal(eventTypes.includes('run.waiting'), true)
  assert.equal(eventTypes.includes('run.resumed'), true)
  assert.equal(eventTypes.includes('child_run.completed'), true)
  assert.deepEqual(exposedToolNamesByRunId.get(rootRunId), [
    'delegate_to_agent',
    'suspend_run',
    'resume_delegated_run',
  ])
})
