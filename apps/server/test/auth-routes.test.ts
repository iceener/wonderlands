import assert from 'node:assert/strict'
import { test } from 'vitest'

import { createTestHarness } from './helpers/create-test-app'
import { seedPasswordAuth } from './helpers/password-auth'

const extractCookieHeader = (setCookieHeader: string | null): string => {
  assert.ok(setCookieHeader)
  return setCookieHeader.split(';', 1)[0]
}

test('auth routes login, read, and revoke browser auth sessions', async () => {
  const { app, runtime, config } = createTestHarness({
    AUTH_METHODS: 'auth_session',
    AUTH_MODE: 'disabled',
    NODE_ENV: 'test',
  })
  const { accountEmail, password } = seedPasswordAuth(runtime)

  const loginResponse = await app.request('http://local/api/auth/login', {
    body: JSON.stringify({
      email: accountEmail,
      password,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const loginBody = await loginResponse.json()
  const cookieHeader = extractCookieHeader(loginResponse.headers.get('set-cookie'))

  assert.equal(loginResponse.status, 201)
  assert.equal(loginBody.ok, true)
  assert.equal(loginBody.data.auth.kind, 'auth_session')
  assert.equal(loginBody.data.account.email, accountEmail)
  assert.equal(loginBody.data.memberships[0].tenantId, 'ten_test')
  assert.match(cookieHeader, new RegExp(`^${config.auth.session.cookieName}=`))

  const readResponse = await app.request('http://local/api/auth/session', {
    headers: {
      cookie: cookieHeader,
      'x-tenant-id': 'ten_test',
    },
  })
  const readBody = await readResponse.json()

  assert.equal(readResponse.status, 200)
  assert.equal(readBody.ok, true)
  assert.equal(readBody.data.auth.kind, 'auth_session')
  assert.equal(readBody.data.tenantScope.tenantId, 'ten_test')

  const logoutResponse = await app.request('http://local/api/auth/logout', {
    headers: {
      cookie: cookieHeader,
    },
    method: 'POST',
  })
  const logoutBody = await logoutResponse.json()

  assert.equal(logoutResponse.status, 200)
  assert.equal(logoutBody.ok, true)
  assert.equal(logoutBody.data.loggedOut, true)

  const staleSessionResponse = await app.request('http://local/api/auth/session', {
    headers: {
      cookie: cookieHeader,
    },
  })
  const staleSessionBody = await staleSessionResponse.json()

  assert.equal(staleSessionResponse.status, 401)
  assert.equal(staleSessionBody.ok, false)
  assert.equal(staleSessionBody.error.type, 'auth')
})

test('email/password login rejects invalid credentials', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_METHODS: 'auth_session',
    AUTH_MODE: 'disabled',
    NODE_ENV: 'test',
  })
  const { accountEmail } = seedPasswordAuth(runtime)

  const response = await app.request('http://local/api/auth/login', {
    body: JSON.stringify({
      email: accountEmail,
      password: 'wrong password',
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.ok, false)
  assert.equal(body.error.type, 'auth')
  assert.equal(body.error.message, 'Invalid email or password')
  assert.equal(response.headers.get('set-cookie'), null)
})

test('browser auth session mutations reject cross-site form submissions', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_METHODS: 'auth_session',
    AUTH_MODE: 'disabled',
    NODE_ENV: 'test',
  })
  const { accountEmail, password } = seedPasswordAuth(runtime)

  const loginResponse = await app.request('http://local/api/auth/login', {
    body: JSON.stringify({
      email: accountEmail,
      password,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const cookieHeader = extractCookieHeader(loginResponse.headers.get('set-cookie'))

  const response = await app.request('http://local/api/auth/logout', {
    headers: {
      cookie: cookieHeader,
      origin: 'https://evil.example',
    },
    method: 'POST',
  })
  const body = await response.json()

  assert.equal(response.status, 403)
  assert.equal(body.ok, false)
  assert.equal(body.error.type, 'permission')
})
