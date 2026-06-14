import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

import type { EncryptedSecret } from '../../shared/secret-box'
import { decryptStoredSecret, encryptStoredSecret } from './stored-auth'

export interface McpStoredOAuthTokens {
  access_token: EncryptedSecret | string
  expires_in?: number
  id_token?: EncryptedSecret | string
  refresh_token?: EncryptedSecret | string
  scope?: string
  token_type: string
}

export interface McpStoredOAuthClientInformation {
  client_id: string
  client_id_issued_at?: number
  client_secret?: EncryptedSecret | string
  client_secret_expires_at?: number
}

export const protectStoredOauthTokens = (
  tokens: OAuthTokens | null,
  encryptionKey: string | null,
): McpStoredOAuthTokens | null => {
  if (!tokens) {
    return null
  }

  return {
    access_token: encryptStoredSecret(
      tokens.access_token,
      encryptionKey,
      'MCP OAuth access token',
    )!,
    ...(tokens.expires_in !== undefined ? { expires_in: tokens.expires_in } : {}),
    ...(tokens.id_token !== undefined
      ? {
          id_token: encryptStoredSecret(tokens.id_token, encryptionKey, 'MCP OAuth ID token')!,
        }
      : {}),
    ...(tokens.refresh_token !== undefined
      ? {
          refresh_token: encryptStoredSecret(
            tokens.refresh_token,
            encryptionKey,
            'MCP OAuth refresh token',
          )!,
        }
      : {}),
    ...(tokens.scope !== undefined ? { scope: tokens.scope } : {}),
    token_type: tokens.token_type,
  }
}

export const revealStoredOauthTokens = (
  tokens: McpStoredOAuthTokens | null | undefined,
  encryptionKey: string | null,
): OAuthTokens | undefined => {
  if (!tokens) {
    return undefined
  }

  const accessToken = decryptStoredSecret(tokens.access_token, encryptionKey)

  if (!accessToken) {
    return undefined
  }

  const idToken =
    tokens.id_token !== undefined
      ? (decryptStoredSecret(tokens.id_token, encryptionKey) ?? undefined)
      : undefined
  const refreshToken =
    tokens.refresh_token !== undefined
      ? (decryptStoredSecret(tokens.refresh_token, encryptionKey) ?? undefined)
      : undefined

  return {
    access_token: accessToken,
    ...(tokens.expires_in !== undefined ? { expires_in: tokens.expires_in } : {}),
    ...(idToken !== undefined ? { id_token: idToken } : {}),
    ...(refreshToken !== undefined ? { refresh_token: refreshToken } : {}),
    ...(tokens.scope !== undefined ? { scope: tokens.scope } : {}),
    token_type: tokens.token_type,
  }
}

export const protectStoredOauthClientInformation = (
  clientInformation: OAuthClientInformationMixed | null,
  encryptionKey: string | null,
): McpStoredOAuthClientInformation | null => {
  if (!clientInformation) {
    return null
  }

  return {
    client_id: clientInformation.client_id,
    ...(clientInformation.client_id_issued_at !== undefined
      ? {
          client_id_issued_at: clientInformation.client_id_issued_at,
        }
      : {}),
    ...(clientInformation.client_secret !== undefined
      ? {
          client_secret: encryptStoredSecret(
            clientInformation.client_secret,
            encryptionKey,
            'MCP OAuth client secret',
          )!,
        }
      : {}),
    ...(clientInformation.client_secret_expires_at !== undefined
      ? {
          client_secret_expires_at: clientInformation.client_secret_expires_at,
        }
      : {}),
  }
}

export const revealStoredOauthClientInformation = (
  clientInformation: McpStoredOAuthClientInformation | null | undefined,
  encryptionKey: string | null,
): OAuthClientInformationMixed | undefined => {
  if (!clientInformation) {
    return undefined
  }

  const clientSecret =
    clientInformation.client_secret !== undefined
      ? (decryptStoredSecret(clientInformation.client_secret, encryptionKey) ?? undefined)
      : undefined

  return {
    client_id: clientInformation.client_id,
    ...(clientInformation.client_id_issued_at !== undefined
      ? {
          client_id_issued_at: clientInformation.client_id_issued_at,
        }
      : {}),
    ...(clientSecret !== undefined ? { client_secret: clientSecret } : {}),
    ...(clientInformation.client_secret_expires_at !== undefined
      ? {
          client_secret_expires_at: clientInformation.client_secret_expires_at,
        }
      : {}),
  }
}

export const cloneStoredOauthDiscoveryState = (
  discoveryState: OAuthDiscoveryState | null | undefined,
): OAuthDiscoveryState | null =>
  discoveryState ? (JSON.parse(JSON.stringify(discoveryState)) as OAuthDiscoveryState) : null
