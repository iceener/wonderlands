import assert from 'node:assert/strict'
import { test } from 'vitest'
import { toRequestHash } from '../src/adapters/http/idempotency'
import { createHttpIdempotencyKeyRepository } from '../src/adapters/persistence/sqlite/operations/http-idempotency-key-repository'
import { createBootstrapSessionCommand } from '../src/application/commands/bootstrap-session'
import { createCancelRunCommand } from '../src/application/commands/cancel-run'
import { createExecuteRunCommand } from '../src/application/commands/execute-run'
import { createInternalCommandContext } from '../src/application/commands/internal-command-context'
import { createResumeRunCommand } from '../src/application/commands/resume-run'
import { createStartThreadInteractionCommand } from '../src/application/commands/start-thread-interaction'
import { domainEvents, runs, sessionMessages, workSessions } from '../src/db/schema'
import type { AiInteractionResponse } from '../src/domain/ai/types'
import { asAccountId, asTenantId } from '../src/shared/ids'
import { type err, ok } from '../src/shared/result'
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

test('bootstrap session execute retry with the same idempotency key executes the already-created pending run instead of creating a duplicate', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrapSessionCommand = createBootstrapSessionCommand()
  const commandContext = createInternalCommandContext(runtime, {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  })
  const idempotencyRepository = createHttpIdempotencyKeyRepository(runtime.db)
  const requestBody = {
    execute: true,
    initialMessage: 'Recover the interrupted bootstrap execution',
    maxOutputTokens: 64,
    title: 'Recovered bootstrap execution',
  }
  let generateCalls = 0

  runtime.services.ai.interactions.generate = async () => {
    generateCalls += 1

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Recovered bootstrap execution.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Recovered bootstrap execution.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Recovered bootstrap execution.',
      provider: 'openai',
      providerRequestId: 'req_bootstrap_execute_recovery_1',
      raw: { stub: true },
      responseId: 'resp_bootstrap_execute_recovery_1',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const begun = idempotencyRepository.begin(commandContext.tenantScope, {
    expiresAt: '2026-03-30T15:25:00.000Z',
    idempotencyKey: 'session-bootstrap-execute-recovery-1',
    now: '2026-03-30T15:20:00.000Z',
    requestHash: toRequestHash(requestBody),
    scope: 'POST /v1/sessions/bootstrap',
  })

  assert.ok(begun.ok)
  assert.equal(begun.value.kind, 'execute')

  const bootstrapped = bootstrapSessionCommand.execute(commandContext, requestBody)

  assert.ok(bootstrapped.ok)

  const progress = idempotencyRepository.recordProgress(commandContext.tenantScope, {
    id: begun.value.record.id,
    responseDataJson: {
      inputMessageId: bootstrapped.value.messageId,
      kind: 'bootstrap_session_started',
      runId: bootstrapped.value.runId,
      sessionId: bootstrapped.value.sessionId,
      threadId: bootstrapped.value.threadId,
    },
    updatedAt: '2026-03-30T15:20:01.000Z',
  })

  assert.ok(progress.ok)

  const retryResponse = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify(requestBody),
    headers: {
      ...headers,
      'content-type': 'application/json',
      'idempotency-key': 'session-bootstrap-execute-recovery-1',
    },
    method: 'POST',
  })
  const retryBody = await retryResponse.json()

  assert.equal(retryResponse.status, 201)
  assert.equal(retryBody.data.runId, bootstrapped.value.runId)
  assert.equal(retryBody.data.inputMessageId, bootstrapped.value.messageId)
  assert.equal(retryBody.data.status, 'completed')
  assert.equal(retryBody.data.outputText, 'Recovered bootstrap execution.')
  assert.equal(generateCalls, 1)
  assert.equal(runtime.db.select().from(workSessions).all().length, 1)
  assert.equal(runtime.db.select().from(runs).all().length, 1)
  assert.equal(runtime.db.select().from(sessionMessages).all().length, 2)
})

