import type { McpStoredHttpAuthConfig } from '../../domain/mcp/mcp-server-repository'
import { DomainErrorException } from '../../shared/errors'
import { createSecretBox, type EncryptedSecret, isEncryptedSecret } from '../../shared/secret-box'
import type { McpResolvedHttpAuthConfig } from './types'

export const encryptStoredSecret = (
  value: string | null,
  encryptionKey: string | null,
  fieldLabel: string,
) => {
  if (value === null) {
    return null
  }

  if (!encryptionKey) {
    throw new DomainErrorException({
      message: `MCP_SECRET_ENCRYPTION_KEY must be configured before storing ${fieldLabel}`,
      type: 'validation',
    })
  }

  return createSecretBox(encryptionKey).encryptString(value)
}

export const decryptStoredSecret = (
  value: EncryptedSecret | string | null,
  encryptionKey: string | null,
): string | null => {
  if (value === null) {
    return null
  }

  if (typeof value === 'string') {
    return value
  }

  if (!isEncryptedSecret(value) || !encryptionKey) {
    return null
  }

  try {
    return createSecretBox(encryptionKey).decryptString(value)
  } catch {
    return null
  }
}

export const protectStoredHttpAuthConfig = (
  auth: McpResolvedHttpAuthConfig,
  encryptionKey: string | null,
): McpStoredHttpAuthConfig => {
  switch (auth.kind) {
    case 'none':
      return { kind: 'none' }
    case 'bearer':
      return {
        kind: 'bearer',
        token: encryptStoredSecret(auth.token, encryptionKey, 'MCP bearer token'),
      }
    case 'oauth_authorization_code':
      return {
        clientId: auth.clientId,
        clientName: auth.clientName,
        clientSecret: encryptStoredSecret(
          auth.clientSecret,
          encryptionKey,
          'MCP OAuth client secret',
        ),
        kind: auth.kind,
        resource: auth.resource,
        resourceMetadataUrl: auth.resourceMetadataUrl,
        scope: auth.scope,
        tokenEndpointAuthMethod: auth.tokenEndpointAuthMethod,
      }
    case 'oauth_client_credentials':
      return {
        clientId: auth.clientId,
        clientSecret: encryptStoredSecret(
          auth.clientSecret,
          encryptionKey,
          'MCP OAuth client secret',
        ),
        kind: auth.kind,
        resource: auth.resource,
        resourceMetadataUrl: auth.resourceMetadataUrl,
        scope: auth.scope,
      }
    case 'oauth_private_key_jwt':
      return {
        algorithm: auth.algorithm,
        clientId: auth.clientId,
        kind: auth.kind,
        privateKey: encryptStoredSecret(auth.privateKey, encryptionKey, 'MCP OAuth private key'),
        resource: auth.resource,
        resourceMetadataUrl: auth.resourceMetadataUrl,
        scope: auth.scope,
      }
    case 'oauth_static_private_key_jwt':
      return {
        assertion: encryptStoredSecret(auth.assertion, encryptionKey, 'MCP OAuth JWT assertion'),
        clientId: auth.clientId,
        kind: auth.kind,
        resource: auth.resource,
        resourceMetadataUrl: auth.resourceMetadataUrl,
        scope: auth.scope,
      }
  }
}

export const revealStoredHttpAuthConfig = (
  auth: McpStoredHttpAuthConfig,
  encryptionKey: string | null,
): McpResolvedHttpAuthConfig => {
  switch (auth.kind) {
    case 'none':
      return { kind: 'none' }
    case 'bearer':
      return {
        kind: 'bearer',
        token: decryptStoredSecret(auth.token, encryptionKey),
      }
    case 'oauth_authorization_code':
      return {
        clientId: auth.clientId,
        clientName: auth.clientName,
        clientSecret: decryptStoredSecret(auth.clientSecret, encryptionKey),
        kind: auth.kind,
        resource: auth.resource,
        resourceMetadataUrl: auth.resourceMetadataUrl,
        scope: auth.scope,
        tokenEndpointAuthMethod: auth.tokenEndpointAuthMethod,
      }
    case 'oauth_client_credentials':
      return {
        clientId: auth.clientId,
        clientSecret: decryptStoredSecret(auth.clientSecret, encryptionKey),
        kind: auth.kind,
        resource: auth.resource,
        resourceMetadataUrl: auth.resourceMetadataUrl,
        scope: auth.scope,
      }
    case 'oauth_private_key_jwt':
      return {
        algorithm: auth.algorithm,
        clientId: auth.clientId,
        kind: auth.kind,
        privateKey: decryptStoredSecret(auth.privateKey, encryptionKey),
        resource: auth.resource,
        resourceMetadataUrl: auth.resourceMetadataUrl,
        scope: auth.scope,
      }
    case 'oauth_static_private_key_jwt':
      return {
        assertion: decryptStoredSecret(auth.assertion, encryptionKey),
        clientId: auth.clientId,
        kind: auth.kind,
        resource: auth.resource,
        resourceMetadataUrl: auth.resourceMetadataUrl,
        scope: auth.scope,
      }
  }
}
