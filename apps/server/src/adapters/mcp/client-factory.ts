import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import {
  ClientCredentialsProvider,
  PrivateKeyJwtProvider,
  StaticPrivateKeyJwtProvider,
} from '@modelcontextprotocol/sdk/client/auth-extensions.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StdioClientTransport,
  type StdioServerParameters,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import type { McpServerConfig } from './types'

export interface McpClientBundle {
  client: Client
  transport: StdioClientTransport | StreamableHTTPClientTransport
}

const toStreamableRequestOptions = (
  server: Extract<McpServerConfig, { kind: 'streamable_http' }>,
  options: {
    authProvider?: OAuthClientProvider
  } = {},
): StreamableHTTPClientTransportOptions => {
  const headers = new Headers(server.headers ?? {})
  let authProvider = options.authProvider

  switch (server.auth.kind) {
    case 'none':
      break
    case 'bearer':
      if (!server.auth.token) {
        throw new Error(`MCP server ${server.id} is missing its bearer token`)
      }

      headers.set('authorization', `Bearer ${server.auth.token}`)
      break
    case 'oauth_authorization_code':
      if (!authProvider) {
        throw new Error(`MCP server ${server.id} requires an OAuth authorization provider`)
      }

      break
    case 'oauth_client_credentials':
      if (!server.auth.clientSecret) {
        throw new Error(`MCP server ${server.id} is missing its OAuth client secret`)
      }

      authProvider = new ClientCredentialsProvider({
        clientId: server.auth.clientId,
        clientName: server.id,
        clientSecret: server.auth.clientSecret,
        scope: server.auth.scope ?? undefined,
      })
      break
    case 'oauth_private_key_jwt':
      if (!server.auth.privateKey) {
        throw new Error(`MCP server ${server.id} is missing its OAuth private key`)
      }

      authProvider = new PrivateKeyJwtProvider({
        algorithm: server.auth.algorithm,
        clientId: server.auth.clientId,
        clientName: server.id,
        privateKey: server.auth.privateKey,
        scope: server.auth.scope ?? undefined,
      })
      break
    case 'oauth_static_private_key_jwt':
      if (!server.auth.assertion) {
        throw new Error(`MCP server ${server.id} is missing its OAuth client assertion`)
      }

      authProvider = new StaticPrivateKeyJwtProvider({
        clientId: server.auth.clientId,
        clientName: server.id,
        jwtBearerAssertion: server.auth.assertion,
        scope: server.auth.scope ?? undefined,
      })
      break
  }

  return {
    ...(authProvider ? { authProvider } : {}),
    requestInit: {
      headers,
    },
  }
}

export const createMcpClientBundle = (
  server: McpServerConfig,
  clientInfo: {
    name: string
    version: string
  },
  options: {
    authProvider?: OAuthClientProvider
  } = {},
): McpClientBundle => {
  const client = new Client({
    name: clientInfo.name,
    version: clientInfo.version,
  })

  if (server.kind === 'stdio') {
    const transport = new StdioClientTransport({
      args: server.args,
      command: server.command,
      cwd: server.cwd,
      env: server.env,
      stderr: server.stderr ?? 'pipe',
    } satisfies StdioServerParameters)

    return {
      client,
      transport,
    }
  }

  const transport = new StreamableHTTPClientTransport(
    new URL(server.url),
    toStreamableRequestOptions(server, options),
  )

  return {
    client,
    transport,
  }
}
