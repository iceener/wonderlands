import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'vitest'
import {
  domainEvents,
  fileLinks,
  files,
  sessionThreads,
  uploads,
  workSessions,
} from '../src/db/schema'
import type { AiInteractionRequest, AiInteractionResponse } from '../src/domain/ai/types'
import { ok } from '../src/shared/result'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { assertAcceptedThreadInteraction } from './helpers/assert-accepted-thread-interaction'
import { createTestHarness } from './helpers/create-test-app'

const seedSession = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    accountId: string
    sessionId?: string
    tenantId: string
  },
) => {
  const now = '2026-03-29T00:00:00.000Z'
  const sessionId = input.sessionId ?? 'ses_upload'

  runtime.db
    .insert(workSessions)
    .values({
      archivedAt: null,
      createdAt: now,
      createdByAccountId: input.accountId,
      deletedAt: null,
      id: sessionId,
      metadata: null,
      rootRunId: null,
      status: 'active',
      tenantId: input.tenantId,
      title: 'Upload session',
      updatedAt: now,
      workspaceRef: null,
    })
    .run()

  return sessionId
}

const seedThread = (
  runtime: ReturnType<typeof createTestHarness>['runtime'],
  input: {
    accountId: string
    sessionId: string
    tenantId: string
    threadId?: string
  },
) => {
  const now = '2026-03-29T00:00:00.000Z'
  const threadId = input.threadId ?? 'thr_upload'

  runtime.db
    .insert(sessionThreads)
    .values({
      createdAt: now,
      createdByAccountId: input.accountId,
      id: threadId,
      parentThreadId: null,
      sessionId: input.sessionId,
      status: 'active',
      tenantId: input.tenantId,
      title: 'Upload thread',
      updatedAt: now,
    })
    .run()

  return threadId
}

test('session-local uploads are stored, listed, and served back through file endpoints', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const sessionId = seedSession(runtime, {
    accountId,
    tenantId,
  })

  const formData = new FormData()
  formData.set(
    'file',
    new File(['hello from upload route'], 'notes.txt', {
      type: 'text/plain',
    }),
  )
  formData.set('accessScope', 'session_local')
  formData.set('sessionId', sessionId)
  formData.set('title', 'Session notes')

  const uploadResponse = await app.request('http://local/api/uploads', {
    body: formData,
    headers,
    method: 'POST',
  })
  const uploadBody = await uploadResponse.json()

  assert.equal(uploadResponse.status, 201)
  assert.equal(uploadBody.ok, true)
  assert.equal(uploadBody.data.accessScope, 'session_local')
  assert.equal(uploadBody.data.originalFilename, 'notes.txt')

  const fileId = uploadBody.data.id
  const metadataResponse = await app.request(`http://local/api/files/${fileId}`, {
    headers,
  })
  const metadataBody = await metadataResponse.json()

  assert.equal(metadataResponse.status, 200)
  assert.equal(metadataBody.data.id, fileId)
  assert.equal(metadataBody.data.contentUrl, `/api/files/${fileId}/content`)

  const sessionFilesResponse = await app.request(`http://local/api/sessions/${sessionId}/files`, {
    headers,
  })
  const sessionFilesBody = await sessionFilesResponse.json()

  assert.equal(sessionFilesResponse.status, 200)
  assert.equal(sessionFilesBody.data.length, 1)
  assert.equal(sessionFilesBody.data[0]?.id, fileId)

  const contentResponse = await app.request(`http://local/api/files/${fileId}/content`, {
    headers,
  })
  const contentText = await contentResponse.text()

  assert.equal(contentResponse.status, 200)
  assert.equal(contentResponse.headers.get('content-type'), 'text/plain')
  assert.equal(contentText, 'hello from upload route')

  const uploadRows = runtime.db.select().from(uploads).all()
  const fileRows = runtime.db.select().from(files).all()
  const linkRows = runtime.db.select().from(fileLinks).all()
  const eventRows = runtime.db.select().from(domainEvents).all()

  assert.equal(uploadRows.length, 1)
  assert.equal(uploadRows[0]?.status, 'completed')
  assert.equal(uploadRows[0]?.sessionId, sessionId)
  assert.equal(fileRows.length, 1)
  assert.equal(fileRows[0]?.accessScope, 'session_local')
  assert.match(
    fileRows[0]?.storageKey ?? '',
    new RegExp(
      `^workspaces/ten_${tenantId}/acc_${accountId}/vault/attachments/\\d{4}/\\d{2}/\\d{2}/[a-z0-9]{2}/${fileId}\\.txt$`,
    ),
  )
  assert.equal(
    existsSync(resolve(runtime.config.files.storage.root, '..', fileRows[0]?.storageKey ?? '')),
    true,
  )
  assert.equal(linkRows.length, 1)
  assert.equal(linkRows[0]?.linkType, 'session')
  assert.equal(linkRows[0]?.targetId, sessionId)
  assert.ok(eventRows.some((event) => event.type === 'file.uploaded'))
  assert.ok(eventRows.some((event) => event.type === 'file.linked'))
})

