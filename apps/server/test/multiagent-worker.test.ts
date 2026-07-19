import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'

import { closeAppRuntime, createAppRuntime, initializeAppRuntime } from '../src/app/runtime'
import { createExecuteRunCommand } from '../src/application/commands/execute-run'
import { createInternalCommandContext } from '../src/application/commands/internal-command-context'
import { createResumeRunCommand } from '../src/application/commands/resume-run'
import { createStartThreadInteractionCommand } from '../src/application/commands/start-thread-interaction'
import {
  agentRevisions,
  agentSubagentLinks,
  agents,
  domainEvents,
  items,
  jobs,
  runClaims,
  runDependencies,
  runs,
  sessionMessages,
  toolExecutions,
} from '../src/db/schema'
import type { AiInteractionRequest, AiInteractionResponse } from '../src/domain/ai/types'
import { createItemRepository } from '../src/adapters/persistence/sqlite/runtime/item-repository'
import { createRunClaimRepository } from '../src/adapters/persistence/sqlite/runtime/run-claim-repository'
import { createRunDependencyRepository } from '../src/adapters/persistence/sqlite/runtime/run-dependency-repository'
import { createToolExecutionRepository } from '../src/adapters/persistence/sqlite/runtime/tool-execution-repository'
import { asAccountId, asItemId, asRunId, asTenantId } from '../src/shared/ids'
import { err, ok } from '../src/shared/result'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'
import { grantNativeToolToDefaultAgent } from './helpers/grant-native-tool-agent'

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
    tenantId?: string
  },
) => {
  const tenantId = input.tenantId ?? 'ten_test'
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
      },
      resolvedConfigJson: {},
      sourceMarkdown: `---\nname: ${input.name}\nschema: agent/v1\nslug: ${input.slug}\nvisibility: account_private\nkind: primary\n---\n${input.name} instructions`,
      tenantId,
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
      title: 'Worker lifecycle test',
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

const bootstrapPlannerRun = async (
  app: ReturnType<typeof createTestHarness>['app'],
  headers: Record<string, string>,
) => {
  const response = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Recover the waiting run',
      title: 'Wait timeout recovery test',
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

const cancelRun = async (
  app: ReturnType<typeof createTestHarness>['app'],
  headers: Record<string, string>,
  runId: string,
) => {
  const response = await app.request(`http://local/v1/runs/${runId}/cancel`, {
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

const registerFunctionTool = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    execute: (args: unknown) => Promise<ReturnType<typeof ok> | ReturnType<typeof err>>
    name: string
  },
) => {
  grantNativeToolToDefaultAgent(runtime, input.name)

  runtime.services.tools.register({
    description: `Test tool ${input.name}`,
    domain: 'native',
    execute: async (_context, args) => input.execute(args),
    inputSchema: {
      additionalProperties: false,
      properties: {},
      required: [],
      type: 'object',
    },
    name: input.name,
  })
}

const buildDelegateResponse = (input: {
  agentAlias?: string
  callId?: string
  instructions?: string
  task: string
}): AiInteractionResponse => ({
  messages: [],
  model: 'gpt-5.4',
  output: [
    {
      arguments: {
        agentAlias: input.agentAlias ?? 'researcher',
        ...(input.instructions ? { instructions: input.instructions } : {}),
        task: input.task,
      },
      argumentsJson: JSON.stringify({
        agentAlias: input.agentAlias ?? 'researcher',
        ...(input.instructions ? { instructions: input.instructions } : {}),
        task: input.task,
      }),
      callId: input.callId ?? 'call_delegate_1',
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
        agentAlias: input.agentAlias ?? 'researcher',
        ...(input.instructions ? { instructions: input.instructions } : {}),
        task: input.task,
      },
      argumentsJson: JSON.stringify({
        agentAlias: input.agentAlias ?? 'researcher',
        ...(input.instructions ? { instructions: input.instructions } : {}),
        task: input.task,
      }),
      callId: input.callId ?? 'call_delegate_1',
      name: 'delegate_to_agent',
    },
  ],
  usage: null,
})

const buildReasoningDelegateResponse = (input: {
  agentAlias: string
  callId: string
  instructions?: string
  reasoning: string
  reasoningId: string
  task: string
}): AiInteractionResponse => ({
  messages: [],
  model: 'gpt-5.4',
  output: [
    {
      id: input.reasoningId,
      summary: [
        {
          text: input.reasoning,
          type: 'summary_text',
        },
      ],
      text: input.reasoning,
      type: 'reasoning',
    },
    {
      arguments: {
        agentAlias: input.agentAlias,
        ...(input.instructions ? { instructions: input.instructions } : {}),
        task: input.task,
      },
      argumentsJson: JSON.stringify({
        agentAlias: input.agentAlias,
        ...(input.instructions ? { instructions: input.instructions } : {}),
        task: input.task,
      }),
      callId: input.callId,
      name: 'delegate_to_agent',
      type: 'function_call',
    },
  ],
  outputText: '',
  provider: 'openai',
  providerRequestId: 'req_delegate_reasoning',
  raw: { stub: true },
  responseId: 'resp_delegate_reasoning',
  status: 'completed',
  toolCalls: [
    {
      arguments: {
        agentAlias: input.agentAlias,
        ...(input.instructions ? { instructions: input.instructions } : {}),
        task: input.task,
      },
      argumentsJson: JSON.stringify({
        agentAlias: input.agentAlias,
        ...(input.instructions ? { instructions: input.instructions } : {}),
        task: input.task,
      }),
      callId: input.callId,
      name: 'delegate_to_agent',
    },
  ],
  usage: null,
})

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

const buildReasoningAssistantResponse = (input: {
  reasoning: string
  reasoningId: string
  text: string
  webSearches?: AiInteractionResponse['webSearches']
}): AiInteractionResponse => ({
  messages: [
    {
      content: [{ text: input.text, type: 'text' }],
      role: 'assistant',
    },
  ],
  model: 'gpt-5.4',
  output: [
    {
      id: input.reasoningId,
      summary: [
        {
          text: input.reasoning,
          type: 'summary_text',
        },
      ],
      text: input.reasoning,
      type: 'reasoning',
    },
    {
      content: [{ text: input.text, type: 'text' }],
      role: 'assistant',
      type: 'message',
    },
  ],
  outputText: input.text,
  provider: 'openai',
  providerRequestId: 'req_reasoning_text',
  raw: { stub: true },
  responseId: 'resp_reasoning_text',
  status: 'completed',
  toolCalls: [],
  usage: null,
  webSearches: input.webSearches ?? [],
})

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

test('worker times out expired waits, persists timeout failure, and resumes the run', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const timeoutAt = '2000-01-01T00:00:00.000Z'
  const timeoutEnvelope = {
    error: {
      message: 'Wait timed out before external input arrived',
      type: 'timeout',
    },
    ok: false,
  }

  registerFunctionTool(runtime, {
    execute: async () =>
      ok({
        kind: 'waiting' as const,
        wait: {
          description: 'Waiting for upstream system',
          targetKind: 'external' as const,
          targetRef: 'job_timeout_1',
          timeoutAt,
          type: 'tool' as const,
        },
      }),
    name: 'await_upstream',
  })

  const bootstrap = await bootstrapPlannerRun(app, headers)
  let callCount = 0
  let resumedRequest: AiInteractionRequest | null = null

  runtime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    callCount += 1

    if (callCount === 1) {
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_timeout_wait_1',
            name: 'await_upstream',
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_timeout_wait_1',
        raw: { stub: true },
        responseId: 'resp_timeout_wait_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_timeout_wait_1',
            name: 'await_upstream',
          },
        ],
        usage: null,
      })
    }

    resumedRequest = request

    return ok(buildAssistantResponse('Timeout recovered and the run completed.'))
  }

  const execution = await executeRun(app, headers, bootstrap.data.runId)

  assert.equal(execution.response.status, 202)
  assert.equal(execution.body.data.status, 'waiting')
  assert.equal(runtime.db.select().from(runDependencies).get()?.status, 'pending')
  assert.equal(
    runtime.db
      .select()
      .from(jobs)
      .all()
      .find((workItem) => workItem.currentRunId === bootstrap.data.runId)?.nextSchedulerCheckAt,
    timeoutAt,
  )

  const worked = await runtime.services.multiagent.processAvailableDecisions()

  assert.equal(worked, true)
  assert.equal(callCount, 2)

  const waitRow = runtime.db.select().from(runDependencies).get()
  const toolRow = runtime.db.select().from(toolExecutions).get()
  const runRow = runtime.db.select().from(runs).where(eq(runs.id, bootstrap.data.runId)).get()
  const resumedEvent = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .find((event) => event.type === 'run.resumed')
  const eventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .map((event) => event.type)

  assert.equal(waitRow?.status, 'timed_out')
  assert.deepEqual(waitRow?.resolutionJson, {
    error: 'Wait timed out before external input arrived',
    timeoutAt,
  })
  assert.equal(toolRow?.errorText, 'Wait timed out before external input arrived')
  assert.deepEqual(toolRow?.outcomeJson, timeoutEnvelope)
  assert.equal(runRow?.status, 'completed')
  assert.equal(eventTypes.includes('wait.timed_out'), true)
  assert.equal(eventTypes.includes('tool.failed'), true)
  assert.equal(eventTypes.includes('run.resumed'), true)
  assert.equal(
    (resumedEvent?.payload as { reason?: unknown } | undefined)?.reason,
    'dependencies_satisfied',
  )

  assert.ok(resumedRequest)
  assert.equal(resumedRequest?.messages.at(-1)?.role, 'tool')
  assert.deepEqual(resumedRequest?.messages.at(-1)?.content[0], {
    callId: 'call_timeout_wait_1',
    isError: true,
    name: 'await_upstream',
    outputJson: JSON.stringify(timeoutEnvelope),
    type: 'function_result',
  })
})

