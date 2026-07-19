import assert from 'node:assert/strict'
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { onTestFinished, test } from 'vitest'
import { z } from 'zod'
import { protectStoredOauthTokens, revealStoredOauthTokens } from '../src/adapters/mcp/stored-oauth'
import { createMcpOauthCredentialRepository } from '../src/adapters/persistence/sqlite/mcp/mcp-oauth-credential-repository'
import { closeAppRuntime } from '../src/app/runtime'
import type { TenantScope } from '../src/shared/scope'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createAsyncTestHarness } from './helpers/create-test-app'

const createOAuthFixtureServer = () => {
  let refreshGrantCount = 0

  const buildServer = () => {
    const server = new McpServer(
      {
        name: 'oauth-mcp-fixture',
        version: '1.0.0',
      },
      {
        capabilities: {
          logging: {},
        },
      },
    )

    registerAppTool(
      server,
      'echo',
      {
        description: 'Echoes a value after OAuth authorization',
        inputSchema: {
          value: z.string(),
        },
        _meta: {
          ui: {
            resourceUri: 'ui://fixture/oauth-echo.html',
          },
        },
      },
      async ({ value }) => ({
        content: [
          {
            text: `oauth:${value}`,
            type: 'text',
          },
        ],
        structuredContent: {
          echoed: value,
        },
      }),
    )

    return server
  }

  return {
    get refreshGrantCount() {
      return refreshGrantCount
    },
    async fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)

      if (url.pathname === '/.well-known/oauth-protected-resource') {
        return Response.json({
          authorization_servers: ['http://oauth-fixture.test'],
          resource: 'http://oauth-fixture.test/mcp',
          scopes_supported: ['offline_access', 'tools:read'],
        })
      }

      if (url.pathname === '/.well-known/oauth-authorization-server') {
        return Response.json({
          authorization_endpoint: 'http://oauth-fixture.test/authorize',
          code_challenge_methods_supported: ['S256'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          issuer: 'http://oauth-fixture.test',
          registration_endpoint: 'http://oauth-fixture.test/register',
          response_types_supported: ['code'],
          token_endpoint: 'http://oauth-fixture.test/token',
          token_endpoint_auth_methods_supported: ['none'],
        })
      }

      if (url.pathname === '/register' && request.method === 'POST') {
        const metadata = (await request.json()) as Record<string, unknown>

        return Response.json({
          ...metadata,
          client_id: 'fixture-client',
        })
      }

      if (url.pathname === '/token' && request.method === 'POST') {
        const params = new URLSearchParams(await request.text())
        const grantType = params.get('grant_type')

        if (grantType === 'authorization_code') {
          assert.equal(params.get('code'), 'fixture-code')

          return Response.json({
            access_token: 'access-token-initial',
            refresh_token: 'refresh-token-1',
            token_type: 'Bearer',
          })
        }

        if (grantType === 'refresh_token') {
          assert.equal(params.get('refresh_token'), 'refresh-token-1')
          refreshGrantCount += 1

          return Response.json({
            access_token: 'access-token-refreshed',
            token_type: 'Bearer',
          })
        }

        return new Response('Unsupported grant', {
          status: 400,
        })
      }

      if (url.pathname === '/mcp') {
        const authorization = request.headers.get('authorization')

        if (
          authorization !== 'Bearer access-token-initial' &&
          authorization !== 'Bearer access-token-refreshed'
        ) {
          return new Response('Unauthorized', {
            headers: {
              'WWW-Authenticate': 'Bearer',
            },
            status: 401,
          })
        }

        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        })
        const mcpServer = buildServer()

        await mcpServer.connect(transport)
        return transport.handleRequest(request)
      }

      return new Response('Not found', {
        status: 404,
      })
    },
    url: 'http://oauth-fixture.test/mcp',
  }
}

