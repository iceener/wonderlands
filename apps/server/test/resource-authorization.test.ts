import assert from 'node:assert/strict'
import { test } from 'vitest'

import { tenantMemberships } from '../src/db/schema'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const bootstrapSession = async (
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

const buildSessionUploadForm = (sessionId: string): FormData => {
  const formData = new FormData()
  formData.set(
    'file',
    new File(['owner session notes'], 'notes.txt', {
      type: 'text/plain',
    }),
  )
  formData.set('accessScope', 'session_local')
  formData.set('sessionId', sessionId)

  return formData
}

const uploadSessionFile = async (
  app: ReturnType<typeof createTestHarness>['app'],
  headers: Record<string, string>,
  sessionId: string,
) => {
  const response = await app.request('http://local/v1/uploads', {
    body: buildSessionUploadForm(sessionId),
    headers,
    method: 'POST',
  })
  const body = await response.json()

  assert.equal(response.status, 201)

  return body.data.id as string
}

const assertPermissionDenied = async (response: Response) => {
  const body = await response.json()

  assert.equal(response.status, 403)
  assert.equal(body.ok, false)
  assert.equal(body.error.type, 'permission')
}

const seedTenantUsers = (runtime: ReturnType<typeof createTestHarness>['runtime']) => {
  const owner = seedApiKeyAuth(runtime, {
    accountEmail: 'owner@example.com',
    accountId: 'acc_owner',
    accountName: 'Owner',
    apiKeyId: 'key_owner',
    role: 'member',
    secret: 'sk_owner_1234567890',
    tenantId: 'ten_shared',
  })
  const member = seedApiKeyAuth(runtime, {
    accountEmail: 'member@example.com',
    accountId: 'acc_member',
    accountName: 'Member',
    apiKeyId: 'key_member',
    includeMembership: false,
    includeTenant: false,
    role: 'member',
    secret: 'sk_member_1234567890',
    tenantId: 'ten_shared',
  })
  const admin = seedApiKeyAuth(runtime, {
    accountEmail: 'admin@example.com',
    accountId: 'acc_admin',
    accountName: 'Admin',
    apiKeyId: 'key_admin',
    includeMembership: false,
    includeTenant: false,
    role: 'admin',
    secret: 'sk_admin_1234567890',
    tenantId: 'ten_shared',
  })

  runtime.db
    .insert(tenantMemberships)
    .values([
      {
        accountId: member.accountId,
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'mem_ten_shared_member',
        role: 'member',
        tenantId: member.tenantId,
      },
      {
        accountId: admin.accountId,
        createdAt: '2026-03-29T00:00:00.000Z',
        id: 'mem_ten_shared_admin',
        role: 'admin',
        tenantId: admin.tenantId,
      },
    ])
    .run()

  return {
    admin,
    member,
    owner,
  }
}

test('member access is limited to resources owned by the current account', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { member, owner } = seedTenantUsers(runtime)
  const bootstrap = await bootstrapSession(app, owner.headers)
  const fileId = await uploadSessionFile(app, owner.headers, bootstrap.data.sessionId)

  await assertPermissionDenied(
    await app.request(`http://local/v1/sessions/${bootstrap.data.sessionId}/threads`, {
      body: JSON.stringify({
        title: 'Blocked thread',
      }),
      headers: {
        ...member.headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    }),
  )

  await assertPermissionDenied(
    await app.request(`http://local/v1/threads/${bootstrap.data.threadId}`, {
      headers: member.headers,
    }),
  )

  await assertPermissionDenied(
    await app.request(`http://local/v1/threads/${bootstrap.data.threadId}/messages`, {
      headers: member.headers,
    }),
  )

  await assertPermissionDenied(
    await app.request(`http://local/v1/threads/${bootstrap.data.threadId}/messages`, {
      body: JSON.stringify({
        text: 'Unauthorized message',
      }),
      headers: {
        ...member.headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    }),
  )

  await assertPermissionDenied(
    await app.request(`http://local/v1/threads/${bootstrap.data.threadId}/interactions`, {
      body: JSON.stringify({
        text: 'Unauthorized interaction',
      }),
      headers: {
        ...member.headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    }),
  )

  await assertPermissionDenied(
    await app.request(`http://local/v1/sessions/${bootstrap.data.sessionId}/files`, {
      headers: member.headers,
    }),
  )

  await assertPermissionDenied(
    await app.request('http://local/v1/uploads', {
      body: buildSessionUploadForm(bootstrap.data.sessionId),
      headers: member.headers,
      method: 'POST',
    }),
  )

  await assertPermissionDenied(
    await app.request(`http://local/v1/files/${fileId}`, {
      headers: member.headers,
    }),
  )

  await assertPermissionDenied(
    await app.request(`http://local/v1/files/${fileId}/content`, {
      headers: member.headers,
    }),
  )

  await assertPermissionDenied(
    await app.request(`http://local/v1/runs/${bootstrap.data.runId}`, {
      headers: member.headers,
    }),
  )

  await assertPermissionDenied(
    await app.request(`http://local/v1/runs/${bootstrap.data.runId}/execute`, {
      body: JSON.stringify({}),
      headers: {
        ...member.headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    }),
  )

  await assertPermissionDenied(
    await app.request(`http://local/v1/runs/${bootstrap.data.runId}/cancel`, {
      body: JSON.stringify({}),
      headers: {
        ...member.headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    }),
  )

  await assertPermissionDenied(
    await app.request(
      `http://local/v1/file-picker/search?query=notes&sessionId=${bootstrap.data.sessionId}`,
      {
        headers: member.headers,
      },
    ),
  )

  await assertPermissionDenied(
    await app.request('http://local/v1/events/stream?follow=false', {
      headers: member.headers,
    }),
  )

  await assertPermissionDenied(
    await app.request(
      `http://local/v1/events/stream?follow=false&threadId=${bootstrap.data.threadId}`,
      {
        headers: member.headers,
      },
    ),
  )
})

test('admin retains tenant-wide override for session-bound resources', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { admin, owner } = seedTenantUsers(runtime)
  const bootstrap = await bootstrapSession(app, owner.headers)
  const fileId = await uploadSessionFile(app, owner.headers, bootstrap.data.sessionId)

  const createThreadResponse = await app.request(
    `http://local/v1/sessions/${bootstrap.data.sessionId}/threads`,
    {
      body: JSON.stringify({
        title: 'Admin thread',
      }),
      headers: {
        ...admin.headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )
  const createThreadBody = await createThreadResponse.json()

  assert.equal(createThreadResponse.status, 201)
  assert.equal(createThreadBody.ok, true)

  const threadResponse = await app.request(`http://local/v1/threads/${bootstrap.data.threadId}`, {
    headers: admin.headers,
  })
  const threadBody = await threadResponse.json()

  assert.equal(threadResponse.status, 200)
  assert.equal(threadBody.data.id, bootstrap.data.threadId)

  const sessionFilesResponse = await app.request(
    `http://local/v1/sessions/${bootstrap.data.sessionId}/files`,
    {
      headers: admin.headers,
    },
  )
  const sessionFilesBody = await sessionFilesResponse.json()

  assert.equal(sessionFilesResponse.status, 200)
  assert.ok(sessionFilesBody.data.some((file: { id: string }) => file.id === fileId))

  const fileResponse = await app.request(`http://local/v1/files/${fileId}`, {
    headers: admin.headers,
  })
  const fileBody = await fileResponse.json()

  assert.equal(fileResponse.status, 200)
  assert.equal(fileBody.data.id, fileId)

  const runResponse = await app.request(`http://local/v1/runs/${bootstrap.data.runId}`, {
    headers: admin.headers,
  })
  const runBody = await runResponse.json()

  assert.equal(runResponse.status, 200)
  assert.equal(runBody.data.id, bootstrap.data.runId)

  const cancelResponse = await app.request(`http://local/v1/runs/${bootstrap.data.runId}/cancel`, {
    body: JSON.stringify({}),
    headers: {
      ...admin.headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const cancelBody = await cancelResponse.json()

  assert.equal(cancelResponse.status, 200)
  assert.equal(cancelBody.data.status, 'cancelled')

  const eventsResponse = await app.request('http://local/v1/events/stream?follow=false', {
    headers: admin.headers,
  })

  assert.equal(eventsResponse.status, 200)
  assert.match(eventsResponse.headers.get('content-type') ?? '', /text\/event-stream/)
})