test('runtime startup reconciliation times out expired waits and resumes the run before polling starts', async () => {
  const harness = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { app, config, runtime } = harness
  const { headers } = seedApiKeyAuth(runtime)
  const timeoutAt = '2000-01-01T00:00:00.000Z'
  let initialCallCount = 0
  let restartCallCount = 0

  registerFunctionTool(runtime, {
    execute: async () =>
      ok({
        kind: 'waiting' as const,
        wait: {
          description: 'Waiting for upstream system',
          targetKind: 'external' as const,
          targetRef: 'job_timeout_startup_1',
          timeoutAt,
          type: 'tool' as const,
        },
      }),
    name: 'await_upstream_startup',
  })

  const bootstrap = await bootstrapPlannerRun(app, headers)

  runtime.services.ai.interactions.generate = async () => {
    initialCallCount += 1

    return ok<AiInteractionResponse>({
      messages: [],
      model: 'gpt-5.4',
      output: [
        {
          arguments: {},
          argumentsJson: '{}',
          callId: 'call_timeout_startup_wait_1',
          name: 'await_upstream_startup',
          type: 'function_call',
        },
      ],
      outputText: '',
      provider: 'openai',
      providerRequestId: 'req_timeout_startup_wait_1',
      raw: { stub: true },
      responseId: 'resp_timeout_startup_wait_1',
      status: 'completed',
      toolCalls: [
        {
          arguments: {},
          argumentsJson: '{}',
          callId: 'call_timeout_startup_wait_1',
          name: 'await_upstream_startup',
        },
      ],
      usage: null,
    })
  }

  const execution = await executeRun(app, headers, bootstrap.data.runId)

  assert.equal(execution.response.status, 202)
  assert.equal(execution.body.data.status, 'waiting')

  await closeAppRuntime(runtime)

  const restartedRuntime = createAppRuntime(config)
  restartedRuntime.services.ai.interactions.generate = async () => {
    restartCallCount += 1
    return ok(buildAssistantResponse('Startup timeout reconciliation resumed the run.'))
  }
  wireStreamingStub(restartedRuntime)

  await initializeAppRuntime(restartedRuntime)

  const waitRow = restartedRuntime.db.select().from(runDependencies).get()
  const toolRow = restartedRuntime.db.select().from(toolExecutions).get()
  const runRow = restartedRuntime.db
    .select()
    .from(runs)
    .where(eq(runs.id, bootstrap.data.runId))
    .get()
  const assistantReply = restartedRuntime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.runId, bootstrap.data.runId))
    .all()
    .find((message) => message.authorKind === 'assistant')

  assert.equal(initialCallCount, 1)
  assert.equal(restartCallCount, 1)
  assert.equal(waitRow?.status, 'timed_out')
  assert.equal(toolRow?.errorText, 'Wait timed out before external input arrived')
  assert.equal(runRow?.status, 'completed')
  assert.equal(assistantReply?.content[0]?.text, 'Startup timeout reconciliation resumed the run.')
  assert.equal(
    restartedRuntime.db
      .select()
      .from(domainEvents)
      .all()
      .some((event) => event.type === 'wait.timed_out'),
    true,
  )

  await closeAppRuntime(restartedRuntime)
})

test('timeout recovery interrupted after wait resolution resumes once on restart without duplicating timeout history', async () => {
  const harness = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { app, config, runtime } = harness
  const { headers } = seedApiKeyAuth(runtime)
  const timeoutAt = '2000-01-01T00:00:00.000Z'
  let initialCallCount = 0
  let restartCallCount = 0
  let simulatedCrash = false

  registerFunctionTool(runtime, {
    execute: async () =>
      ok({
        kind: 'waiting' as const,
        wait: {
          description: 'Waiting for upstream system',
          targetKind: 'external' as const,
          targetRef: 'job_timeout_restart_1',
          timeoutAt,
          type: 'tool' as const,
        },
      }),
    name: 'await_upstream_timeout_restart',
  })

  const bootstrap = await bootstrapPlannerRun(app, headers)

  runtime.services.ai.interactions.generate = async () => {
    initialCallCount += 1

    return ok<AiInteractionResponse>({
      messages: [],
      model: 'gpt-5.4',
      output: [
        {
          arguments: {},
          argumentsJson: '{}',
          callId: 'call_timeout_restart_wait_1',
          name: 'await_upstream_timeout_restart',
          type: 'function_call',
        },
      ],
      outputText: '',
      provider: 'openai',
      providerRequestId: 'req_timeout_restart_wait_1',
      raw: { stub: true },
      responseId: 'resp_timeout_restart_wait_1',
      status: 'completed',
      toolCalls: [
        {
          arguments: {},
          argumentsJson: '{}',
          callId: 'call_timeout_restart_wait_1',
          name: 'await_upstream_timeout_restart',
        },
      ],
      usage: null,
    })
  }

  const execution = await executeRun(app, headers, bootstrap.data.runId)

  assert.equal(execution.response.status, 202)
  assert.equal(execution.body.data.status, 'waiting')

  const originalTransaction = runtime.db.transaction.bind(runtime.db)
  ;(
    runtime.db as unknown as {
      transaction: typeof runtime.db.transaction
    }
  ).transaction = ((callback: Parameters<typeof runtime.db.transaction>[0]) => {
    const result = originalTransaction(callback)
    const waitRow = runtime.db.select().from(runDependencies).get()

    if (!simulatedCrash && waitRow?.status === 'timed_out') {
      simulatedCrash = true
      throw new Error('Simulated crash after timeout resolution')
    }

    return result
  }) as typeof runtime.db.transaction

  try {
    const reconciled = await runtime.services.multiagent.reconcileDecisions({
      kinds: ['recover_timed_out_wait'],
      mode: 'startup',
    })
    assert.equal(reconciled.ok, false)
    if (reconciled.ok) {
      throw new Error('expected reconciliation to report the simulated crash')
    }
    assert.equal(reconciled.error.type, 'conflict')
    assert.match(reconciled.error.message, /Simulated crash after timeout resolution/)
  } finally {
    ;(
      runtime.db as unknown as {
        transaction: typeof runtime.db.transaction
      }
    ).transaction = originalTransaction
  }

  const midWait = runtime.db.select().from(runDependencies).get()
  const midTool = runtime.db.select().from(toolExecutions).get()
  const midRun = runtime.db.select().from(runs).where(eq(runs.id, bootstrap.data.runId)).get()
  const midEventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .map((event) => event.type)

  assert.equal(simulatedCrash, true)
  assert.equal(initialCallCount, 1)
  assert.equal(midWait?.status, 'timed_out')
  assert.equal(midTool?.errorText, 'Wait timed out before external input arrived')
  assert.equal(midRun?.status, 'waiting')
  assert.equal(midEventTypes.filter((type) => type === 'wait.timed_out').length, 1)
  assert.equal(midEventTypes.filter((type) => type === 'tool.failed').length, 1)
  assert.equal(midEventTypes.filter((type) => type === 'run.resumed').length, 0)

  await closeAppRuntime(runtime)

  const restartedRuntime = createAppRuntime(config)
  restartedRuntime.services.ai.interactions.generate = async () => {
    restartCallCount += 1
    return ok(buildAssistantResponse('Restart completed after the timeout recovery crash.'))
  }
  wireStreamingStub(restartedRuntime)

  await initializeAppRuntime(restartedRuntime)
  await drainWorker(restartedRuntime)

  const finalWait = restartedRuntime.db.select().from(runDependencies).get()
  const finalRun = restartedRuntime.db
    .select()
    .from(runs)
    .where(eq(runs.id, bootstrap.data.runId))
    .get()
  const assistantReply = restartedRuntime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.runId, bootstrap.data.runId))
    .all()
    .find((message) => message.authorKind === 'assistant')
  const finalEventTypes = restartedRuntime.db
    .select()
    .from(domainEvents)
    .all()
    .map((event) => event.type)

  assert.equal(restartCallCount, 1)
  assert.equal(finalWait?.status, 'timed_out')
  assert.equal(finalRun?.status, 'completed')
  assert.equal(
    assistantReply?.content[0]?.text,
    'Restart completed after the timeout recovery crash.',
  )
  assert.equal(finalEventTypes.filter((type) => type === 'wait.timed_out').length, 1)
  assert.equal(finalEventTypes.filter((type) => type === 'tool.failed').length, 1)
  assert.equal(finalEventTypes.filter((type) => type === 'run.resumed').length, 1)

  await closeAppRuntime(restartedRuntime)
})

test('worker falls back to child assistant message text when the child provider omits outputText', async () => {
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
  const rootRunId = bootstrap.data.runId
  const childAssistantText = 'Jenny is doing well and ready to help.'
  let rootCallCount = 0
  let resumedParentRequest: AiInteractionRequest | null = null

  runtime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    const runId = request.metadata?.runId

    if (runId === rootRunId && rootCallCount === 0) {
      rootCallCount += 1
      return ok(
        buildDelegateResponse({
          task: 'Ask Jenny how she is.',
        }),
      )
    }

    if (runId !== rootRunId) {
      return ok(buildAssistantResponse(childAssistantText, ''))
    }

    resumedParentRequest = request
    return ok(buildAssistantResponse('Jenny says she is doing well and ready to help.'))
  }

  const executeResult = await executeRun(app, headers, rootRunId)

  assert.equal(executeResult.response.status, 202)
  await drainWorker(runtime)

  const runRows = runtime.db.select().from(runs).all()
  const rootRun = runRows.find((run) => run.id === rootRunId)
  const childRun = runRows.find((run) => run.id !== rootRunId)
  const parentToolOutput = runtime.db
    .select()
    .from(items)
    .all()
    .find((item) => item.runId === rootRunId && item.type === 'function_call_output')
  const rootAssistantMessage = runtime.db
    .select()
    .from(sessionMessages)
    .all()
    .find((message) => message.runId === rootRunId && message.authorKind === 'assistant')

  assert.equal(rootRun?.status, 'completed')
  assert.equal(childRun?.status, 'completed')
  assert.equal(
    (childRun?.resultJson as { outputText?: string } | null | undefined)?.outputText,
    childAssistantText,
  )
  assert.match(
    String(parentToolOutput?.output),
    /"summary":"Jenny is doing well and ready to help\."/,
  )
  assert.equal(String(parentToolOutput?.output).includes('childRunId'), false)
  assert.equal(String(parentToolOutput?.output).includes('providerRequestId'), false)
  assert.equal(String(parentToolOutput?.output).includes('responseId'), false)
  assert.ok(resumedParentRequest)
  const resumedParentTranscript = JSON.stringify(resumedParentRequest?.messages)
  assert.match(resumedParentTranscript, /Jenny is doing well and ready to help\./)
  assert.equal(resumedParentTranscript.includes('"childRunId":"run_'), false)
  assert.equal(resumedParentTranscript.includes('providerRequestId'), false)
  assert.equal(resumedParentTranscript.includes('assistantMessageId'), false)
  assert.deepEqual(rootAssistantMessage?.content, [
    { text: 'Jenny says she is doing well and ready to help.', type: 'text' },
  ])
})

