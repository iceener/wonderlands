import type {
  McpResolvedHttpAuthConfig,
  McpServerConfig,
  McpStreamableHttpServerConfig,
} from './types'

export type McpAuthorizationCodeHttpAuthConfig = Extract<
  McpResolvedHttpAuthConfig,
  { kind: 'oauth_authorization_code' }
>

export type McpOauthStartableStreamableHttpServerConfig = McpStreamableHttpServerConfig & {
  auth: Extract<McpResolvedHttpAuthConfig, { kind: 'none' | 'oauth_authorization_code' }>
}

export type McpAuthorizationCodeServerConfig = McpStreamableHttpServerConfig & {
  auth: McpAuthorizationCodeHttpAuthConfig
}

export const isAuthorizationCodeServer = (
  server: McpServerConfig,
): server is McpAuthorizationCodeServerConfig =>
  server.kind === 'streamable_http' && server.auth.kind === 'oauth_authorization_code'

export const canStartAuthorizationCodeOAuth = (
  server: McpServerConfig,
): server is McpOauthStartableStreamableHttpServerConfig =>
  server.kind === 'streamable_http' &&
  (server.auth.kind === 'oauth_authorization_code' || server.auth.kind === 'none')

export const toAuthorizationCodeAuthConfig = (
  auth: McpResolvedHttpAuthConfig,
): McpAuthorizationCodeHttpAuthConfig => {
  switch (auth.kind) {
    case 'oauth_authorization_code':
      return auth
    case 'none':
      return {
        clientId: null,
        clientName: null,
        clientSecret: null,
        kind: 'oauth_authorization_code',
        resource: null,
        resourceMetadataUrl: null,
        scope: null,
        tokenEndpointAuthMethod: null,
      }
    default:
      throw new Error(`HTTP auth kind ${auth.kind} does not support browser OAuth authorization`)
  }
}

export const toAuthorizationCodeServerConfig = (
  server: McpStreamableHttpServerConfig,
): McpAuthorizationCodeServerConfig => ({
  ...server,
  auth: toAuthorizationCodeAuthConfig(server.auth),
})