test('thread interaction retry with the same idempotency key executes the already-created pending run instead of creating a duplicate', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrapResponse = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Plan the next milestone for the API backend',
      title: 'Idempotent thread interaction',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const bootstrapBody = await bootstrapResponse.json()
  const commandContext = createInternalCommandContext(runtime, {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  })
  const executeRunCommand = createExecuteRunCommand()
  const startThreadInteractionCommand = createStartThreadInteractionCommand()
  const idempotencyRepository = createHttpIdempotencyKeyRepository(runtime.db)
  const interactionRequest = {
    text: 'Recover the interrupted interaction',
  }
  const scope = `POST /v1/threads/${bootstrapBody.data.threadId}/interactions`
  let generateCalls = 0

  runtime.services.ai.interactions.generate = async () => {
    generateCalls += 1

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [
            {
              text:
                generateCalls === 1
                  ? 'Bootstrap run completed.'
                  : 'Recovered existing interaction run.',
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
              text:
                generateCalls === 1
                  ? 'Bootstrap run completed.'
                  : 'Recovered existing interaction run.',
              type: 'text',
            },
          ],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText:
        generateCalls === 1 ? 'Bootstrap run completed.' : 'Recovered existing interaction run.',
      provider: 'openai',
      providerRequestId: `req_interaction_pending_${generateCalls}`,
      raw: { stub: true },
      responseId: `resp_interaction_pending_${generateCalls}`,
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const bootstrapExecute = await executeRunCommand.execute(
    commandContext,
    bootstrapBody.data.runId,
    {},
  )

  assert.ok(bootstrapExecute.ok)

  const startedInteraction = startThreadInteractionCommand.execute(
    commandContext,
    bootstrapBody.data.threadId,
    interactionRequest,
  )

  assert.ok(startedInteraction.ok)

  const begun = idempotencyRepository.begin(commandContext.tenantScope, {
    expiresAt: '2026-03-30T15:05:00.000Z',
    idempotencyKey: 'thread-interaction-pending-1',
    now: '2026-03-30T15:00:00.000Z',
    requestHash: toRequestHash({
      threadId: bootstrapBody.data.threadId,
      ...interactionRequest,
    }),
    scope,
  })

  assert.ok(begun.ok)
  assert.equal(begun.value.kind, 'execute')

  const progress = idempotencyRepository.recordProgress(commandContext.tenantScope, {
    id: begun.value.record.id,
    responseDataJson: {
      attachedFileIds: startedInteraction.value.attachedFileIds,
      inputMessageId: startedInteraction.value.messageId,
      kind: 'thread_interaction_started',
      runId: startedInteraction.value.runId,
      sessionId: startedInteraction.value.sessionId,
      threadId: startedInteraction.value.threadId,
    },
    updatedAt: '2026-03-30T15:00:01.000Z',
  })

  assert.ok(progress.ok)

  const retryResponse = await app.request(
    `http://local/v1/threads/${bootstrapBody.data.threadId}/interactions`,
    {
      body: JSON.stringify(interactionRequest),
      headers: {
        ...headers,
        'content-type': 'application/json',
        'idempotency-key': 'thread-interaction-pending-1',
      },
      method: 'POST',
    },
  )
  const retryBody = await retryResponse.json()

  assert.equal(retryResponse.status, 202)
  assert.equal(retryBody.data.runId, startedInteraction.value.runId)
  assert.equal(retryBody.data.inputMessageId, startedInteraction.value.messageId)
  assert.equal(retryBody.data.status, 'accepted')
  assert.equal(generateCalls, 1)
  assert.equal(runtime.db.select().from(runs).all().length, 2)
  assert.equal(runtime.db.select().from(sessionMessages).all().length, 3)
})

test('execute run retry with the same idempotency key rebuilds a completed durable run while the original request is still in progress', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const commandContext = createInternalCommandContext(runtime, {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  })
  const executeRunCommand = createExecuteRunCommand()
  const idempotencyRepository = createHttpIdempotencyKeyRepository(runtime.db)
  const executeRequest = {
    maxOutputTokens: 64,
  }
  const scope = `POST /v1/runs/${bootstrap.data.runId}/execute`
  let generateCalls = 0

  runtime.services.ai.interactions.generate = async () => {
    generateCalls += 1

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Recovered completed execute response.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Recovered completed execute response.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Recovered completed execute response.',
      provider: 'openai',
      providerRequestId: 'req_execute_recovery_1',
      raw: { stub: true },
      responseId: 'resp_execute_recovery_1',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const begun = idempotencyRepository.begin(commandContext.tenantScope, {
    expiresAt: '2026-03-30T15:25:00.000Z',
    idempotencyKey: 'run-execute-recovery-1',
    now: '2026-03-30T15:20:00.000Z',
    requestHash: toRequestHash({
      runId: bootstrap.data.runId,
      ...executeRequest,
    }),
    scope,
  })

  assert.ok(begun.ok)
  assert.equal(begun.value.kind, 'execute')

  const executed = await executeRunCommand.execute(
    commandContext,
    bootstrap.data.runId,
    executeRequest,
  )

  assert.ok(executed.ok)

  const retryResponse = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
    body: JSON.stringify(executeRequest),
    headers: {
      ...headers,
      'content-type': 'application/json',
      'idempotency-key': 'run-execute-recovery-1',
    },
    method: 'POST',
  })
  const retryBody = await retryResponse.json()

  assert.equal(retryResponse.status, 200)
  assert.equal(retryBody.data.runId, bootstrap.data.runId)
  assert.equal(retryBody.data.status, 'completed')
  assert.equal(retryBody.data.outputText, 'Recovered completed execute response.')
  assert.equal(generateCalls, 1)
  assert.equal(
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.type === 'run.started').length,
    1,
  )
})

