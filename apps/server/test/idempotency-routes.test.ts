import assert from 'node:assert/strict'
import { test } from 'vitest'
import { toRequestHash } from '../src/adapters/http/idempotency'
import { createHttpIdempotencyKeyRepository } from '../src/adapters/persistence/sqlite/operations/http-idempotency-key-repository'
import { createBootstrapSessionCommand } from '../src/application/commands/bootstrap-session'
import { createCreateSessionCommand } from '../src/application/commands/create-session'
import { createCreateSessionThreadCommand } from '../src/application/commands/create-session-thread'
import { createInternalCommandContext } from '../src/application/commands/internal-command-context'
import { createPostThreadMessageCommand } from '../src/application/commands/post-thread-message'
import { domainEvents, runs, sessionMessages, sessionThreads, workSessions } from '../src/db/schema'
import type { AiInteractionResponse } from '../src/domain/ai/types'
import { asAccountId, asTenantId } from '../src/shared/ids'
import { ok } from '../src/shared/result'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

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

test('create session replays the original response when the same idempotency key is retried', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const requestBody = {
    metadata: {
      origin: 'idempotency-test',
    },
    title: 'Stable session create',
  }

  const firstResponse = await app.request('http://local/v1/sessions', {
    body: JSON.stringify(requestBody),
    headers: {
      ...headers,
      'content-type': 'application/json',
      'idempotency-key': 'session-create-1',
    },
    method: 'POST',
  })
  const firstBody = await firstResponse.json()

  const secondResponse = await app.request('http://local/v1/sessions', {
    body: JSON.stringify(requestBody),
    headers: {
      ...headers,
      'content-type': 'application/json',
      'idempotency-key': 'session-create-1',
    },
    method: 'POST',
  })
  const secondBody = await secondResponse.json()

  assert.equal(firstResponse.status, 201)
  assert.equal(secondResponse.status, 201)
  assert.equal(firstBody.data.id, secondBody.data.id)
  assert.equal(runtime.db.select().from(workSessions).all().length, 1)
  assert.equal(
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.type === 'session.created').length,
    1,
  )
})

test('create session rejects reused idempotency keys when the request payload changes', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const firstResponse = await app.request('http://local/v1/sessions', {
    body: JSON.stringify({
      title: 'First title',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
      'idempotency-key': 'session-create-2',
    },
    method: 'POST',
  })
  const secondResponse = await app.request('http://local/v1/sessions', {
    body: JSON.stringify({
      title: 'Second title',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
      'idempotency-key': 'session-create-2',
    },
    method: 'POST',
  })
  const secondBody = await secondResponse.json()

  assert.equal(firstResponse.status, 201)
  assert.equal(secondResponse.status, 409)
  assert.equal(secondBody.ok, false)
  assert.match(secondBody.error.message, /different request payload/)
  assert.equal(runtime.db.select().from(workSessions).all().length, 1)
})

test('create session replays the original response across /api and /v1 aliases', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const requestBody = {
    title: 'Alias-stable session create',
  }

  const firstResponse = await app.request('http://local/api/sessions', {
    body: JSON.stringify(requestBody),
    headers: {
      ...headers,
      'content-type': 'application/json',
      'idempotency-key': 'session-create-alias-1',
    },
    method: 'POST',
  })
  const firstBody = await firstResponse.json()
  const secondResponse = await app.request('http://local/v1/sessions', {
    body: JSON.stringify(requestBody),
    headers: {
      ...headers,
      'content-type': 'application/json',
      'idempotency-key': 'session-create-alias-1',
    },
    method: 'POST',
  })
  const secondBody = await secondResponse.json()

  assert.equal(firstResponse.status, 201)
  assert.equal(secondResponse.status, 201)
  assert.equal(firstBody.data.id, secondBody.data.id)
  assert.equal(runtime.db.select().from(workSessions).all().length, 1)
})

