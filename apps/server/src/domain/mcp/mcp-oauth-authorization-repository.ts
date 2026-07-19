import type { DomainError } from '../../shared/errors'
import type { AccountId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { EncryptedSecret } from '../../shared/secret-box'

export interface McpOauthAuthorizationRecord {
  accountId: AccountId
  codeVerifierSecretJson: EncryptedSecret | null
  createdAt: string
  expiresAt: string
  id: string
  redirectUri: string
  responseOrigin: string | null
  serverId: string
  tenantId: TenantId
  updatedAt: string
}

export interface UpsertMcpOauthAuthorizationInput {
  codeVerifierSecretJson?: EncryptedSecret | null
  expiresAt: string
  id: string
  redirectUri: string
  responseOrigin?: string | null
  serverId: string
  updatedAt: string
}

/**
 * Protocol-neutral repository contract for in-flight MCP OAuth authorization
 * requests. Concrete persistence lives in
 * `apps/server/src/adapters/persistence/sqlite/mcp/mcp-oauth-authorization-repository.ts`.
 */
export interface McpOauthAuthorizationRepository {
  deleteExpired: (nowIso: string) => Result<number, DomainError>
  deleteById: (id: string) => Result<{ id: string }, DomainError>
  getById: (id: string) => Result<McpOauthAuthorizationRecord, DomainError>
  getByServerId: (
    scope: TenantScope,
    serverId: string,
  ) => Result<McpOauthAuthorizationRecord, DomainError>
  upsert: (
    scope: TenantScope,
    input: UpsertMcpOauthAuthorizationInput,
  ) => Result<McpOauthAuthorizationRecord, DomainError>
}