test('resume run retry with the same idempotency key rebuilds durable output while the original request is still in progress', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const commandContext = createInternalCommandContext(runtime, {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  })
  const idempotencyRepository = createHttpIdempotencyKeyRepository(runtime.db)
  const resumeRunCommand = createResumeRunCommand()
  let generateCalls = 0

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

  runtime.services.ai.interactions.generate = async (request) => {
    generateCalls += 1

    if (generateCalls === 1) {
      return ok<AiInteractionResponse>({
        messages: [],
        model: 'gpt-5.4',
        output: [
          {
            arguments: { reportId: 'rpt_1' },
            argumentsJson: '{"reportId":"rpt_1"}',
            callId: 'call_report_idem_1',
            name: 'fetch_report',
            type: 'function_call',
          },
        ],
        outputText: '',
        provider: 'openai',
        providerRequestId: 'req_resume_recovery_1',
        raw: { stub: 'wait' },
        responseId: 'resp_resume_recovery_1',
        status: 'completed',
        toolCalls: [
          {
            arguments: { reportId: 'rpt_1' },
            argumentsJson: '{"reportId":"rpt_1"}',
            callId: 'call_report_idem_1',
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
          content: [{ text: 'Recovered resume response.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Recovered resume response.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Recovered resume response.',
      provider: 'openai',
      providerRequestId: 'req_resume_recovery_2',
      raw: { stub: 'final' },
      responseId: 'resp_resume_recovery_2',
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

  const resumeRequest = {
    output: {
      report: 'done',
    },
    waitId: executeBody.data.waitIds[0],
  }
  const scope = `POST /v1/runs/${bootstrap.data.runId}/resume`
  const begun = idempotencyRepository.begin(commandContext.tenantScope, {
    expiresAt: '2026-03-30T15:35:00.000Z',
    idempotencyKey: 'run-resume-recovery-1',
    now: '2026-03-30T15:30:00.000Z',
    requestHash: toRequestHash({
      runId: bootstrap.data.runId,
      ...resumeRequest,
    }),
    scope,
  })

  assert.ok(begun.ok)
  assert.equal(begun.value.kind, 'execute')

  const resumed = await resumeRunCommand.execute(
    commandContext,
    bootstrap.data.runId,
    resumeRequest,
  )

  assert.ok(resumed.ok)

  const retryResponse = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/resume`, {
    body: JSON.stringify(resumeRequest),
    headers: {
      ...headers,
      'content-type': 'application/json',
      'idempotency-key': 'run-resume-recovery-1',
    },
    method: 'POST',
  })
  const retryBody = await retryResponse.json()

  assert.equal(retryResponse.status, 202)
  assert.equal(retryBody.data.runId, bootstrap.data.runId)
  assert.equal(retryBody.data.status, 'accepted')

  await runtime.services.multiagent.processOneDecision()

  const recoveredRun = runtime.db
    .select()
    .from(runs)
    .all()
    .find((candidate) => candidate.id === bootstrap.data.runId)
  assert.equal(recoveredRun?.status, 'completed')
  assert.equal(generateCalls, 2)
  assert.equal(
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.type === 'run.resumed').length,
    1,
  )
})

test('cancel run retry with the same idempotency key replays durable cancelled state while the original request is still in progress', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrap = await bootstrapRun(app, headers)
  const cancelRunCommand = createCancelRunCommand()
  const commandContext = createInternalCommandContext(runtime, {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  })
  const idempotencyRepository = createHttpIdempotencyKeyRepository(runtime.db)

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
          callId: 'call_wait_idem_1',
          name: 'await_approval',
          type: 'function_call',
        },
      ],
      outputText: '',
      provider: 'openai',
      providerRequestId: 'req_cancel_recovery_1',
      raw: { stub: true },
      responseId: 'resp_cancel_recovery_1',
      status: 'completed',
      toolCalls: [
        {
          arguments: {},
          argumentsJson: '{}',
          callId: 'call_wait_idem_1',
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

  const cancelRequest = {
    reason: 'User aborted',
  }
  const scope = `POST /v1/runs/${bootstrap.data.runId}/cancel`
  const begun = idempotencyRepository.begin(commandContext.tenantScope, {
    expiresAt: '2026-03-30T15:45:00.000Z',
    idempotencyKey: 'run-cancel-recovery-1',
    now: '2026-03-30T15:40:00.000Z',
    requestHash: toRequestHash({
      runId: bootstrap.data.runId,
      ...cancelRequest,
    }),
    scope,
  })

  assert.ok(begun.ok)
  assert.equal(begun.value.kind, 'execute')

  const cancelled = cancelRunCommand.execute(commandContext, bootstrap.data.runId, cancelRequest)

  assert.ok(cancelled.ok)

  const retryResponse = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/cancel`, {
    body: JSON.stringify(cancelRequest),
    headers: {
      ...headers,
      'content-type': 'application/json',
      'idempotency-key': 'run-cancel-recovery-1',
    },
    method: 'POST',
  })
  const retryBody = await retryResponse.json()

  assert.equal(retryResponse.status, 200)
  assert.equal(retryBody.data.runId, bootstrap.data.runId)
  assert.equal(retryBody.data.status, 'cancelled')
  assert.equal(
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.type === 'run.cancelled').length,
    1,
  )
})

test('thread interaction retry with the same idempotency key replays a completed durable run instead of creating a duplicate', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const bootstrapResponse = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Plan the next milestone for the API backend',
      title: 'Idempotent thread interaction replay',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const bootstrapBody = await bootstrapResponse.json()
  const commandContext = createInternalCommandContext(runtime, {
    accountId: asAccountId(accountId),
    role: 'admin',
    tenantId: asTenantId(tenantId),
  })
  const executeRunCommand = createExecuteRunCommand()
  const startThreadInteractionCommand = createStartThreadInteractionCommand()
  const idempotencyRepository = createHttpIdempotencyKeyRepository(runtime.db)
  const interactionRequest = {
    text: 'Replay the already-finished interaction',
  }
  const scope = `POST /v1/threads/${bootstrapBody.data.threadId}/interactions`
  let generateCalls = 0

  runtime.services.ai.interactions.generate = async () => {
    generateCalls += 1

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [
            {
              text: generateCalls === 1 ? 'Bootstrap run completed.' : 'Completed interaction run.',
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
              text: generateCalls === 1 ? 'Bootstrap run completed.' : 'Completed interaction run.',
              type: 'text',
            },
          ],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: generateCalls === 1 ? 'Bootstrap run completed.' : 'Completed interaction run.',
      provider: 'openai',
      providerRequestId: `req_interaction_completed_${generateCalls}`,
      raw: { stub: true },
      responseId: `resp_interaction_completed_${generateCalls}`,
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const bootstrapExecute = await executeRunCommand.execute(
    commandContext,
    bootstrapBody.data.runId,
    {},
  )

  assert.ok(bootstrapExecute.ok)

  const startedInteraction = startThreadInteractionCommand.execute(
    commandContext,
    bootstrapBody.data.threadId,
    interactionRequest,
  )

  assert.ok(startedInteraction.ok)

  const interactionExecute = await executeRunCommand.execute(
    commandContext,
    startedInteraction.value.runId,
    {},
  )

  assert.ok(interactionExecute.ok)

  const begun = idempotencyRepository.begin(commandContext.tenantScope, {
    expiresAt: '2026-03-30T15:15:00.000Z',
    idempotencyKey: 'thread-interaction-completed-1',
    now: '2026-03-30T15:10:00.000Z',
    requestHash: toRequestHash({
      threadId: bootstrapBody.data.threadId,
      ...interactionRequest,
    }),
    scope,
  })

  assert.ok(begun.ok)
  assert.equal(begun.value.kind, 'execute')

  const progress = idempotencyRepository.recordProgress(commandContext.tenantScope, {
    id: begun.value.record.id,
    responseDataJson: {
      attachedFileIds: startedInteraction.value.attachedFileIds,
      inputMessageId: startedInteraction.value.messageId,
      kind: 'thread_interaction_started',
      runId: startedInteraction.value.runId,
      sessionId: startedInteraction.value.sessionId,
      threadId: startedInteraction.value.threadId,
    },
    updatedAt: '2026-03-30T15:10:01.000Z',
  })

  assert.ok(progress.ok)

  const retryResponse = await app.request(
    `http://local/v1/threads/${bootstrapBody.data.threadId}/interactions`,
    {
      body: JSON.stringify(interactionRequest),
      headers: {
        ...headers,
        'content-type': 'application/json',
        'idempotency-key': 'thread-interaction-completed-1',
      },
      method: 'POST',
    },
  )
  const retryBody = await retryResponse.json()

  assert.equal(retryResponse.status, 202)
  assert.equal(retryBody.data.runId, startedInteraction.value.runId)
  assert.equal(retryBody.data.inputMessageId, startedInteraction.value.messageId)
  assert.equal(retryBody.data.status, 'accepted')
  assert.equal(generateCalls, 2)
  assert.equal(runtime.db.select().from(runs).all().length, 2)
  assert.equal(runtime.db.select().from(sessionMessages).all().length, 4)
})
