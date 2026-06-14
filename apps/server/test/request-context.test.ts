import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { test } from 'vitest'
import { apiKeyAuthMiddleware } from '../src/adapters/http/auth/api-key-auth-middleware'
import { authSessionAuthMiddleware } from '../src/adapters/http/auth/auth-session-auth-middleware'
import { requestContextMiddleware } from '../src/app/middleware/request-context'
import { runtimeContextMiddleware } from '../src/app/middleware/runtime-context'
import type { AppEnv } from '../src/app/types'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { seedAuthSession } from './helpers/auth-session'
import { createTestHarness } from './helpers/create-test-app'

test('apiKeyAuthMiddleware builds authenticated request scope with tenant scope in api_key mode', async () => {
  const { runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)
  const app = new Hono<AppEnv>()

  app.use('*', runtimeContextMiddleware(runtime))
  app.use('*', requestContextMiddleware)
  app.use('*', apiKeyAuthMiddleware(runtime.config))
  app.get('/scope', (c) =>
    c.json({
      account: c.get('account'),
      auth: c.get('auth'),
      requestId: c.get('requestId'),
      requestScope: c.get('requestScope'),
      tenantScope: c.get('tenantScope'),
      traceId: c.get('traceId'),
    }),
  )

  const response = await app.request('http://local/scope', {
    headers,
  })

  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.requestScope.kind, 'authenticated')
  assert.equal(body.account.id, 'acc_test')
  assert.equal(body.tenantScope.tenantId, 'ten_test')
  assert.equal(body.tenantScope.role, 'admin')
  assert.equal(body.auth.method, 'api_key')
  assert.ok(body.requestId)
  assert.ok(body.traceId)
})

test('authSessionAuthMiddleware builds authenticated request scope with tenant scope in auth session mode', async () => {
  const { runtime } = createTestHarness({
    AUTH_METHODS: 'auth_session',
    AUTH_MODE: 'disabled',
    NODE_ENV: 'test',
  })
  const { cookieHeader } = seedAuthSession(runtime)
  const app = new Hono<AppEnv>()

  app.use('*', runtimeContextMiddleware(runtime))
  app.use('*', requestContextMiddleware)
  app.use('*', authSessionAuthMiddleware(runtime.config))
  app.get('/scope', (c) =>
    c.json({
      account: c.get('account'),
      auth: c.get('auth'),
      requestScope: c.get('requestScope'),
      tenantScope: c.get('tenantScope'),
    }),
  )

  const response = await app.request('http://local/scope', {
    headers: {
      ...cookieHeader,
      'x-tenant-id': 'ten_test',
    },
  })

  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.auth.method, 'auth_session')
  assert.equal(body.requestScope.kind, 'authenticated')
  assert.equal(body.account.id, 'acc_test')
  assert.equal(body.tenantScope.tenantId, 'ten_test')
  assert.equal(body.tenantScope.role, 'admin')
})
