import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js'
import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

import type { RepositoryDatabase } from '../../domain/database-port'
import {
  createMcpOauthAuthorizationRepository,
  type McpOauthAuthorizationRecord,
} from '../../domain/mcp/mcp-oauth-authorization-repository'
import {
  createMcpOauthCredentialRepository,
  type McpOauthCredentialRecord,
} from '../../domain/mcp/mcp-oauth-credential-repository'
import { createPrefixedId } from '../../shared/ids'
import type { TenantScope } from '../../shared/scope'
import { decryptStoredSecret, encryptStoredSecret } from './stored-auth'
import {
  cloneStoredOauthDiscoveryState,
  protectStoredOauthClientInformation,
  protectStoredOauthTokens,
  revealStoredOauthClientInformation,
  revealStoredOauthTokens,
} from './stored-oauth'
import type { McpResolvedHttpAuthConfig } from './types'

const AUTHORIZATION_TTL_MS = 15 * 60 * 1000

type McpAuthorizationCodeConfig = Extract<
  McpResolvedHttpAuthConfig,
  { kind: 'oauth_authorization_code' }
>

interface StoredMcpOAuthProviderOptions {
  auth: McpAuthorizationCodeConfig
  authorizationId?: string
  db: RepositoryDatabase
  encryptionKey: string | null
  nowIso: () => string
  onRedirect?: (url: URL) => void
  redirectUrl: string
  responseOrigin?: string | null
  scope: TenantScope
  serverId: string
}

const buildClientMetadata = (
  authConfig: McpAuthorizationCodeConfig,
  redirectUrl: string,
): OAuthClientMetadata => ({
  client_name: authConfig.clientName ?? '05_04_api MCP Client',
  grant_types: ['authorization_code', 'refresh_token'],
  redirect_uris: [redirectUrl],
  response_types: ['code'],
  scope: authConfig.scope ?? undefined,
  token_endpoint_auth_method:
    authConfig.tokenEndpointAuthMethod ??
    (authConfig.clientSecret ? 'client_secret_basic' : 'none'),
})

const toStaticClientInformation = (
  authConfig: McpAuthorizationCodeConfig,
): OAuthClientInformationMixed | undefined => {
  if (!authConfig.clientId) {
    return undefined
  }

  return {
    client_id: authConfig.clientId,
    ...(authConfig.clientSecret ? { client_secret: authConfig.clientSecret } : {}),
  }
}

class StoredMcpOAuthProvider implements OAuthClientProvider {
  private authorizationUrl: URL | null = null
  private ephemeralState: string | null = null

  constructor(private readonly options: StoredMcpOAuthProviderOptions) {}

  get redirectUrl(): string {
    return this.options.redirectUrl
  }

  get clientMetadata(): OAuthClientMetadata {
    return buildClientMetadata(this.options.auth, this.options.redirectUrl)
  }

  private get authorizationRepository() {
    return createMcpOauthAuthorizationRepository(this.options.db)
  }

  private get credentialRepository() {
    return createMcpOauthCredentialRepository(this.options.db)
  }

  private getCredentialRecord(): McpOauthCredentialRecord | null {
    const credential = this.credentialRepository.getByServerId(
      this.options.scope,
      this.options.serverId,
    )

    return credential.ok ? credential.value : null
  }

  private getAuthorizationRecord(): McpOauthAuthorizationRecord | null {
    if (!this.options.authorizationId) {
      return null
    }

    const authorization = this.authorizationRepository.getById(this.options.authorizationId)
    return authorization.ok ? authorization.value : null
  }