test('account-library uploads are listed on the dedicated files endpoint', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)

  const formData = new FormData()
  formData.set(
    'file',
    new File([Uint8Array.of(0x89, 0x50, 0x4e, 0x47)], 'diagram.png', {
      type: 'image/png',
    }),
  )
  formData.set('accessScope', 'account_library')
  formData.set('title', 'Diagram')

  const uploadResponse = await app.request('http://local/v1/uploads', {
    body: formData,
    headers,
    method: 'POST',
  })

  assert.equal(uploadResponse.status, 201)

  const listResponse = await app.request('http://local/v1/files?scope=account_library', {
    headers,
  })
  const listBody = await listResponse.json()

  assert.equal(listResponse.status, 200)
  assert.equal(listBody.ok, true)
  assert.equal(listBody.data.length, 1)
  assert.equal(listBody.data[0]?.accessScope, 'account_library')
  assert.equal(listBody.data[0]?.originalFilename, 'diagram.png')

  const storedFiles = runtime.db.select().from(files).all()

  assert.equal(storedFiles.length, 1)
  assert.match(
    storedFiles[0]?.storageKey ?? '',
    new RegExp(
      `^workspaces/ten_${tenantId}/acc_${accountId}/vault/attachments/\\d{4}/\\d{2}/\\d{2}/[a-z0-9]{2}/fil_[A-Za-z0-9]+\\.png$`,
    ),
  )
  assert.equal(
    existsSync(resolve(runtime.config.files.storage.root, '..', storedFiles[0]?.storageKey ?? '')),
    true,
  )
})

test('upload endpoint rejects disallowed MIME types', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    FILE_ALLOWED_MIME_TYPES: 'image/*',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const formData = new FormData()
  formData.set(
    'file',
    new File(['plain text'], 'notes.txt', {
      type: 'text/plain',
    }),
  )
  formData.set('accessScope', 'account_library')

  const response = await app.request('http://local/v1/uploads', {
    body: formData,
    headers,
    method: 'POST',
  })
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.equal(body.ok, false)
  assert.equal(body.error.type, 'validation')
  assert.match(body.error.message, /not allowed/i)
})

test('thread interactions pass uploaded images into OpenAI requests via fileIds', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const sessionId = seedSession(runtime, {
    accountId,
    tenantId,
  })
  const threadId = seedThread(runtime, {
    accountId,
    sessionId,
    tenantId,
  })

  const uploadForm = new FormData()
  uploadForm.set(
    'file',
    new File([Uint8Array.of(0x89, 0x50, 0x4e, 0x47)], 'photo.png', {
      type: 'image/png',
    }),
  )
  uploadForm.set('accessScope', 'session_local')
  uploadForm.set('sessionId', sessionId)

  const uploadResponse = await app.request('http://local/v1/uploads', {
    body: uploadForm,
    headers,
    method: 'POST',
  })
  const uploadBody = await uploadResponse.json()
  const fileId = uploadBody.data.id

  const capturedRequests: AiInteractionRequest[] = []
  const response: AiInteractionResponse = {
    messages: [
      {
        content: [{ text: 'It is a tiny PNG test file.', type: 'text' }],
        role: 'assistant',
      },
    ],
    model: 'gpt-5.4',
    output: [
      {
        content: [{ text: 'It is a tiny PNG test file.', type: 'text' }],
        role: 'assistant',
        type: 'message',
      },
    ],
    outputText: 'It is a tiny PNG test file.',
    provider: 'openai',
    providerRequestId: 'req_openai_image',
    raw: { stub: true },
    responseId: 'resp_openai_image',
    status: 'completed',
    toolCalls: [],
    usage: {
      cachedTokens: 0,
      inputTokens: 20,
      outputTokens: 12,
      reasoningTokens: 0,
      totalTokens: 32,
    },
  }

  runtime.services.ai.interactions.generate = async (request) => {
    capturedRequests.push(request)

    return ok(response)
  }

  const interactionResponse = await app.request(
    `http://local/v1/threads/${threadId}/interactions`,
    {
      body: JSON.stringify({
        fileIds: [fileId],
        provider: 'openai',
        text: 'Describe the uploaded image',
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
  assert.deepEqual(interactionBody.data.attachedFileIds, [fileId])
  assert.equal(typeof interactionRunId, 'string')
  assert.equal(capturedRequests.length, 1)
  assert.ok(
    capturedRequests[0]?.messages.some((message) =>
      message.content.some(
        (content) =>
          content.type === 'image_url' &&
          typeof content.url === 'string' &&
          content.url.startsWith('data:image/png;base64,'),
      ),
    ),
  )
})