test('worker executes a pending child run, delivers its result, and auto-resumes the waiting parent', async () => {
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
  const rootRunId = bootstrap.data.runId
  let rootCallCount = 0

  runtime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    const runId = request.metadata?.runId

    if (runId === rootRunId && rootCallCount === 0) {
      rootCallCount += 1
      return ok(
        buildDelegateResponse({
          instructions: 'Research the additive SQLite migration strategy.',
          task: 'Research SQLite migrations',
        }),
      )
    }

    if (runId !== rootRunId) {
      const rootRunBeforeChildStart = runtime.db
        .select()
        .from(runs)
        .where(eq(runs.id, rootRunId))
        .get()

      assert.equal(rootRunBeforeChildStart?.status, 'waiting')
      return ok(
        buildAssistantResponse(
          'Use additive columns and tenant-safe triggers instead of table rebuilds.',
        ),
      )
    }

    assert.equal(request.messages.at(-1)?.role, 'tool')
    return ok(
      buildAssistantResponse(
        'We should keep additive migrations and avoid destructive SQLite table rebuilds.',
      ),
    )
  }

  const executeResult = await executeRun(app, headers, rootRunId)

  assert.equal(executeResult.response.status, 202)
  await drainWorker(runtime)

  const runRows = runtime.db.select().from(runs).all()
  const rootRun = runRows.find((run) => run.id === rootRunId)
  const childRun = runRows.find((run) => run.id !== rootRunId)
  const parentToolOutput = runtime.db
    .select()
    .from(items)
    .all()
    .find((item) => item.runId === rootRunId && item.type === 'function_call_output')

  assert.equal(rootRun?.status, 'completed')
  assert.equal(childRun?.status, 'completed')
  assert.equal(runtime.db.select().from(runDependencies).get()?.status, 'resolved')
  assert.equal(
    runtime.db
      .select()
      .from(sessionMessages)
      .all()
      .filter((message) => message.runId === childRun?.id).length,
    0,
  )
  assert.match(String(parentToolOutput?.output), /"kind":"completed"/)
  assert.match(
    String(parentToolOutput?.output),
    /"summary":"Use additive columns and tenant-safe triggers instead of table rebuilds\."/,
  )
  assert.equal(String(parentToolOutput?.output).includes('childRunId'), false)
  assert.equal(
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .some((event) => event.type === 'child_run.completed'),
    true,
  )
})

test('worker persists recursive delegated child transcript blocks on the parent assistant message', async () => {
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
    nativeTools: ['delegate_to_agent'],
    profile: 'research',
    provider: 'openai',
    revisionId: 'agr_researcher_v1',
    slug: 'researcher',
    tenantId,
  })
  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_analyst',
    modelAlias: 'gpt-5.4',
    name: 'Analyst',
    profile: 'analysis',
    provider: 'openai',
    revisionId: 'agr_analyst_v1',
    slug: 'analyst',
    tenantId,
  })
  seedSubagentLink(runtime, {
    alias: 'researcher',
    childAgentId: 'agt_researcher',
    id: 'asl_orchestrator_researcher',
    parentAgentRevisionId: 'agr_orchestrator_v1',
    tenantId,
  })
  seedSubagentLink(runtime, {
    alias: 'analyst',
    childAgentId: 'agt_analyst',
    id: 'asl_researcher_analyst',
    parentAgentRevisionId: 'agr_researcher_v1',
    tenantId,
  })

  const bootstrap = await bootstrapSession(app, headers, 'agt_orchestrator')
  const rootRunId = bootstrap.data.runId
  const invocationCounts = new Map<string, number>()
  const grandchildWebSearch = {
    id: 'web_search:resp_recursive_child_1',
    patterns: ['sqlite migration'],
    provider: 'openai' as const,
    queries: ['sqlite additive migrations official guidance'],
    references: [
      {
        domain: 'sqlite.org',
        title: 'SQLite ALTER TABLE',
        url: 'https://sqlite.org/lang_altertable.html',
      },
    ],
    responseId: 'resp_recursive_child_1',
    status: 'completed' as const,
    targetUrls: ['https://sqlite.org/lang_altertable.html'],
  }

  runtime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    const runId = String(request.metadata?.runId)
    const invocationCount = invocationCounts.get(runId) ?? 0
    invocationCounts.set(runId, invocationCount + 1)

    const runRows = runtime.db.select().from(runs).all()
    const childRun = runRows.find((candidate) => candidate.parentRunId === rootRunId)
    const grandchildRun = childRun
      ? runRows.find((candidate) => candidate.parentRunId === childRun.id)
      : undefined

    if (runId === rootRunId && invocationCount === 0) {
      return ok(
        buildDelegateResponse({
          agentAlias: 'researcher',
          callId: 'call_delegate_root',
          task: 'Ask Researcher to validate the SQLite migration plan.',
        }),
      )
    }

    if (runId === rootRunId) {
      return ok(buildAssistantResponse('Researcher confirmed the additive migration plan.'))
    }

    if (childRun && runId === childRun.id && invocationCount === 0) {
      return ok(
        buildReasoningDelegateResponse({
          agentAlias: 'analyst',
          callId: 'call_delegate_child',
          reasoning: 'Need the analyst to verify the SQLite migration guidance before replying.',
          reasoningId: 'rs_child_delegate_1',
          task: 'Ask Analyst to confirm additive SQLite migrations.',
        }),
      )
    }

    if (childRun && runId === childRun.id) {
      return ok(
        buildAssistantResponse(
          'Analyst confirmed that additive SQLite migrations are the safe path here.',
        ),
      )
    }

    if (grandchildRun && runId === grandchildRun.id) {
      return ok(
        buildReasoningAssistantResponse({
          reasoning: 'Need one official SQLite source before finalizing the recommendation.',
          reasoningId: 'rs_grandchild_1',
          text: 'SQLite supports additive schema changes through ALTER TABLE operations.',
          webSearches: [grandchildWebSearch],
        }),
      )
    }

    throw new Error(`unexpected run id in recursive transcript test: ${runId}`)
  }

  const executeResult = await executeRun(app, headers, rootRunId)

  assert.equal(executeResult.response.status, 202)
  await drainWorker(runtime)

  const runRows = runtime.db.select().from(runs).all()
  const rootRun = runRows.find((candidate) => candidate.id === rootRunId)
  const childRun = runRows.find((candidate) => candidate.parentRunId === rootRunId)
  const grandchildRun = childRun
    ? runRows.find((candidate) => candidate.parentRunId === childRun.id)
    : undefined

  assert.equal(rootRun?.status, 'completed')
  assert.equal(childRun?.status, 'completed')
  assert.equal(grandchildRun?.status, 'completed')

  const rootAssistantMessage = runtime.db
    .select()
    .from(sessionMessages)
    .all()
    .find((message) => message.runId === rootRunId && message.authorKind === 'assistant')

  const transcriptBlocks = (
    rootAssistantMessage?.metadata as {
      transcript?: {
        blocks?: Array<Record<string, unknown>>
      }
    } | null
  )?.transcript?.blocks

  assert.equal(
    rootAssistantMessage?.content[0]?.text,
    'Researcher confirmed the additive migration plan.',
  )
  assert.ok(Array.isArray(transcriptBlocks))
  assert.equal(
    transcriptBlocks?.some(
      (block) =>
        block.type === 'tool_interaction' &&
        block.toolCallId === 'call_delegate_root' &&
        block.childRunId === childRun?.id,
    ),
    true,
  )
  assert.equal(
    transcriptBlocks?.some(
      (block) =>
        block.type === 'thinking' &&
        block.sourceRunId === childRun?.id &&
        block.content ===
          'Need the analyst to verify the SQLite migration guidance before replying.',
    ),
    true,
  )
  assert.equal(
    transcriptBlocks?.some(
      (block) =>
        block.type === 'tool_interaction' &&
        block.toolCallId === 'call_delegate_child' &&
        block.sourceRunId === childRun?.id &&
        block.childRunId === grandchildRun?.id,
    ),
    true,
  )
  assert.equal(
    transcriptBlocks?.some(
      (block) =>
        block.type === 'thinking' &&
        block.sourceRunId === grandchildRun?.id &&
        block.content === 'Need one official SQLite source before finalizing the recommendation.',
    ),
    true,
  )
  assert.equal(
    transcriptBlocks?.some(
      (block) =>
        block.type === 'web_search' &&
        block.sourceRunId === grandchildRun?.id &&
        Array.isArray(block.queries) &&
        block.queries.includes('sqlite additive migrations official guidance'),
    ),
    true,
  )
  assert.equal(
    transcriptBlocks?.some(
      (block) =>
        block.type === 'text' &&
        block.sourceRunId === grandchildRun?.id &&
        block.content === 'SQLite supports additive schema changes through ALTER TABLE operations.',
    ),
    true,
  )
  assert.equal(
    transcriptBlocks?.some(
      (block) =>
        block.type === 'text' &&
        block.sourceRunId === childRun?.id &&
        block.content ===
          'Analyst confirmed that additive SQLite migrations are the safe path here.',
    ),
    true,
  )
})

