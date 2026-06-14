import assert from 'node:assert/strict'
import { test } from 'vitest'

import { createTestApp } from './helpers/create-test-app'

test('api health endpoint returns standardized success envelope', async () => {
  const app = createTestApp()

  const response = await app.request('http://local/api/system/health')
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.data.status, 'ok')
  assert.ok(body.meta.requestId)
  assert.ok(body.meta.traceId)
})

test('CORS allows configured origins and omits disallowed origins', async () => {
  const app = createTestApp()

  const allowed = await app.request(
    new Request('http://local/api/system/health', {
      headers: {
        Origin: 'http://localhost:5173',
      },
    }),
  )

  const denied = await app.request(
    new Request('http://local/api/system/health', {
      headers: {
        Origin: 'https://evil.example',
      },
    }),
  )

  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  assert.equal(denied.headers.get('access-control-allow-origin'), null)
})

test('request size guard returns 413 before route handling', async () => {
  const app = createTestApp({
    MAX_REQUEST_BODY_BYTES: '16',
  })
  const body = JSON.stringify({
    message: 'this payload is intentionally larger than sixteen bytes',
  })

  const response = await app.request(
    new Request('http://local/api/system/health', {
      body,
      headers: {
        'content-length': String(Buffer.byteLength(body)),
        'content-type': 'application/json',
      },
      method: 'POST',
    }),
  )

  const payload = await response.json()

  assert.equal(response.status, 413)
  assert.equal(payload.ok, false)
  assert.equal(payload.error.type, 'validation')
  assert.match(payload.error.message, /configured limit/)
})

test('ready endpoint exposes current foundation state', async () => {
  const app = createTestApp()

  const response = await app.request('http://local/api/system/ready')
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.deepEqual(body.data, {
    status: 'ready',
  })
})

test('models endpoint exposes configured aliases and provider availability', async () => {
  const app = createTestApp({
    AI_DEFAULT_PROVIDER: 'google',
    GOOGLE_API_KEY: 'google-test-key',
    OPENAI_API_KEY: '',
  })

  const response = await app.request('http://local/api/system/models')
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.data.defaultAlias, 'default')
  assert.equal(body.data.defaultProvider, 'google')
  assert.equal(body.data.providers.google.configured, true)
  assert.equal(body.data.providers.openai.configured, false)
  assert.deepEqual(body.data.reasoningModes, [
    { effort: 'none', label: 'No reasoning' },
    { effort: 'minimal', label: 'Minimal' },
    { effort: 'low', label: 'Low' },
    { effort: 'medium', label: 'Medium' },
    { effort: 'high', label: 'High' },
    { effort: 'xhigh', label: 'Very high' },
  ])
  const aliasByName = new Map(
    body.data.aliases.map((alias: (typeof body.data.aliases)[number]) => [alias.alias, alias]),
  )

  assert.deepEqual(aliasByName.get('default'), {
    alias: 'default',
    configured: true,
    contextWindow: 1_048_576,
    isDefault: true,
    model: 'gemini-3.1-pro-preview',
    provider: 'google',
    reasoningModes: ['none', 'minimal', 'low', 'medium', 'high'],
    supportsReasoning: true,
  })
  assert.deepEqual(aliasByName.get('google_default'), {
    alias: 'google_default',
    configured: true,
    contextWindow: 1_048_576,
    isDefault: false,
    model: 'gemini-3.1-pro-preview',
    provider: 'google',
    reasoningModes: ['none', 'minimal', 'low', 'medium', 'high'],
    supportsReasoning: true,
  })
  assert.deepEqual(aliasByName.get('openai_default'), {
    alias: 'openai_default',
    configured: false,
    contextWindow: 1_047_576,
    isDefault: false,
    model: 'gpt-5.4',
    provider: 'openai',
    reasoningModes: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    supportsReasoning: true,
  })
  assert.equal(aliasByName.has('gemini-3.1-pro'), true)
  assert.equal(aliasByName.has('gemini-3.1-flash-lite'), true)
})

test('runtime endpoint exposes current kernel availability summary', async () => {
  const app = createTestApp({
    KERNEL_ENABLED: 'true',
    KERNEL_LOCAL_API_URL: 'http://127.0.0.1:10001',
    KERNEL_PROVIDER: 'local',
  })

  const response = await app.request('http://local/api/system/runtime')
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.deepEqual(body.data, {
    kernel: {
      available: false,
      checkedAt: null,
      detail: 'Kernel is enabled but has not been probed yet.',
      enabled: true,
      provider: 'local',
      status: 'pending',
    },
    sandbox: {
      available: true,
      detail: 'Sandbox provider local_dev supports node.',
      provider: 'local_dev',
      supportedRuntimes: ['node'],
    },
  })
})