const createHttpServer = async (input: {
  app: Awaited<ReturnType<typeof createAsyncTestHarness>>['app']
  auth:
    | { kind: 'none' }
    | {
        kind: 'oauth_authorization_code'
        scope: string
      }
  headers: Record<string, string>
  label: string
  url: string
}) => {
  const response = await input.app.request('http://local/v1/mcp/servers', {
    body: JSON.stringify({
      config: {
        auth: input.auth,
        url: input.url,
      },
      kind: 'streamable_http',
      label: input.label,
    }),
    headers: {
      ...input.headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  assert.equal(response.status, 201)
  return response.json()
}

const completeOAuthAuthorization = async (input: {
  app: Awaited<ReturnType<typeof createAsyncTestHarness>>['app']
  headers: Record<string, string>
  serverId: string
}) => {
  const startResponse = await input.app.request(
    `http://local/v1/mcp/servers/${input.serverId}/oauth/start`,
    {
      body: JSON.stringify({
        responseOrigin: 'http://ui.local',
      }),
      headers: {
        ...input.headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  if (startResponse.status !== 200) {
    assert.equal(startResponse.status, 200, await startResponse.text())
  }

  const started = await startResponse.json()
  assert.equal(started.data.kind, 'redirect')

  const authorizationUrl = new URL(started.data.authorizationUrl as string)
  const authorizationState = authorizationUrl.searchParams.get('state')

  assert.ok(authorizationState)

  const callbackResponse = await input.app.request(
    `http://local/v1/mcp/oauth/callback?code=fixture-code&state=${encodeURIComponent(authorizationState!)}`,
    {
      method: 'GET',
    },
  )

  if (callbackResponse.status !== 200) {
    assert.equal(callbackResponse.status, 200, await callbackResponse.text())
  }

  assert.match(await callbackResponse.text(), /MCP authorization completed/)
}

test('MCP OAuth authorization-code flow persists tokens and refreshes them through the SDK', async () => {
  const fixture = createOAuthFixtureServer()
  const originalFetch = globalThis.fetch

  globalThis.fetch = fixture.fetch as typeof fetch

  const { app, runtime } = await createAsyncTestHarness({
    AUTH_MODE: 'api_key',
    MCP_SECRET_ENCRYPTION_KEY: 'test-encryption-key-1234567890',
    NODE_ENV: 'test',
  })

  onTestFinished(async () => {
    globalThis.fetch = originalFetch
    await closeAppRuntime(runtime)
  })

  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const tenantScope: TenantScope = {
    accountId: accountId as TenantScope['accountId'],
    role: 'owner' as const,
    tenantId: tenantId as TenantScope['tenantId'],
  }

  const createResponse = await createHttpServer({
    app,
    auth: {
      kind: 'oauth_authorization_code',
      scope: 'offline_access tools:read',
    },
    headers,
    label: 'OAuth Fixture MCP',
    url: fixture.url,
  })

  const created = await createResponse
  const serverId = created.data.server.id as string

  assert.equal(created.data.snapshot.status, 'authorization_required')

  await completeOAuthAuthorization({
    app,
    headers,
    serverId,
  })

  const readySnapshot = runtime.services.mcp.getServerSnapshot(tenantScope, serverId)

  assert.equal(readySnapshot?.status, 'ready')

  const credentialRepository = createMcpOauthCredentialRepository(runtime.db)
  const credentials = credentialRepository.getByServerId(tenantScope, serverId)

  assert.equal(credentials.ok, true)

  if (!credentials.ok) {
    return
  }

  assert.deepEqual(
    revealStoredOauthTokens(credentials.value.tokensJson, runtime.config.mcp.secretEncryptionKey),
    {
      access_token: 'access-token-initial',
      refresh_token: 'refresh-token-1',
      token_type: 'Bearer',
    },
  )

  const staleTokenUpdate = credentialRepository.upsert(tenantScope, {
    id: credentials.value.id,
    serverId,
    tokensJson: protectStoredOauthTokens(
      {
        access_token: 'stale-token',
        refresh_token: 'refresh-token-1',
        token_type: 'Bearer',
      },
      runtime.config.mcp.secretEncryptionKey,
    ),
    updatedAt: runtime.services.clock.nowIso(),
  })

  assert.equal(staleTokenUpdate.ok, true)

  const refreshed = await runtime.services.mcp.refreshServer(tenantScope, serverId)

  assert.equal(refreshed.ok, true)

  if (!refreshed.ok) {
    return
  }

  assert.equal(refreshed.value.status, 'ready')
  assert.equal(fixture.refreshGrantCount, 1)

  const refreshedCredentials = credentialRepository.getByServerId(tenantScope, serverId)

  assert.equal(refreshedCredentials.ok, true)

  if (!refreshedCredentials.ok) {
    return
  }

  assert.deepEqual(
    revealStoredOauthTokens(
      refreshedCredentials.value.tokensJson,
      runtime.config.mcp.secretEncryptionKey,
    ),
    {
      access_token: 'access-token-refreshed',
      refresh_token: 'refresh-token-1',
      token_type: 'Bearer',
    },
  )
})

test('MCP OAuth can be started for auth:none HTTP servers after an unauthorized response', async () => {
  const fixture = createOAuthFixtureServer()
  const originalFetch = globalThis.fetch

  globalThis.fetch = fixture.fetch as typeof fetch

  const { app, runtime } = await createAsyncTestHarness({
    AUTH_MODE: 'api_key',
    MCP_SECRET_ENCRYPTION_KEY: 'test-encryption-key-1234567890',
    NODE_ENV: 'test',
  })

  onTestFinished(async () => {
    globalThis.fetch = originalFetch
    await closeAppRuntime(runtime)
  })

  const { accountId, headers, tenantId } = seedApiKeyAuth(runtime)
  const tenantScope: TenantScope = {
    accountId: accountId as TenantScope['accountId'],
    role: 'owner' as const,
    tenantId: tenantId as TenantScope['tenantId'],
  }

  const created = await createHttpServer({
    app,
    auth: {
      kind: 'none',
    },
    headers,
    label: 'OAuth Challenge MCP',
    url: fixture.url,
  })
  const serverId = created.data.server.id as string

  assert.equal(created.data.server.config.auth.kind, 'none')
  assert.equal(created.data.snapshot.status, 'authorization_required')
  assert.match(created.data.snapshot.lastError, /authorization is required/i)

  await completeOAuthAuthorization({
    app,
    headers,
    serverId,
  })

  const readySnapshot = runtime.services.mcp.getServerSnapshot(tenantScope, serverId)

  assert.equal(readySnapshot?.status, 'ready')

  const credentialRepository = createMcpOauthCredentialRepository(runtime.db)
  const credentials = credentialRepository.getByServerId(tenantScope, serverId)

  assert.equal(credentials.ok, true)

  if (!credentials.ok) {
    return
  }

  const staleTokenUpdate = credentialRepository.upsert(tenantScope, {
    id: credentials.value.id,
    serverId,
    tokensJson: protectStoredOauthTokens(
      {
        access_token: 'stale-token',
        refresh_token: 'refresh-token-1',
        token_type: 'Bearer',
      },
      runtime.config.mcp.secretEncryptionKey,
    ),
    updatedAt: runtime.services.clock.nowIso(),
  })

  assert.equal(staleTokenUpdate.ok, true)

  const refreshed = await runtime.services.mcp.refreshServer(tenantScope, serverId)

  assert.equal(refreshed.ok, true)

  if (!refreshed.ok) {
    return
  }

  assert.equal(refreshed.value.status, 'ready')
  assert.equal(fixture.refreshGrantCount, 1)
})