test('worker maps a failed child run into a structured envelope and resumes the parent once', async () => {
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
  const rootRunId = bootstrap.data.runId
  let rootCallCount = 0

  runtime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    const runId = request.metadata?.runId

    if (runId === rootRunId && rootCallCount === 0) {
      rootCallCount += 1
      return ok(
        buildDelegateResponse({
          task: 'Research the broken upstream provider',
        }),
      )
    }

    if (runId !== rootRunId) {
      return err({
        message: 'Upstream provider exploded',
        provider: 'openai',
        type: 'provider',
      })
    }

    return ok(
      buildAssistantResponse('The child failed, so I will surface the failure and stop here.'),
    )
  }

  const executeResult = await executeRun(app, headers, rootRunId)

  assert.equal(executeResult.response.status, 202)
  await drainWorker(runtime)

  const runRows = runtime.db.select().from(runs).all()
  const rootRun = runRows.find((run) => run.id === rootRunId)
  const childRun = runRows.find((run) => run.id !== rootRunId)
  const parentToolOutput = runtime.db
    .select()
    .from(items)
    .all()
    .find((item) => item.runId === rootRunId && item.type === 'function_call_output')

  assert.equal(rootRun?.status, 'completed')
  assert.equal(childRun?.status, 'failed')
  assert.match(String(parentToolOutput?.output), /"kind":"failed"/)
  assert.match(String(parentToolOutput?.output), /Upstream provider exploded/)
})

test('worker can deliver a previously completed child run after restart without duplicating parent delivery', async () => {
  const harness = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { app, config, runtime } = harness
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
  const rootRunId = bootstrap.data.runId

  runtime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    const runId = request.metadata?.runId

    if (runId === rootRunId) {
      return ok(
        buildDelegateResponse({
          task: 'Research restart-safe delivery',
        }),
      )
    }

    return ok(buildAssistantResponse('The child completed before the worker delivered its result.'))
  }

  const executeResult = await executeRun(app, headers, rootRunId)

  assert.equal(executeResult.response.status, 202)

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

  assert.equal(
    childExecution.ok,
    true,
    childExecution.ok ? undefined : childExecution.error.message,
  )
  assert.equal(runtime.db.select().from(runDependencies).get()?.status, 'pending')
  assert.equal(
    runtime.db
      .select()
      .from(items)
      .all()
      .filter((item) => item.runId === rootRunId && item.type === 'function_call_output').length,
    0,
  )

  await closeAppRuntime(runtime)

  const restartedRuntime = createAppRuntime(config)
  restartedRuntime.services.ai.interactions.generate = async () =>
    ok(buildAssistantResponse('The restarted worker delivered the child result exactly once.'))
  wireStreamingStub(restartedRuntime)

  await restartedRuntime.services.multiagent.processAvailableDecisions()
  await restartedRuntime.services.multiagent.processAvailableDecisions()

  const restartedParentOutputs = restartedRuntime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.runId === rootRunId && item.type === 'function_call_output')
  const restartedRootRun = restartedRuntime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id === rootRunId)

  assert.equal(restartedRootRun?.status, 'completed')
  assert.equal(restartedParentOutputs.length, 1)

  await closeAppRuntime(restartedRuntime)
})

test('cancelling a parent run cascades to joined pending children', async () => {
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
  const rootRunId = bootstrap.data.runId

  runtime.services.ai.interactions.generate = async () =>
    ok(
      buildDelegateResponse({
        task: 'Prepare the joined child run',
      }),
    )

  const executeResult = await executeRun(app, headers, rootRunId)

  assert.equal(executeResult.response.status, 202)

  const childRunId = runtime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id !== rootRunId)?.id

  assert.ok(childRunId)

  const cancelResult = await cancelRun(app, headers, rootRunId)

  assert.equal(cancelResult.response.status, 200)

  const runRows = runtime.db.select().from(runs).all()
  const rootRun = runRows.find((run) => run.id === rootRunId)
  const childRun = runRows.find((run) => run.id === childRunId)

  assert.equal(rootRun?.status, 'cancelled')
  assert.equal(childRun?.status, 'cancelled')
  assert.equal(runtime.db.select().from(runDependencies).get()?.status, 'cancelled')
  assert.equal(runtime.db.select().from(toolExecutions).get()?.errorText, 'Run cancelled')
  assert.equal(
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.type === 'run.cancelled').length,
    2,
  )
})

test('run claims preserve ownership until expiry', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)

  seedActiveAgent(runtime, {
    accountId,
    agentId: 'agt_planner',
    modelAlias: 'gpt-5.4',
    name: 'Planner',
    profile: 'planner',
    provider: 'openai',
    revisionId: 'agr_planner_v1',
    slug: 'planner',
    tenantId,
  })

  const rooted = await bootstrapSession(app, headers, 'agt_planner')
  const scope = {
    accountId: asAccountId(accountId),
    role: 'admin' as const,
    tenantId: asTenantId(tenantId),
  }
  const claimRepository = createRunClaimRepository(runtime.db)

  const firstClaim = claimRepository.claim(scope, {
    acquiredAt: '2026-03-30T06:00:00.000Z',
    expiresAt: '2026-03-30T06:00:10.000Z',
    renewedAt: '2026-03-30T06:00:00.000Z',
    runId: asRunId(rooted.data.runId),
    workerId: 'wrk_a',
  })

  assert.equal(firstClaim.ok, true)

  const conflictingClaim = claimRepository.claim(scope, {
    acquiredAt: '2026-03-30T06:00:05.000Z',
    expiresAt: '2026-03-30T06:00:15.000Z',
    renewedAt: '2026-03-30T06:00:05.000Z',
    runId: asRunId(rooted.data.runId),
    workerId: 'wrk_b',
  })

  assert.equal(conflictingClaim.ok, false)
  assert.equal(conflictingClaim.error.type, 'conflict')

  const renewedByOwner = claimRepository.heartbeatClaim(scope, {
    expiresAt: '2026-03-30T06:00:16.000Z',
    renewedAt: '2026-03-30T06:00:06.000Z',
    runId: asRunId(rooted.data.runId),
    workerId: 'wrk_a',
  })

  assert.equal(renewedByOwner.ok, true)
  assert.equal(renewedByOwner.value.expiresAt, '2026-03-30T06:00:16.000Z')

  const conflictingAfterHeartbeat = claimRepository.claim(scope, {
    acquiredAt: '2026-03-30T06:00:11.000Z',
    expiresAt: '2026-03-30T06:00:21.000Z',
    renewedAt: '2026-03-30T06:00:11.000Z',
    runId: asRunId(rooted.data.runId),
    workerId: 'wrk_b',
  })

  assert.equal(conflictingAfterHeartbeat.ok, false)
  assert.equal(conflictingAfterHeartbeat.error.type, 'conflict')

  const acquiredAfterExpiry = claimRepository.claim(scope, {
    acquiredAt: '2026-03-30T06:00:20.000Z',
    expiresAt: '2026-03-30T06:00:30.000Z',
    renewedAt: '2026-03-30T06:00:20.000Z',
    runId: asRunId(rooted.data.runId),
    workerId: 'wrk_b',
  })

  assert.equal(acquiredAfterExpiry.ok, true)
  assert.equal(acquiredAfterExpiry.value.workerId, 'wrk_b')
})

test('worker heartbeats the child run claim while execution is still in flight', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    MULTIAGENT_LEASE_TTL_MS: '60',
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
  const rootRunId = bootstrap.data.runId
  let rootCallCount = 0

  runtime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    const runId = request.metadata?.runId

    if (runId === rootRunId && rootCallCount === 0) {
      rootCallCount += 1
      return ok(
        buildDelegateResponse({
          task: 'Hold the claim long enough to require a heartbeat',
        }),
      )
    }

    if (runId !== rootRunId) {
      await new Promise((resolve) => setTimeout(resolve, 120))
      return ok(buildAssistantResponse('The child finished after a claim heartbeat.'))
    }

    return ok(buildAssistantResponse('The parent resumed after the claim stayed owned.'))
  }

  const executeResult = await executeRun(app, headers, rootRunId)

  assert.equal(executeResult.response.status, 202)

  const childRunId = runtime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id !== rootRunId)?.id

  assert.ok(childRunId)

  const scope = {
    accountId: asAccountId(accountId),
    role: 'admin' as const,
    tenantId: asTenantId(tenantId),
  }
  const claimRepository = createRunClaimRepository(runtime.db)
  const workerPass = runtime.services.multiagent.processAvailableDecisions()

  await new Promise((resolve) => setTimeout(resolve, 90))

  const conflictingClaim = claimRepository.claim(scope, {
    acquiredAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    renewedAt: new Date().toISOString(),
    runId: asRunId(childRunId),
    workerId: 'wrk_competing',
  })

  assert.equal(conflictingClaim.ok, false)
  assert.equal(conflictingClaim.error.type, 'conflict')

  const childWorkItem = runtime.db
    .select()
    .from(jobs)
    .all()
    .find((workItem) => workItem.currentRunId === childRunId)

  assert.equal(childWorkItem?.status, 'running')
  assert.ok(childWorkItem?.lastHeartbeatAt)
  assert.ok(childWorkItem?.nextSchedulerCheckAt)
  assert.equal(
    typeof childWorkItem?.lastHeartbeatAt === 'string' &&
      typeof childWorkItem?.nextSchedulerCheckAt === 'string' &&
      childWorkItem.nextSchedulerCheckAt > childWorkItem.lastHeartbeatAt,
    true,
  )

  await workerPass
  await drainWorker(runtime)
})