  private upsertCredential(input: {
    clientInformation?: OAuthClientInformationMixed | null
    discoveryState?: OAuthDiscoveryState | null
    tokens?: OAuthTokens | null
  }): void {
    const existing = this.getCredentialRecord()
    const now = this.options.nowIso()
    const result = this.credentialRepository.upsert(this.options.scope, {
      clientInformationJson:
        input.clientInformation !== undefined
          ? protectStoredOauthClientInformation(input.clientInformation, this.options.encryptionKey)
          : existing?.clientInformationJson,
      discoveryStateJson:
        input.discoveryState !== undefined
          ? cloneStoredOauthDiscoveryState(input.discoveryState)
          : existing?.discoveryStateJson,
      id: existing?.id ?? createPrefixedId('moc'),
      serverId: this.options.serverId,
      tokensJson:
        input.tokens !== undefined
          ? protectStoredOauthTokens(input.tokens, this.options.encryptionKey)
          : existing?.tokensJson,
      updatedAt: now,
    })

    if (!result.ok) {
      throw new Error(result.error.message)
    }
  }

  private upsertAuthorization(codeVerifier: string | null): void {
    if (!this.options.authorizationId) {
      throw new Error(
        `MCP server ${this.options.serverId} is missing its OAuth authorization state`,
      )
    }

    const now = this.options.nowIso()
    const existing = this.getAuthorizationRecord()
    const result = this.authorizationRepository.upsert(this.options.scope, {
      codeVerifierSecretJson:
        codeVerifier === null
          ? null
          : encryptStoredSecret(
              codeVerifier,
              this.options.encryptionKey,
              'MCP OAuth PKCE verifier',
            ),
      expiresAt: new Date(Date.now() + AUTHORIZATION_TTL_MS).toISOString(),
      id: this.options.authorizationId,
      redirectUri: this.options.redirectUrl,
      responseOrigin: this.options.responseOrigin ?? existing?.responseOrigin ?? null,
      serverId: this.options.serverId,
      updatedAt: now,
    })

    if (!result.ok) {
      throw new Error(result.error.message)
    }
  }

  getCapturedAuthorizationUrl(): URL | null {
    return this.authorizationUrl
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const stored = this.getCredentialRecord()
    const revealed = revealStoredOauthClientInformation(
      stored?.clientInformationJson,
      this.options.encryptionKey,
    )

    return revealed ?? toStaticClientInformation(this.options.auth)
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.upsertCredential({
      clientInformation,
    })
  }

  tokens(): OAuthTokens | undefined {
    return revealStoredOauthTokens(
      this.getCredentialRecord()?.tokensJson,
      this.options.encryptionKey,
    )
  }

  saveTokens(tokens: OAuthTokens): void {
    this.upsertCredential({
      tokens,
    })
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl

    if (this.options.onRedirect) {
      this.options.onRedirect(authorizationUrl)
      return
    }

    throw new Error(
      `MCP OAuth authorization required for server ${this.options.serverId}: ${authorizationUrl.toString()}`,
    )
  }

  state(): string {
    if (this.options.authorizationId) {
      return this.options.authorizationId
    }

    if (!this.ephemeralState) {
      this.ephemeralState = createPrefixedId('moa')
    }

    return this.ephemeralState
  }

  saveCodeVerifier(codeVerifier: string): void {
    if (!this.options.authorizationId) {
      return
    }

    this.upsertAuthorization(codeVerifier)
  }

  codeVerifier(): string {
    const authorization = this.getAuthorizationRecord()

    if (!authorization?.codeVerifierSecretJson) {
      throw new Error(
        `MCP server ${this.options.serverId} does not have a saved OAuth code verifier`,
      )
    }

    const codeVerifier = decryptStoredSecret(
      authorization.codeVerifierSecretJson,
      this.options.encryptionKey,
    )

    if (!codeVerifier) {
      throw new Error(`MCP server ${this.options.serverId} has an unreadable OAuth code verifier`)
    }

    return codeVerifier
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'verifier' || scope === 'all') {
      if (this.options.authorizationId) {
        const deleted = this.authorizationRepository.deleteById(this.options.authorizationId)

        if (!deleted.ok) {
          throw new Error(deleted.error.message)
        }
      }
    }

