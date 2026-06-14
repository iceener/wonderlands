import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { test } from 'vitest'

import { toolProfiles } from '../src/db/schema'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

test('tool profile routes list, create, read, and update user-managed tool profiles', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)

  const initialListResponse = await app.request('http://local/v1/tool-profiles', {
    headers,
    method: 'GET',
  })
  const initialListBody = await initialListResponse.json()

  assert.equal(initialListResponse.status, 200)
  assert.equal(initialListBody.ok, true)
  assert.equal(Array.isArray(initialListBody.data), true)
  assert.equal(
    initialListBody.data.some((profile: { id: string }) => profile.id === 'tpf_assistant_test'),
    true,
  )

  const createResponse = await app.request('http://local/v1/tool-profiles', {
    body: JSON.stringify({
      name: 'Research Access',
      scope: 'account_private',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const createBody = await createResponse.json()
  const createdToolProfileId = createBody.data.id as string

  assert.equal(createResponse.status, 201)
  assert.equal(createBody.ok, true)
  assert.equal(createBody.data.name, 'Research Access')
  assert.equal(createBody.data.scope, 'account_private')
  assert.equal(createBody.data.accountId, accountId)

  const storedCreatedProfile = runtime.db
    .select()
    .from(toolProfiles)
    .where(eq(toolProfiles.id, createdToolProfileId))
    .get()

  assert.equal(storedCreatedProfile?.tenantId, tenantId)
  assert.equal(storedCreatedProfile?.accountId, accountId)
  assert.equal(storedCreatedProfile?.status, 'active')

  const readResponse = await app.request(
    `http://local/v1/tool-profiles/${encodeURIComponent(createdToolProfileId)}`,
    {
      headers,
      method: 'GET',
    },
  )
  const readBody = await readResponse.json()

  assert.equal(readResponse.status, 200)
  assert.equal(readBody.ok, true)
  assert.equal(readBody.data.id, createdToolProfileId)
  assert.equal(readBody.data.name, 'Research Access')

  const updateResponse = await app.request(
    `http://local/v1/tool-profiles/${encodeURIComponent(createdToolProfileId)}`,
    {
      body: JSON.stringify({
        name: 'Shared Research Access',
        scope: 'tenant_shared',
        status: 'archived',
      }),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'PATCH',
    },
  )
  const updateBody = await updateResponse.json()

  assert.equal(updateResponse.status, 200)
  assert.equal(updateBody.ok, true)
  assert.equal(updateBody.data.id, createdToolProfileId)
  assert.equal(updateBody.data.name, 'Shared Research Access')
  assert.equal(updateBody.data.scope, 'tenant_shared')
  assert.equal(updateBody.data.status, 'archived')
  assert.equal(updateBody.data.accountId, null)

  const storedUpdatedProfile = runtime.db
    .select()
    .from(toolProfiles)
    .where(eq(toolProfiles.id, createdToolProfileId))
    .get()

  assert.equal(storedUpdatedProfile?.name, 'Shared Research Access')
  assert.equal(storedUpdatedProfile?.scope, 'tenant_shared')
  assert.equal(storedUpdatedProfile?.status, 'archived')
  assert.equal(storedUpdatedProfile?.accountId, null)
})