test('worker requeues stale running child runs after claim expiry and completes them on the next pass', async () => {
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
  const rootRunId = bootstrap.data.runId
  let rootCallCount = 0

  runtime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    const runId = request.metadata?.runId

    if (runId === rootRunId && rootCallCount === 0) {
      rootCallCount += 1
      return ok(
        buildDelegateResponse({
          task: 'Recover the stale child run',
        }),
      )
    }

    if (runId !== rootRunId) {
      return ok(buildAssistantResponse('The stale child run was recovered and executed.'))
    }

    return ok(buildAssistantResponse('The parent resumed after stale child recovery.'))
  }

  const executeResult = await executeRun(app, headers, rootRunId)

  assert.equal(executeResult.response.status, 202)

  const childRun = runtime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id !== rootRunId)
  const childWorkItem = runtime.db
    .select()
    .from(jobs)
    .all()
    .find((workItem) => workItem.currentRunId === childRun?.id)

  assert.ok(childRun)
  assert.ok(childWorkItem)

  runtime.db
    .update(runs)
    .set({
      lastProgressAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: childRun.version + 1,
    })
    .where(eq(runs.id, childRun.id))
    .run()
  runtime.db
    .update(jobs)
    .set({
      lastHeartbeatAt: '2026-01-01T00:00:00.000Z',
      nextSchedulerCheckAt: '2026-01-01T00:00:00.060Z',
      status: 'running',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: childWorkItem.version + 1,
    })
    .where(eq(jobs.id, childWorkItem.id))
    .run()

  runtime.db
    .insert(runClaims)
    .values({
      acquiredAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:00:30.000Z',
      renewedAt: '2026-01-01T00:00:00.000Z',
      runId: childRun.id,
      tenantId,
      workerId: 'wrk_stale',
    })
    .run()

  await drainWorker(runtime)

  const refreshedRuns = runtime.db.select().from(runs).all()
  const rootRun = refreshedRuns.find((run) => run.id === rootRunId)
  const refreshedChildRun = refreshedRuns.find((run) => run.id === childRun.id)

  assert.equal(rootRun?.status, 'completed')
  assert.equal(refreshedChildRun?.status, 'completed')
  assert.equal(refreshedChildRun?.staleRecoveryCount, 1)
  assert.equal(
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .some((event) => event.type === 'run.requeued'),
    true,
  )
})

test('runtime startup reconciliation requeues stale running child runs before worker execution resumes', async () => {
  const harness = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { app, config, runtime } = harness
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
  const rootRunId = bootstrap.data.runId
  let rootCallCount = 0

  runtime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    const runId = request.metadata?.runId

    if (runId === rootRunId && rootCallCount === 0) {
      rootCallCount += 1
      return ok(
        buildDelegateResponse({
          task: 'Recover the startup-stale child run',
        }),
      )
    }

    if (runId !== rootRunId) {
      return ok(buildAssistantResponse('The startup-stale child run was recovered and executed.'))
    }

    return ok(buildAssistantResponse('The parent resumed after startup reconciliation.'))
  }

  const executeResult = await executeRun(app, headers, rootRunId)

  assert.equal(executeResult.response.status, 202)

  const childRun = runtime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id !== rootRunId)
  const childWorkItem = runtime.db
    .select()
    .from(jobs)
    .all()
    .find((workItem) => workItem.currentRunId === childRun?.id)

  assert.ok(childRun)
  assert.ok(childWorkItem)

  runtime.db
    .update(runs)
    .set({
      lastProgressAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: childRun.version + 1,
    })
    .where(eq(runs.id, childRun.id))
    .run()
  runtime.db
    .update(jobs)
    .set({
      lastHeartbeatAt: '2026-01-01T00:00:00.000Z',
      nextSchedulerCheckAt: '2026-01-01T00:00:00.060Z',
      status: 'running',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: childWorkItem.version + 1,
    })
    .where(eq(jobs.id, childWorkItem.id))
    .run()

  runtime.db
    .insert(runClaims)
    .values({
      acquiredAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:00:30.000Z',
      renewedAt: '2026-01-01T00:00:00.000Z',
      runId: childRun.id,
      tenantId,
      workerId: 'wrk_startup_stale',
    })
    .run()

  await closeAppRuntime(runtime)

  const restartedRuntime = createAppRuntime(config)
  restartedRuntime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    const runId = request.metadata?.runId

    if (runId === rootRunId) {
      return ok(buildAssistantResponse('The parent resumed after startup reconciliation.'))
    }

    return ok(buildAssistantResponse('The startup-stale child run was recovered and executed.'))
  }
  wireStreamingStub(restartedRuntime)

  await initializeAppRuntime(restartedRuntime)

  const reconciledChildRun = restartedRuntime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id === childRun.id)

  assert.equal(reconciledChildRun?.status, 'pending')
  assert.equal(
    restartedRuntime.db
      .select()
      .from(domainEvents)
      .all()
      .some((event) => event.type === 'run.requeued'),
    true,
  )

  await drainWorker(restartedRuntime)

  const finalRuns = restartedRuntime.db.select().from(runs).all()
  const finalRootRun = finalRuns.find((run) => run.id === rootRunId)
  const finalChildRun = finalRuns.find((run) => run.id === childRun.id)

  assert.equal(finalRootRun?.status, 'completed')
  assert.equal(finalChildRun?.status, 'completed')

  await closeAppRuntime(restartedRuntime)
})

test('worker requeues stale running root runs after claim expiry and completes them on the next pass', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const bootstrap = await bootstrapPlannerRun(app, headers)
  const rootRunId = bootstrap.data.runId
  const initialRootRun = runtime.db.select().from(runs).where(eq(runs.id, rootRunId)).get()
  const rootJob = runtime.db
    .select()
    .from(jobs)
    .all()
    .find((workItem) => workItem.currentRunId === rootRunId)

  assert.ok(initialRootRun)
  assert.ok(rootJob)

  runtime.db
    .update(runs)
    .set({
      lastProgressAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: initialRootRun.version + 1,
    })
    .where(eq(runs.id, rootRunId))
    .run()
  runtime.db
    .update(jobs)
    .set({
      lastHeartbeatAt: '2026-01-01T00:00:00.000Z',
      nextSchedulerCheckAt: '2026-01-01T00:00:00.060Z',
      status: 'running',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: rootJob.version + 1,
    })
    .where(eq(jobs.id, rootJob.id))
    .run()

  runtime.services.ai.interactions.generate = async () =>
    ok(buildAssistantResponse('The stale root run was recovered by the worker.'))

  await drainWorker(runtime)

  const finalRootRun = runtime.db.select().from(runs).where(eq(runs.id, rootRunId)).get()
  const assistantReply = runtime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.runId, rootRunId))
    .all()
    .find((message) => message.authorKind === 'assistant')
  const requeueEvents = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .filter((event) => event.type === 'run.requeued')

  assert.equal(finalRootRun?.status, 'completed')
  assert.equal(finalRootRun?.staleRecoveryCount, 1)
  assert.equal(assistantReply?.content[0]?.text, 'The stale root run was recovered by the worker.')
  assert.equal(requeueEvents.length, 1)
  assert.deepEqual(requeueEvents[0]?.payload, {
    reason: 'claim_expired',
    recoveredFromStatus: 'running',
    runId: rootRunId,
    sessionId: bootstrap.data.sessionId,
    status: 'pending',
    threadId: bootstrap.data.threadId,
  })
})

test('worker delays repeated stale root run recovery until the configured backoff elapses', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    MULTIAGENT_STALE_RECOVERY_BASE_DELAY_MS: '50',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const bootstrap = await bootstrapPlannerRun(app, headers)
  const rootRunId = bootstrap.data.runId
  const initialRootRun = runtime.db.select().from(runs).where(eq(runs.id, rootRunId)).get()
  const rootJob = runtime.db
    .select()
    .from(jobs)
    .all()
    .find((workItem) => workItem.currentRunId === rootRunId)

  assert.ok(initialRootRun)
  assert.ok(rootJob)

  runtime.db
    .update(runs)
    .set({
      lastProgressAt: '2026-01-01T00:00:00.000Z',
      staleRecoveryCount: 1,
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: initialRootRun.version + 1,
    })
    .where(eq(runs.id, rootRunId))
    .run()
  runtime.db
    .update(jobs)
    .set({
      lastHeartbeatAt: '2026-01-01T00:00:00.000Z',
      nextSchedulerCheckAt: '2026-01-01T00:00:00.060Z',
      status: 'running',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: rootJob.version + 1,
    })
    .where(eq(jobs.id, rootJob.id))
    .run()

  runtime.services.ai.interactions.generate = async () =>
    ok(buildAssistantResponse('The delayed stale root run was recovered after backoff.'))

  const requeued = await runtime.services.multiagent.processOneDecision()
  assert.equal(requeued, true)

  const delayedRun = runtime.db.select().from(runs).where(eq(runs.id, rootRunId)).get()
  const delayedJob = runtime.db.select().from(jobs).where(eq(jobs.id, rootJob.id)).get()
  const immediateRetry = await runtime.services.multiagent.processOneDecision()
  const assistantBeforeDelay = runtime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.runId, rootRunId))
    .all()
    .find((message) => message.authorKind === 'assistant')

  assert.equal(delayedRun?.status, 'pending')
  assert.equal(delayedRun?.staleRecoveryCount, 2)
  assert.equal(delayedJob?.status, 'queued')
  assert.ok(delayedJob?.nextSchedulerCheckAt)
  assert.equal(immediateRetry, false)
  assert.equal(assistantBeforeDelay, undefined)

  await new Promise((resolve) => setTimeout(resolve, 70))

  const executed = await runtime.services.multiagent.processOneDecision()
  const finalRun = runtime.db.select().from(runs).where(eq(runs.id, rootRunId)).get()
  const assistantReply = runtime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.runId, rootRunId))
    .all()
    .find((message) => message.authorKind === 'assistant')

  assert.equal(executed, true)
  assert.equal(finalRun?.status, 'completed')
  assert.equal(
    assistantReply?.content[0]?.text,
    'The delayed stale root run was recovered after backoff.',
  )
})

