import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'
import { createRunRepository } from '../src/adapters/persistence/sqlite/runtime/run-repository'
import { createCancelRunCommand } from '../src/application/commands/cancel-run'
import { createInternalCommandContext } from '../src/application/commands/internal-command-context'
import { executeRunTurnLoop } from '../src/application/runtime/execution/drive-run'
import type { ToolContext } from '../src/application/tooling/tool-registry'
import {
  domainEvents,
  items,
  jobs,
  runDependencies,
  runs,
  sessionMessages,
  toolExecutions,
  usageLedger,
} from '../src/db/schema'
import type { AiInteractionRequest, AiInteractionResponse } from '../src/domain/ai/types'
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
