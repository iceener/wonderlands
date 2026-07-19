import type { DomainError } from '../../shared/errors'
import type { AccountId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type {
  McpOauthDiscoveryStateJson,
  McpStoredOAuthClientInformation,
  McpStoredOAuthTokens,
} from './mcp-domain-types'

export type { McpStoredOAuthClientInformation, McpStoredOAuthTokens } from './mcp-domain-types'

export interface McpOauthCredentialRecord {
  accountId: AccountId
  clientInformationJson: McpStoredOAuthClientInformation | null
  createdAt: string
  discoveryStateJson: McpOauthDiscoveryStateJson | null
  id: string
  serverId: string
  tenantId: TenantId
  tokensJson: McpStoredOAuthTokens | null
  updatedAt: string
}

export interface UpsertMcpOauthCredentialInput {
  clientInformationJson?: McpStoredOAuthClientInformation | null
  discoveryStateJson?: McpOauthDiscoveryStateJson | null
  id: string
  serverId: string
  tokensJson?: McpStoredOAuthTokens | null
  updatedAt: string
}

/**
 * Protocol-neutral repository contract for MCP OAuth credentials. Concrete
 * persistence lives in
 * `apps/server/src/adapters/persistence/sqlite/mcp/mcp-oauth-credential-repository.ts`.
 */
export interface McpOauthCredentialRepository {
  deleteByServerId: (scope: TenantScope, serverId: string) => Result<number, DomainError>
  getByServerId: (
    scope: TenantScope,
    serverId: string,
  ) => Result<McpOauthCredentialRecord, DomainError>
  listAll: () => Result<McpOauthCredentialRecord[], DomainError>
  upsert: (
    scope: TenantScope,
    input: UpsertMcpOauthCredentialInput,
  ) => Result<McpOauthCredentialRecord, DomainError>
}