test('worker fails a stale root run after the stale recovery limit is exhausted', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    MULTIAGENT_MAX_STALE_RECOVERIES: '1',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const bootstrap = await bootstrapPlannerRun(app, headers)
  const rootRunId = bootstrap.data.runId
  const initialRootRun = runtime.db.select().from(runs).where(eq(runs.id, rootRunId)).get()
  const rootJob = runtime.db
    .select()
    .from(jobs)
    .all()
    .find((workItem) => workItem.currentRunId === rootRunId)
  let generateCalls = 0

  assert.ok(initialRootRun)
  assert.ok(rootJob)

  runtime.db
    .update(runs)
    .set({
      lastProgressAt: '2026-01-01T00:00:00.000Z',
      staleRecoveryCount: 1,
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: initialRootRun.version + 1,
    })
    .where(eq(runs.id, rootRunId))
    .run()
  runtime.db
    .update(jobs)
    .set({
      lastHeartbeatAt: '2026-01-01T00:00:00.000Z',
      nextSchedulerCheckAt: '2026-01-01T00:00:00.060Z',
      status: 'running',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: rootJob.version + 1,
    })
    .where(eq(jobs.id, rootJob.id))
    .run()

  runtime.services.ai.interactions.generate = async () => {
    generateCalls += 1
    return ok(buildAssistantResponse('This response should never be generated.'))
  }

  const worked = await runtime.services.multiagent.processOneDecision()
  const failedRun = runtime.db.select().from(runs).where(eq(runs.id, rootRunId)).get()
  const blockedJob = runtime.db.select().from(jobs).where(eq(jobs.id, rootJob.id)).get()
  const requeueEvents = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .filter((event) => event.type === 'run.requeued')
  const failedEvents = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .filter((event) => event.type === 'run.failed')

  assert.equal(worked, true)
  assert.equal(generateCalls, 0)
  assert.equal(failedRun?.status, 'failed')
  assert.equal(
    (failedRun?.errorJson as { message?: string } | null | undefined)?.message,
    `run ${rootRunId} exceeded the configured maximum of 1 stale recovery attempts`,
  )
  assert.equal(blockedJob?.status, 'blocked')
  assert.equal(
    (blockedJob?.statusReasonJson as { error?: { message?: string } | null } | null | undefined)
      ?.error?.message,
    `run ${rootRunId} exceeded the configured maximum of 1 stale recovery attempts`,
  )
  assert.equal(requeueEvents.length, 0)
  assert.equal(failedEvents.length, 1)
})

test('runtime startup reconciliation requeues abandoned root runs and resumes them across repeated restarts', async () => {
  const harness = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { app, config, runtime } = harness
  const { headers } = seedApiKeyAuth(runtime)

  const bootstrap = await bootstrapPlannerRun(app, headers)
  const rootRunId = bootstrap.data.runId
  const rootJob = runtime.db
    .select()
    .from(jobs)
    .all()
    .find((workItem) => workItem.currentRunId === rootRunId)
  const initialRootRun = runtime.db.select().from(runs).where(eq(runs.id, rootRunId)).get()

  assert.ok(initialRootRun)
  assert.ok(rootJob)

  runtime.db
    .update(runs)
    .set({
      lastProgressAt: '2026-03-30T06:00:00.000Z',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
      updatedAt: '2026-03-30T06:00:00.000Z',
      version: initialRootRun.version + 1,
    })
    .where(eq(runs.id, rootRunId))
    .run()
  runtime.db
    .update(jobs)
    .set({
      lastHeartbeatAt: '2026-01-01T00:00:00.000Z',
      nextSchedulerCheckAt: '2026-01-01T00:00:00.060Z',
      status: 'running',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: rootJob.version + 1,
    })
    .where(eq(jobs.id, rootJob.id))
    .run()

  await closeAppRuntime(runtime)

  const firstRestart = createAppRuntime(config)
  firstRestart.services.ai.interactions.generate = async () =>
    ok(buildAssistantResponse('The abandoned root run resumed after restart.'))
  wireStreamingStub(firstRestart)

  await initializeAppRuntime(firstRestart)

  const requeuedRootRun = firstRestart.db.select().from(runs).where(eq(runs.id, rootRunId)).get()
  const requeuedRootJob = firstRestart.db
    .select()
    .from(jobs)
    .all()
    .find((workItem) => workItem.currentRunId === rootRunId)

  assert.equal(requeuedRootRun?.status, 'pending')
  assert.equal(requeuedRootRun?.resultJson, null)
  assert.equal(requeuedRootRun?.staleRecoveryCount, 0)
  assert.equal(
    (requeuedRootJob?.statusReasonJson as { reason?: string } | null)?.reason,
    'process_restarted',
  )
  assert.equal((requeuedRootJob?.statusReasonJson as { runId?: string } | null)?.runId, rootRunId)
  assert.equal(
    firstRestart.db
      .select()
      .from(domainEvents)
      .all()
      .some((event) => event.type === 'run.requeued'),
    true,
  )
  assert.equal(
    firstRestart.db.select().from(jobs).where(eq(jobs.id, rootJob.id)).get()?.status,
    'queued',
  )

  await closeAppRuntime(firstRestart)

  const secondRestart = createAppRuntime(config)
  secondRestart.services.ai.interactions.generate = async () =>
    ok(buildAssistantResponse('The abandoned root run resumed after restart.'))
  wireStreamingStub(secondRestart)

  await initializeAppRuntime(secondRestart)

  const pendingRecoveredRootRun = secondRestart.db
    .select()
    .from(runs)
    .where(eq(runs.id, rootRunId))
    .get()

  assert.equal(pendingRecoveredRootRun?.status, 'pending')

  await drainWorker(secondRestart)

  const completedRootRun = secondRestart.db.select().from(runs).where(eq(runs.id, rootRunId)).get()
  const assistantReply = secondRestart.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.runId, rootRunId))
    .all()
    .find((message) => message.authorKind === 'assistant')

  assert.equal(completedRootRun?.status, 'completed')
  assert.equal(assistantReply?.content[0]?.text, 'The abandoned root run resumed after restart.')

  await closeAppRuntime(secondRestart)
})

test('runtime startup reconciliation resumes waiting runs whose last wait was already resolved', async () => {
  const harness = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { app, config, runtime } = harness
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const runIdToRecover = (await bootstrapPlannerRun(app, headers)).data.runId
  const resolvedToolOutput = {
    source: 'recovery_test',
    status: 'queued',
  }
  let generationCount = 0

  registerFunctionTool(runtime, {
    execute: async () =>
      ok({
        kind: 'waiting' as const,
        wait: {
          description: 'Waiting for recovered upstream work',
          targetKind: 'external' as const,
          targetRef: 'job_resume_1',
          type: 'tool' as const,
        },
      }),
    name: 'await_resume',
  })

  runtime.services.ai.interactions.generate = async () => {
    generationCount += 1

    if (generationCount === 1) {
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_resume_wait_1',
            name: 'await_resume',
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_resume_wait_1',
        raw: { stub: true },
        responseId: 'resp_resume_wait_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: {},
            argumentsJson: '{}',
            callId: 'call_resume_wait_1',
            name: 'await_resume',
          },
        ],
        usage: null,
      })
    }

    return ok(buildAssistantResponse('Recovered waiting run resumed after restart.'))
  }

  const execution = await executeRun(app, headers, runIdToRecover)

  assert.equal(execution.response.status, 202)
  assert.equal(execution.body.data.status, 'waiting')

  const context = createInternalCommandContext(runtime, {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  })
  const itemRepository = createItemRepository(runtime.db)
  const toolExecutionRepository = createToolExecutionRepository(runtime.db)
  const runDependencyRepository = createRunDependencyRepository(runtime.db)
  const runDependency = runDependencyRepository.listByRunId(
    context.tenantScope,
    asRunId(runIdToRecover),
  )

  assert.ok(runDependency.ok)
  assert.equal(runDependency.value.length, 1)

  const resolvedAt = '2026-03-30T14:00:00.000Z'
  const completedTool = toolExecutionRepository.complete(context.tenantScope, {
    completedAt: resolvedAt,
    durationMs: null,
    id: runDependency.value[0].callId,
    outcomeJson: resolvedToolOutput,
  })

  assert.ok(completedTool.ok)

  const nextSequence = itemRepository.getNextSequence(context.tenantScope, asRunId(runIdToRecover))

  assert.ok(nextSequence.ok)

  const outputItem = itemRepository.createFunctionCallOutput(context.tenantScope, {
    callId: runDependency.value[0].callId,
    createdAt: resolvedAt,
    id: asItemId(runtime.services.ids.create('itm')),
    output: JSON.stringify(resolvedToolOutput),
    providerPayload: {
      isError: false,
      name: 'await_resume',
    },
    runId: asRunId(runIdToRecover),
    sequence: nextSequence.value,
  })

  assert.ok(outputItem.ok)

  const resolvedWait = runDependencyRepository.resolve(context.tenantScope, {
    id: runDependency.value[0].id,
    resolutionJson: {
      output: resolvedToolOutput,
    },
    resolvedAt,
    status: 'resolved',
  })

  assert.ok(resolvedWait.ok)

  await closeAppRuntime(runtime)

  const restartedRuntime = createAppRuntime(config)
  restartedRuntime.services.ai.interactions.generate = async () => {
    generationCount += 1
    return ok(buildAssistantResponse('Recovered waiting run resumed after restart.'))
  }
  wireStreamingStub(restartedRuntime)

  await initializeAppRuntime(restartedRuntime)
  await drainWorker(restartedRuntime)

  const finalRun = restartedRuntime.db.select().from(runs).where(eq(runs.id, runIdToRecover)).get()
  const assistantReply = restartedRuntime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.runId, runIdToRecover))
    .all()
    .find((message) => message.authorKind === 'assistant')
  const resumedEvent = restartedRuntime.db
    .select()
    .from(domainEvents)
    .all()
    .find((event) => event.type === 'run.resumed')

  assert.equal(generationCount, 2)
  assert.equal(finalRun?.status, 'completed')
  assert.equal(restartedRuntime.db.select().from(runDependencies).get()?.status, 'resolved')
  assert.equal(assistantReply?.content[0]?.text, 'Recovered waiting run resumed after restart.')
  assert.equal(
    restartedRuntime.db
      .select()
      .from(domainEvents)
      .all()
      .some((event) => event.type === 'run.resumed'),
    true,
  )
  assert.equal(
    (resumedEvent?.payload as { reason?: unknown } | undefined)?.reason,
    'process_restarted',
  )

  await closeAppRuntime(restartedRuntime)
})