test('in-progress create routes replay durable progress for the same idempotency key', async () => {
  {
    const { app, runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
    const commandContext = createInternalCommandContext(runtime, {
      accountId: asAccountId(accountId),
      role: 'admin',
      tenantId: asTenantId(tenantId),
    })
    const createSessionCommand = createCreateSessionCommand()
    const idempotencyRepository = createHttpIdempotencyKeyRepository(runtime.db)
    const requestBody = {
      metadata: {
        origin: 'session-recovery',
      },
      title: 'Recovered session create',
    }

    const begun = idempotencyRepository.begin(commandContext.tenantScope, {
      expiresAt: '2026-03-30T15:15:00.000Z',
      idempotencyKey: 'session-create-recovery-1',
      now: '2026-03-30T15:10:00.000Z',
      requestHash: toRequestHash(requestBody),
      scope: 'POST /v1/sessions',
    })

    assert.ok(begun.ok)
    assert.equal(begun.value.kind, 'execute')

    const created = createSessionCommand.execute(commandContext, requestBody)

    assert.ok(created.ok)

    const progress = idempotencyRepository.recordProgress(commandContext.tenantScope, {
      id: begun.value.record.id,
      responseDataJson: created.value,
      updatedAt: '2026-03-30T15:10:01.000Z',
    })

    assert.ok(progress.ok)

    const retryResponse = await app.request('http://local/v1/sessions', {
      body: JSON.stringify(requestBody),
      headers: {
        ...headers,
        'content-type': 'application/json',
        'idempotency-key': 'session-create-recovery-1',
      },
      method: 'POST',
    })
    const retryBody = await retryResponse.json()

    assert.equal(retryResponse.status, 201)
    assert.equal(retryBody.data.id, created.value.id)
    assert.equal(runtime.db.select().from(workSessions).all().length, 1)
    assert.equal(
      runtime.db
        .select()
        .from(domainEvents)
        .all()
        .filter((event) => event.type === 'session.created').length,
      1,
    )
  }

  {
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
      initialMessage: 'Bootstrap through a lost response',
      title: 'Recovered bootstrap',
    }

    const begun = idempotencyRepository.begin(commandContext.tenantScope, {
      expiresAt: '2026-03-30T15:25:00.000Z',
      idempotencyKey: 'session-bootstrap-recovery-1',
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
      responseDataJson: bootstrapped.value,
      updatedAt: '2026-03-30T15:20:01.000Z',
    })

    assert.ok(progress.ok)

    const retryResponse = await app.request('http://local/v1/sessions/bootstrap', {
      body: JSON.stringify(requestBody),
      headers: {
        ...headers,
        'content-type': 'application/json',
        'idempotency-key': 'session-bootstrap-recovery-1',
      },
      method: 'POST',
    })
    const retryBody = await retryResponse.json()

    assert.equal(retryResponse.status, 201)
    assert.equal(retryBody.data.sessionId, bootstrapped.value.sessionId)
    assert.equal(retryBody.data.threadId, bootstrapped.value.threadId)
    assert.equal(retryBody.data.runId, bootstrapped.value.runId)
    assert.equal(runtime.db.select().from(workSessions).all().length, 1)
    assert.equal(runtime.db.select().from(runs).all().length, 1)
    assert.equal(runtime.db.select().from(sessionMessages).all().length, 1)
  }

  {
    const { app, runtime } = createTestHarness({
      AUTH_MODE: 'api_key',
      NODE_ENV: 'test',
    })
    const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
    const createSessionCommand = createCreateSessionCommand()
    const createSessionThreadCommand = createCreateSessionThreadCommand()
    const commandContext = createInternalCommandContext(runtime, {
      accountId: asAccountId(accountId),
      role: 'admin',
      tenantId: asTenantId(tenantId),
    })
    const idempotencyRepository = createHttpIdempotencyKeyRepository(runtime.db)
    const session = createSessionCommand.execute(commandContext, {
      title: 'Session for thread recovery',
    })

    assert.ok(session.ok)

    const requestBody = {
      title: 'Recovered thread create',
    }
    const scope = `POST /v1/sessions/${session.value.id}/threads`
    const begun = idempotencyRepository.begin(commandContext.tenantScope, {
      expiresAt: '2026-03-30T15:35:00.000Z',
      idempotencyKey: 'session-thread-recovery-1',
      now: '2026-03-30T15:30:00.000Z',
      requestHash: toRequestHash({
        sessionId: session.value.id,
        ...requestBody,
      }),
      scope,
    })

    assert.ok(begun.ok)
    assert.equal(begun.value.kind, 'execute')

    const createdThread = createSessionThreadCommand.execute(
      commandContext,
      session.value.id,
      requestBody,
    )

    assert.ok(createdThread.ok)

    const progress = idempotencyRepository.recordProgress(commandContext.tenantScope, {
      id: begun.value.record.id,
      responseDataJson: createdThread.value,
      updatedAt: '2026-03-30T15:30:01.000Z',
    })

    assert.ok(progress.ok)

    const retryResponse = await app.request(
      `http://local/v1/sessions/${session.value.id}/threads`,
      {
        body: JSON.stringify(requestBody),
        headers: {
          ...headers,
          'content-type': 'application/json',
          'idempotency-key': 'session-thread-recovery-1',
        },
        method: 'POST',
      },
    )
    const retryBody = await retryResponse.json()

    assert.equal(retryResponse.status, 201)
    assert.equal(retryBody.data.id, createdThread.value.id)
    assert.equal(runtime.db.select().from(sessionThreads).all().length, 1)
  }

  {
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
    const postThreadMessageCommand = createPostThreadMessageCommand()
    const requestBody = {
      text: 'Recovered posted message',
    }
    const scope = `POST /v1/threads/${bootstrap.data.threadId}/messages`
    const begun = idempotencyRepository.begin(commandContext.tenantScope, {
      expiresAt: '2026-03-30T15:55:00.000Z',
      idempotencyKey: 'thread-message-recovery-1',
      now: '2026-03-30T15:50:00.000Z',
      requestHash: toRequestHash({
        threadId: bootstrap.data.threadId,
        ...requestBody,
      }),
      scope,
    })

    assert.ok(begun.ok)
    assert.equal(begun.value.kind, 'execute')

    const posted = postThreadMessageCommand.execute(
      commandContext,
      bootstrap.data.threadId,
      requestBody,
    )

    assert.ok(posted.ok)

    const progress = idempotencyRepository.recordProgress(commandContext.tenantScope, {
      id: begun.value.record.id,
      responseDataJson: posted.value,
      updatedAt: '2026-03-30T15:50:01.000Z',
    })

    assert.ok(progress.ok)

    const retryResponse = await app.request(
      `http://local/v1/threads/${bootstrap.data.threadId}/messages`,
      {
        body: JSON.stringify(requestBody),
        headers: {
          ...headers,
          'content-type': 'application/json',
          'idempotency-key': 'thread-message-recovery-1',
        },
        method: 'POST',
      },
    )
    const retryBody = await retryResponse.json()

    assert.equal(retryResponse.status, 201)
    assert.equal(retryBody.data.messageId, posted.value.messageId)
    assert.equal(runtime.db.select().from(sessionMessages).all().length, 2)
    assert.equal(
      runtime.db
        .select()
        .from(domainEvents)
        .all()
        .filter(
          (event) =>
            event.type === 'message.posted' &&
            (event.payload as { messageId?: unknown } | null)?.messageId === posted.value.messageId,
        ).length,
      1,
    )
  }
})
test('execute run replays the first successful execution when retried with the same idempotency key', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const bootstrapResponse = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Plan the next milestone for the API backend',
      title: 'Idempotent execute',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const bootstrapBody = await bootstrapResponse.json()
  let generateCalls = 0

  runtime.services.ai.interactions.generate = async () => {
    generateCalls += 1

    return ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Execute the first time only.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Execute the first time only.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Execute the first time only.',
      provider: 'openai',
      providerRequestId: 'req_idem_execute_1',
      raw: { stub: true },
      responseId: 'resp_idem_execute_1',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })
  }

  const executeRequest = {
    maxOutputTokens: 64,
  }
  const firstResponse = await app.request(
    `http://local/v1/runs/${bootstrapBody.data.runId}/execute`,
    {
      body: JSON.stringify(executeRequest),
      headers: {
        ...headers,
        'content-type': 'application/json',
        'idempotency-key': 'run-execute-1',
      },
      method: 'POST',
    },
  )
  const firstBody = await firstResponse.json()

  const secondResponse = await app.request(
    `http://local/v1/runs/${bootstrapBody.data.runId}/execute`,
    {
      body: JSON.stringify(executeRequest),
      headers: {
        ...headers,
        'content-type': 'application/json',
        'idempotency-key': 'run-execute-1',
      },
      method: 'POST',
    },
  )
  const secondBody = await secondResponse.json()

  assert.equal(firstResponse.status, 200)
  assert.equal(secondResponse.status, 200)
  assert.equal(generateCalls, 1)
  assert.equal(firstBody.data.assistantMessageId, secondBody.data.assistantMessageId)
  assert.equal(firstBody.data.outputText, secondBody.data.outputText)
  assert.equal(runtime.db.select().from(runs).get()?.status, 'completed')
  assert.equal(runtime.db.select().from(sessionMessages).all().length, 2)
  assert.equal(
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.type === 'run.started').length,
    1,
  )
})
