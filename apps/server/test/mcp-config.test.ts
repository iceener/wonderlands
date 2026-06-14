import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { onTestFinished, test } from 'vitest'

import { loadConfig } from '../src/app/config'

const writeMcpServersFile = (contents: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-config-'))
  const filePath = join(dir, 'servers.json')
  writeFileSync(filePath, JSON.stringify(contents), 'utf8')
  return filePath
}

test('loadConfig returns an empty MCP server list for an empty config file', () => {
  const filePath = writeMcpServersFile([])
  onTestFinished(() => {
    rmSync(dirname(filePath), { force: true, recursive: true })
  })
  const config = loadConfig({
    MCP_SERVERS_FILE: filePath,
  })

  assert.deepEqual(config.mcp.servers, [])
})

test('loadConfig parses MCP stdio and streamable server definitions', () => {
  const filePath = writeMcpServersFile([
    {
      command: 'node',
      id: 'local_stdio',
      kind: 'stdio',
    },
    {
      auth: {
        kind: 'bearer',
        tokenEnv: 'MCP_ACCESS_TOKEN',
      },
      id: 'remote_http',
      kind: 'streamable_http',
      url: 'http://127.0.0.1:3010/mcp',
    },
  ])
  onTestFinished(() => {
    rmSync(dirname(filePath), { force: true, recursive: true })
  })
  const config = loadConfig({
    MCP_ACCESS_TOKEN: 'secret-token',
    MCP_SERVERS_FILE: filePath,
  })

  assert.equal(config.mcp.servers.length, 2)
  assert.equal(config.mcp.servers[0]?.kind, 'stdio')
  assert.equal(config.mcp.servers[0]?.toolPrefix, 'local_stdio')
  assert.equal(config.mcp.servers[1]?.kind, 'streamable_http')
  assert.deepEqual(config.mcp.servers[1]?.auth, {
    kind: 'bearer',
    token: 'secret-token',
  })
})

test('loadConfig parses MCP OAuth authorization-code server definitions', () => {
  const filePath = writeMcpServersFile([
    {
      auth: {
        clientId: 'fixture-client',
        clientName: 'Fixture Client',
        clientSecretEnv: 'MCP_OAUTH_CLIENT_SECRET',
        kind: 'oauth_authorization_code',
        resource: 'https://fixture.example/mcp',
        resourceMetadataUrl: 'https://fixture.example/.well-known/oauth-protected-resource',
        scope: 'offline_access tools:read',
        tokenEndpointAuthMethod: 'client_secret_basic',
      },
      id: 'oauth_http',
      kind: 'streamable_http',
      url: 'https://fixture.example/mcp',
    },
  ])
  onTestFinished(() => {
    rmSync(dirname(filePath), { force: true, recursive: true })
  })

  const config = loadConfig({
    MCP_OAUTH_CLIENT_SECRET: 'fixture-secret',
    MCP_SERVERS_FILE: filePath,
  })

  assert.deepEqual(config.mcp.servers[0], {
    allowedTenantIds: undefined,
    auth: {
      clientId: 'fixture-client',
      clientName: 'Fixture Client',
      clientSecret: 'fixture-secret',
      kind: 'oauth_authorization_code',
      resource: 'https://fixture.example/mcp',
      resourceMetadataUrl: 'https://fixture.example/.well-known/oauth-protected-resource',
      scope: 'offline_access tools:read',
      tokenEndpointAuthMethod: 'client_secret_basic',
    },
    enabled: true,
    headers: undefined,
    id: 'oauth_http',
    kind: 'streamable_http',
    logLevel: undefined,
    toolPrefix: 'oauth_http',
    url: 'https://fixture.example/mcp',
  })
})

test('loadConfig rejects duplicate MCP ids and tool prefixes', () => {
  const duplicateIdsFilePath = writeMcpServersFile([
    {
      command: 'node',
      id: 'dup',
      kind: 'stdio',
    },
    {
      command: 'node',
      id: 'dup',
      kind: 'stdio',
    },
  ])
  onTestFinished(() => {
    rmSync(dirname(duplicateIdsFilePath), { force: true, recursive: true })
  })
  assert.throws(
    () =>
      loadConfig({
        MCP_SERVERS_FILE: duplicateIdsFilePath,
      }),
    /duplicated/,
  )

  const duplicatePrefixesFilePath = writeMcpServersFile([
    {
      command: 'node',
      id: 'first',
      kind: 'stdio',
      toolPrefix: 'shared',
    },
    {
      command: 'node',
      id: 'second',
      kind: 'stdio',
      toolPrefix: 'shared',
    },
  ])
  onTestFinished(() => {
    rmSync(dirname(duplicatePrefixesFilePath), { force: true, recursive: true })
  })
  assert.throws(
    () =>
      loadConfig({
        MCP_SERVERS_FILE: duplicatePrefixesFilePath,
      }),
    /tool prefix .* duplicated/,
  )
})