test('runtime startup reconciliation delivers completed child results before worker polling resumes', async () => {
  const harness = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { app, config, runtime } = harness
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
  const rootRunId = bootstrap.data.runId
  let initialRootCallCount = 0
  let restartedRootCallCount = 0

  runtime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    const runId = request.metadata?.runId

    if (runId === rootRunId) {
      initialRootCallCount += 1
      return ok(
        buildDelegateResponse({
          task: 'Recover startup child delivery',
        }),
      )
    }

    return ok(buildAssistantResponse('The child finished before restart.'))
  }

  const executeResult = await executeRun(app, headers, rootRunId)

  assert.equal(executeResult.response.status, 202)

  const childRunId = runtime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id !== rootRunId)?.id

  assert.ok(childRunId)

  const childExecution = await createExecuteRunCommand().execute(
    createInternalCommandContext(runtime, {
      accountId: asAccountId(accountId),
      role: 'admin',
      tenantId: asTenantId(tenantId),
    }),
    asRunId(childRunId),
    {},
  )

  assert.equal(
    childExecution.ok,
    true,
    childExecution.ok ? undefined : childExecution.error.message,
  )
  assert.equal(runtime.db.select().from(runDependencies).get()?.status, 'pending')
  assert.equal(
    runtime.db
      .select()
      .from(items)
      .all()
      .filter((item) => item.runId === rootRunId && item.type === 'function_call_output').length,
    0,
  )

  await closeAppRuntime(runtime)

  const restartedRuntime = createAppRuntime(config)
  restartedRuntime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    if (request.metadata?.runId === rootRunId) {
      restartedRootCallCount += 1
      return ok(buildAssistantResponse('Startup child delivery reconciliation resumed the parent.'))
    }

    return ok(buildAssistantResponse('Unexpected child execution after restart.'))
  }
  wireStreamingStub(restartedRuntime)

  await initializeAppRuntime(restartedRuntime)

  const restartedParentOutputs = restartedRuntime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.runId === rootRunId && item.type === 'function_call_output')
  const restartedRootRun = restartedRuntime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id === rootRunId)
  const assistantReply = restartedRuntime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.runId, rootRunId))
    .all()
    .find((message) => message.authorKind === 'assistant')

  assert.equal(initialRootCallCount, 1)
  assert.equal(restartedRootCallCount, 1)
  assert.equal(restartedRootRun?.status, 'completed')
  assert.equal(restartedParentOutputs.length, 1)
  assert.equal(
    assistantReply?.content[0]?.text,
    'Startup child delivery reconciliation resumed the parent.',
  )
  assert.equal(
    restartedRuntime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.type === 'child_run.completed').length,
    1,
  )

  await closeAppRuntime(restartedRuntime)
})

test('child delivery interrupted after wait resolution resumes once on restart without duplicating child completion history', async () => {
  const harness = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { app, config, runtime } = harness
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  let simulatedCrash = false
  let initialRootCallCount = 0
  let restartRootCallCount = 0

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
  const rootRunId = bootstrap.data.runId

  runtime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    const runId = request.metadata?.runId

    if (runId === rootRunId) {
      initialRootCallCount += 1
      return ok(
        buildDelegateResponse({
          task: 'Research the restart-safe child delivery crash',
        }),
      )
    }

    return ok(buildAssistantResponse('The child finished before the parent resumed.'))
  }

  const executeResult = await executeRun(app, headers, rootRunId)

  assert.equal(executeResult.response.status, 202)

  const childRunId = runtime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id !== rootRunId)?.id

  assert.ok(childRunId)

  const childExecution = await createExecuteRunCommand().execute(
    createInternalCommandContext(runtime, {
      accountId: asAccountId(accountId),
      role: 'admin',
      tenantId: asTenantId(tenantId),
    }),
    asRunId(childRunId),
    {},
  )

  assert.equal(
    childExecution.ok,
    true,
    childExecution.ok ? undefined : childExecution.error.message,
  )

  const originalTransaction = runtime.db.transaction.bind(runtime.db)
  ;(
    runtime.db as unknown as {
      transaction: typeof runtime.db.transaction
    }
  ).transaction = ((callback: Parameters<typeof runtime.db.transaction>[0]) => {
    const result = originalTransaction(callback)
    const waitRow = runtime.db.select().from(runDependencies).get()
    const parentOutputs = runtime.db
      .select()
      .from(items)
      .all()
      .filter((item) => item.runId === rootRunId && item.type === 'function_call_output')
    const rootRun = runtime.db.select().from(runs).where(eq(runs.id, rootRunId)).get()

    if (
      !simulatedCrash &&
      waitRow?.status === 'resolved' &&
      parentOutputs.length === 1 &&
      rootRun?.status === 'waiting'
    ) {
      simulatedCrash = true
      throw new Error('Simulated crash after child wait resolution')
    }

    return result
  }) as typeof runtime.db.transaction

  try {
    const reconciled = await runtime.services.multiagent.reconcileDecisions({
      kinds: ['deliver_resolved_child_result'],
      mode: 'startup',
    })
    assert.equal(reconciled.ok, false)
    if (reconciled.ok) {
      throw new Error('expected reconciliation to report the simulated crash')
    }
    assert.equal(reconciled.error.type, 'conflict')
    assert.match(reconciled.error.message, /Simulated crash after child wait resolution/)
  } finally {
    ;(
      runtime.db as unknown as {
        transaction: typeof runtime.db.transaction
      }
    ).transaction = originalTransaction
  }

  const midWait = runtime.db.select().from(runDependencies).get()
  const midRun = runtime.db.select().from(runs).where(eq(runs.id, rootRunId)).get()
  const midParentOutputs = runtime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.runId === rootRunId && item.type === 'function_call_output')
  const midEventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .map((event) => event.type)

  assert.equal(simulatedCrash, true)
  assert.equal(initialRootCallCount, 1)
  assert.equal(midWait?.status, 'resolved')
  assert.equal(midRun?.status, 'waiting')
  assert.equal(midParentOutputs.length, 1)
  assert.equal(midEventTypes.filter((type) => type === 'child_run.completed').length, 1)
  assert.equal(midEventTypes.filter((type) => type === 'run.resumed').length, 0)

  await closeAppRuntime(runtime)

  const restartedRuntime = createAppRuntime(config)
  restartedRuntime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    if (request.metadata?.runId === rootRunId) {
      restartRootCallCount += 1
      return ok(
        buildAssistantResponse(
          'Restart resumed the parent exactly once after child delivery crash.',
        ),
      )
    }

    return ok(
      buildAssistantResponse('Unexpected child execution after child-delivery recovery restart.'),
    )
  }
  wireStreamingStub(restartedRuntime)

  await initializeAppRuntime(restartedRuntime)
  await drainWorker(restartedRuntime)

  const finalWait = restartedRuntime.db.select().from(runDependencies).get()
  const finalRun = restartedRuntime.db.select().from(runs).where(eq(runs.id, rootRunId)).get()
  const finalParentOutputs = restartedRuntime.db
    .select()
    .from(items)
    .all()
    .filter((item) => item.runId === rootRunId && item.type === 'function_call_output')
  const assistantReply = restartedRuntime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.runId, rootRunId))
    .all()
    .find((message) => message.authorKind === 'assistant')
  const finalEventTypes = restartedRuntime.db
    .select()
    .from(domainEvents)
    .all()
    .map((event) => event.type)

  assert.equal(restartRootCallCount, 1)
  assert.equal(finalWait?.status, 'resolved')
  assert.equal(finalRun?.status, 'completed')
  assert.equal(finalParentOutputs.length, 1)
  assert.equal(
    assistantReply?.content[0]?.text,
    'Restart resumed the parent exactly once after child delivery crash.',
  )
  assert.equal(finalEventTypes.filter((type) => type === 'child_run.completed').length, 1)
  assert.equal(finalEventTypes.filter((type) => type === 'run.resumed').length, 1)

  await closeAppRuntime(restartedRuntime)
})

test('child delivery leaves parent reopen/resume to the readiness engine when dependency waits are satisfied', async () => {
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
  const rootRunId = bootstrap.data.runId
  let rootCallCount = 0

  runtime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    if (request.metadata?.runId === rootRunId && rootCallCount === 0) {
      rootCallCount += 1
      return ok(
        buildDelegateResponse({
          task: 'Resolve the child dependency before resuming the parent',
        }),
      )
    }

    if (request.metadata?.runId !== rootRunId) {
      return ok(buildAssistantResponse('Child dependency completed.'))
    }

    return ok(buildAssistantResponse('Parent resumed after graph reopen.'))
  }

  const executeResult = await executeRun(app, headers, rootRunId)

  assert.equal(executeResult.response.status, 202)

  const childRunId = runtime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id !== rootRunId)?.id

  assert.ok(childRunId)

  const childExecution = await createExecuteRunCommand().execute(
    createInternalCommandContext(runtime, {
      accountId: asAccountId(accountId),
      role: 'admin',
      tenantId: asTenantId(tenantId),
    }),
    asRunId(childRunId),
    {},
  )

  assert.equal(
    childExecution.ok,
    true,
    childExecution.ok ? undefined : childExecution.error.message,
  )

  const delivered = await runtime.services.multiagent.reconcileDecisions({
    kinds: ['deliver_resolved_child_result'],
    mode: 'startup',
  })
  assert.equal(delivered.ok, true, delivered.ok ? undefined : delivered.error.message)
  assert.equal(delivered.value, 1)

  const waitingParentWorkItem = runtime.db
    .select()
    .from(jobs)
    .all()
    .find((workItem) => workItem.currentRunId === rootRunId)
  const resolvedWait = runtime.db.select().from(runDependencies).get()
  const midEventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .map((event) => event.type)

  assert.equal(resolvedWait?.status, 'resolved')
  assert.equal(waitingParentWorkItem?.status, 'waiting')
  assert.equal(midEventTypes.filter((type) => type === 'job.requeued').length, 0)

  const reopened = await runtime.services.multiagent.reconcileDecisions({
    kinds: ['requeue_waiting_job'],
    mode: 'startup',
  })
  assert.equal(reopened.ok, true, reopened.ok ? undefined : reopened.error.message)
  assert.equal(reopened.value, 1)

  const reopenedParentWorkItem = runtime.db
    .select()
    .from(jobs)
    .all()
    .find((workItem) => workItem.currentRunId === rootRunId)
  const eventTypes = runtime.db
    .select()
    .from(domainEvents)
    .all()
    .map((event) => event.type)

  assert.equal(reopenedParentWorkItem?.status, 'queued')
  assert.equal(eventTypes.includes('job.requeued'), true)

  const recoverableWaitingRuns = await runtime.services.multiagent.reconcileDecisions({
    kinds: ['resume_waiting_run'],
    mode: 'startup',
  })
  assert.equal(
    recoverableWaitingRuns.ok,
    true,
    recoverableWaitingRuns.ok ? undefined : recoverableWaitingRuns.error.message,
  )
  assert.equal(recoverableWaitingRuns.value, 1)
})