    if (scope === 'client' || scope === 'tokens' || scope === 'discovery' || scope === 'all') {
      const existing = this.getCredentialRecord()

      if (!existing) {
        return
      }

      const staticClientInformation = toStaticClientInformation(this.options.auth)

      this.upsertCredential({
        clientInformation:
          scope === 'client' || scope === 'all'
            ? (staticClientInformation ?? null)
            : (revealStoredOauthClientInformation(
                existing.clientInformationJson,
                this.options.encryptionKey,
              ) ??
              staticClientInformation ??
              null),
        discoveryState:
          scope === 'discovery' || scope === 'all'
            ? null
            : cloneStoredOauthDiscoveryState(existing.discoveryStateJson),
        tokens:
          scope === 'tokens' || scope === 'all'
            ? null
            : (revealStoredOauthTokens(existing.tokensJson, this.options.encryptionKey) ?? null),
      })
    }
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return (
      cloneStoredOauthDiscoveryState(this.getCredentialRecord()?.discoveryStateJson) ?? undefined
    )
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.upsertCredential({
      discoveryState: state,
    })
  }
}

export const createStoredMcpOAuthProvider = (
  options: StoredMcpOAuthProviderOptions,
): StoredMcpOAuthProvider => new StoredMcpOAuthProvider(options)

export const beginStoredMcpAuthorization = async (input: {
  auth: McpAuthorizationCodeConfig
  authorizationId: string
  db: RepositoryDatabase
  encryptionKey: string | null
  nowIso: () => string
  redirectUrl: string
  responseOrigin?: string | null
  scope: TenantScope
  serverId: string
  serverUrl: string
}): Promise<{ authorizationUrl: string; kind: 'redirect' } | { kind: 'authorized' }> => {
  let redirectUrl: URL | null = null
  const provider = createStoredMcpOAuthProvider({
    auth: input.auth,
    authorizationId: input.authorizationId,
    db: input.db,
    encryptionKey: input.encryptionKey,
    nowIso: input.nowIso,
    onRedirect: (nextUrl) => {
      redirectUrl = nextUrl
    },
    redirectUrl: input.redirectUrl,
    responseOrigin: input.responseOrigin,
    scope: input.scope,
    serverId: input.serverId,
  })

  const result = await auth(provider, {
    resourceMetadataUrl: input.auth.resourceMetadataUrl
      ? new URL(input.auth.resourceMetadataUrl)
      : undefined,
    scope: input.auth.scope ?? undefined,
    serverUrl: input.serverUrl,
  })

  if (result === 'AUTHORIZED') {
    return { kind: 'authorized' }
  }

  if (!redirectUrl) {
    throw new Error(`MCP server ${input.serverId} did not produce an OAuth authorization URL`)
  }

  const authorizationUrl = (redirectUrl as URL).toString()

  return {
    authorizationUrl,
    kind: 'redirect',
  }
}

export const completeStoredMcpAuthorization = async (input: {
  auth: McpAuthorizationCodeConfig
  authorizationCode: string
  authorizationId: string
  db: RepositoryDatabase
  encryptionKey: string | null
  nowIso: () => string
  redirectUrl: string
  responseOrigin?: string | null
  scope: TenantScope
  serverId: string
  serverUrl: string
}): Promise<void> => {
  const provider = createStoredMcpOAuthProvider({
    auth: input.auth,
    authorizationId: input.authorizationId,
    db: input.db,
    encryptionKey: input.encryptionKey,
    nowIso: input.nowIso,
    redirectUrl: input.redirectUrl,
    responseOrigin: input.responseOrigin,
    scope: input.scope,
    serverId: input.serverId,
  })

  const result = await auth(provider, {
    authorizationCode: input.authorizationCode,
    resourceMetadataUrl: input.auth.resourceMetadataUrl
      ? new URL(input.auth.resourceMetadataUrl)
      : undefined,
    scope: input.auth.scope ?? undefined,
    serverUrl: input.serverUrl,
  })

  if (result !== 'AUTHORIZED') {
    throw new Error(`MCP server ${input.serverId} did not complete OAuth authorization`)
  }
}
