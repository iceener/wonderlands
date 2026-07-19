import type { EncryptedSecret } from '../../shared/secret-box'

/**
 * Protocol-neutral MCP domain types shared across the mcp domain repositories.
 *
 * These types intentionally avoid depending on the `@modelcontextprotocol/sdk`
 * package, Drizzle, the database client, the application layer, or adapters.
 * They describe the shape of persisted MCP data as understood by the domain,
 * independent of any storage engine or wire protocol.
 */

export type McpTransportKind = 'stdio' | 'streamable_http'

export type McpWorkspaceScope = 'account' | 'run'

/** Mirrors the MCP SDK `LoggingLevel` literal union without importing the SDK. */
export type McpLogLevel =
  | 'alert'
  | 'critical'
  | 'debug'
  | 'emergency'
  | 'error'
  | 'info'
  | 'notice'
  | 'warning'

export type McpStoredSecretValue = EncryptedSecret | string | null

export type McpStoredHttpAuthConfig =
  | {
      kind: 'none'
    }
  | {
      kind: 'bearer'
      token: McpStoredSecretValue
    }
  | {
      clientId: string | null
      clientName: string | null
      clientSecret: McpStoredSecretValue
      kind: 'oauth_authorization_code'
      resource: string | null
      resourceMetadataUrl: string | null
      scope: string | null
      tokenEndpointAuthMethod: string | null
    }
  | {
      clientId: string
      clientSecret: McpStoredSecretValue
      kind: 'oauth_client_credentials'
      resource: string | null
      resourceMetadataUrl: string | null
      scope: string | null
    }
  | {
      algorithm: string
      clientId: string
      kind: 'oauth_private_key_jwt'
      privateKey: McpStoredSecretValue
      resource: string | null
      resourceMetadataUrl: string | null
      scope: string | null
    }
  | {
      assertion: McpStoredSecretValue
      clientId: string
      kind: 'oauth_static_private_key_jwt'
      resource: string | null
      resourceMetadataUrl: string | null
      scope: string | null
    }

export type McpStoredServerTransportConfig =
  | {
      args?: string[]
      command: string
      cwd?: string
      env?: Record<string, string>
      stderr?: 'inherit' | 'pipe'
      workspaceScoped?: McpWorkspaceScope
    }
  | {
      auth: McpStoredHttpAuthConfig
      headers?: Record<string, string>
      url: string
    }

export type McpAppToolVisibility = 'app' | 'model'

export interface McpAppsToolMeta {
  csp: Record<string, unknown> | null
  domain: string | null
  permissions: Record<string, unknown> | null
  resourceUri: string | null
  visibility: McpAppToolVisibility[]
}

/** Encrypted-at-rest OAuth token storage shape (no SDK types involved). */
export interface McpStoredOAuthTokens {
  access_token: EncryptedSecret | string
  expires_in?: number
  id_token?: EncryptedSecret | string
  refresh_token?: EncryptedSecret | string
  scope?: string
  token_type: string
}

/** Encrypted-at-rest OAuth client information storage shape. */
export interface McpStoredOAuthClientInformation {
  client_id: string
  client_id_issued_at?: number
  client_secret?: EncryptedSecret | string
  client_secret_expires_at?: number
}

/** Opaque JSON blob for cached OAuth discovery state (protocol-neutral). */
export type McpOauthDiscoveryStateJson = Record<string, unknown>