test('worker executes pending bootstrap root runs without an explicit execute request', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapPlannerRun(app, headers)

  runtime.services.ai.interactions.generate = async () =>
    ok(buildAssistantResponse('Bootstrap run was recovered by the worker.'))

  const pendingBootstrapRun = runtime.db
    .select()
    .from(runs)
    .where(eq(runs.id, bootstrap.data.runId))
    .get()
  const pendingBootstrapWorkItem = runtime.db
    .select()
    .from(jobs)
    .all()
    .find((workItem) => workItem.currentRunId === bootstrap.data.runId)
  const bootstrapReason = pendingBootstrapWorkItem?.statusReasonJson as
    | {
        reason?: string
        runId?: string
        source?: string
      }
    | null
    | undefined

  assert.equal(pendingBootstrapRun?.status, 'pending')
  assert.equal(bootstrapReason?.reason, 'session.bootstrap')
  assert.equal(bootstrapReason?.runId, bootstrap.data.runId)
  assert.equal(bootstrapReason?.source, 'session.bootstrap')

  await drainWorker(runtime)

  const completedBootstrapRun = runtime.db
    .select()
    .from(runs)
    .where(eq(runs.id, bootstrap.data.runId))
    .get()
  const assistantReply = runtime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.runId, bootstrap.data.runId))
    .all()
    .find((message) => message.authorKind === 'assistant')

  assert.equal(completedBootstrapRun?.status, 'completed')
  assert.equal(assistantReply?.content[0]?.text, 'Bootstrap run was recovered by the worker.')

  await closeAppRuntime(runtime)
})

test('runtime startup reconciliation executes interrupted bootstrap root runs after restart', async () => {
  const harness = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { app, config, runtime } = harness
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapPlannerRun(app, headers)

  await closeAppRuntime(runtime)

  const restartedRuntime = createAppRuntime(config)
  restartedRuntime.services.ai.interactions.generate = async () =>
    ok(buildAssistantResponse('Bootstrap run resumed after restart.'))
  wireStreamingStub(restartedRuntime)

  await initializeAppRuntime(restartedRuntime)
  await drainWorker(restartedRuntime)

  const recoveredRun = restartedRuntime.db
    .select()
    .from(runs)
    .where(eq(runs.id, bootstrap.data.runId))
    .get()
  const assistantReply = restartedRuntime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.runId, bootstrap.data.runId))
    .all()
    .find((message) => message.authorKind === 'assistant')

  assert.equal(recoveredRun?.status, 'completed')
  assert.equal(assistantReply?.content[0]?.text, 'Bootstrap run resumed after restart.')

  await closeAppRuntime(restartedRuntime)
})

test('execute run rebuilds durable output when the worker already completed a bootstrap run first', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapPlannerRun(app, headers)

  runtime.services.ai.interactions.generate = async () =>
    ok(buildAssistantResponse('Bootstrap run completed before explicit execute.'))

  await drainWorker(runtime)

  const execution = await executeRun(app, headers, bootstrap.data.runId)

  assert.equal(execution.response.status, 200)
  assert.equal(execution.body.data.runId, bootstrap.data.runId)
  assert.equal(execution.body.data.status, 'completed')
  assert.equal(execution.body.data.outputText, 'Bootstrap run completed before explicit execute.')

  await closeAppRuntime(runtime)
})

test('worker executes pending root runs left behind after thread interaction creation is interrupted', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapPlannerRun(app, headers)
  const startThreadInteractionCommand = createStartThreadInteractionCommand()
  let generationCount = 0

  runtime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    generationCount += 1

    if (request.metadata?.runId === bootstrap.data.runId) {
      return ok(buildAssistantResponse('Initial bootstrap run completed.'))
    }

    return ok(buildAssistantResponse('Interrupted interaction run was recovered by the worker.'))
  }

  const initialExecution = await executeRun(app, headers, bootstrap.data.runId)

  assert.equal(initialExecution.response.status, 200)

  const commandContext = createInternalCommandContext(runtime, {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  })
  const startedInteraction = startThreadInteractionCommand.execute(
    commandContext,
    bootstrap.data.threadId,
    {
      text: 'Recover this interrupted interaction',
    },
  )

  assert.ok(startedInteraction.ok)

  const pendingInteractionRun = runtime.db
    .select()
    .from(runs)
    .where(eq(runs.id, startedInteraction.value.runId))
    .get()
  const pendingInteractionWorkItem = runtime.db
    .select()
    .from(jobs)
    .all()
    .find((workItem) => workItem.currentRunId === startedInteraction.value.runId)

  assert.equal(pendingInteractionRun?.status, 'pending')
  assert.equal(pendingInteractionRun?.resultJson, null)
  const interactionReason = pendingInteractionWorkItem?.statusReasonJson as
    | {
        inputMessageId?: string
        reason?: string
        runId?: string
        source?: string
      }
    | null
    | undefined

  assert.equal(interactionReason?.inputMessageId, startedInteraction.value.messageId)
  assert.equal(interactionReason?.reason, 'thread.interaction')
  assert.equal(interactionReason?.runId, startedInteraction.value.runId)
  assert.equal(interactionReason?.source, 'thread.interaction')

  await drainWorker(runtime)

  const completedInteractionRun = runtime.db
    .select()
    .from(runs)
    .where(eq(runs.id, startedInteraction.value.runId))
    .get()
  const assistantReply = runtime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.runId, startedInteraction.value.runId))
    .all()
    .find((message) => message.authorKind === 'assistant')

  assert.equal(generationCount, 2)
  assert.equal(completedInteractionRun?.status, 'completed')
  assert.equal(
    assistantReply?.content[0]?.text,
    'Interrupted interaction run was recovered by the worker.',
  )

  await closeAppRuntime(runtime)
})

test('runtime startup reconciliation executes interrupted thread interaction runs after restart', async () => {
  const harness = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { app, config, runtime } = harness
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapPlannerRun(app, headers)
  const startThreadInteractionCommand = createStartThreadInteractionCommand()

  runtime.services.ai.interactions.generate = async () =>
    ok(buildAssistantResponse('Initial bootstrap run completed.'))

  const initialExecution = await executeRun(app, headers, bootstrap.data.runId)

  assert.equal(initialExecution.response.status, 200)

  const commandContext = createInternalCommandContext(runtime, {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  })
  const startedInteraction = startThreadInteractionCommand.execute(
    commandContext,
    bootstrap.data.threadId,
    {
      text: 'Recover this interaction after restart',
    },
  )

  assert.ok(startedInteraction.ok)

  await closeAppRuntime(runtime)

  const restartedRuntime = createAppRuntime(config)
  restartedRuntime.services.ai.interactions.generate = async () =>
    ok(buildAssistantResponse('Interrupted interaction run resumed after restart.'))
  wireStreamingStub(restartedRuntime)

  await initializeAppRuntime(restartedRuntime)
  await drainWorker(restartedRuntime)

  const recoveredRun = restartedRuntime.db
    .select()
    .from(runs)
    .where(eq(runs.id, startedInteraction.value.runId))
    .get()
  const assistantReply = restartedRuntime.db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.runId, startedInteraction.value.runId))
    .all()
    .find((message) => message.authorKind === 'assistant')

  assert.equal(recoveredRun?.status, 'completed')
  assert.equal(
    assistantReply?.content[0]?.text,
    'Interrupted interaction run resumed after restart.',
  )

  await closeAppRuntime(restartedRuntime)
})

test('repeated parent resume attempts resolve an agent wait once and append one child completion event', async () => {
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
  const rootRunId = bootstrap.data.runId
  let rootCallCount = 0

  runtime.services.ai.interactions.generate = async (request: AiInteractionRequest) => {
    const runId = request.metadata?.runId

    if (runId === rootRunId && rootCallCount === 0) {
      rootCallCount += 1
      return ok(
        buildDelegateResponse({
          task: 'Research the migration fix',
        }),
      )
    }

    if (runId !== rootRunId) {
      return ok(buildAssistantResponse('Use additive migrations.'))
    }

    return ok(buildAssistantResponse('Parent resumed exactly once.'))
  }

  const executeResult = await executeRun(app, headers, rootRunId)

  assert.equal(executeResult.response.status, 202)

  const childRunId = runtime.db
    .select()
    .from(runs)
    .all()
    .find((run) => run.id !== rootRunId)?.id
  const waitId = runtime.db.select().from(runDependencies).get()?.id

  assert.ok(childRunId)
  assert.ok(waitId)

  const scope = {
    accountId: asAccountId(accountId),
    role: 'admin' as const,
    tenantId: asTenantId(tenantId),
  }
  const context = createInternalCommandContext(runtime, scope)

  const childExecution = await createExecuteRunCommand().execute(context, asRunId(childRunId), {})

  assert.equal(childExecution.ok, true)

  const resumeCommand = createResumeRunCommand()
  const childResult = {
    childRunId,
    kind: 'completed' as const,
    result: {
      outputText: 'Use additive migrations.',
    },
    summary: 'Use additive migrations.',
  }

  const [firstResume, secondResume] = await Promise.all([
    resumeCommand.execute(context, asRunId(rootRunId), {
      output: childResult,
      waitId,
    }),
    resumeCommand.execute(context, asRunId(rootRunId), {
      output: childResult,
      waitId,
    }),
  ])

  const successfulResumes = [firstResume, secondResume].filter((result) => result.ok)
  const failedResumes = [firstResume, secondResume].filter((result) => !result.ok)

  await drainWorker(runtime)

  assert.equal(successfulResumes.length, 1)
  assert.equal(failedResumes.length, 1)
  assert.equal(failedResumes[0]?.error.type, 'conflict')
  assert.equal(
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.type === 'run.resumed').length,
    1,
  )
  assert.equal(
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.type === 'child_run.completed').length,
    1,
  )
})
