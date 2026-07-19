import type { DomainError } from '../../shared/errors'
import type { TenantId, ToolProfileId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export interface McpToolAssignmentRecord {
  approvedAt: string | null
  approvedFingerprint: string | null
  createdAt: string
  id: string
  requiresConfirmation: boolean
  runtimeName: string
  serverId: string
  tenantId: TenantId
  toolProfileId: ToolProfileId
  updatedAt: string
}

export interface UpsertMcpToolAssignmentInput {
  id: string
  requiresConfirmation: boolean
  runtimeName: string
  serverId: string
  toolProfileId: ToolProfileId
  updatedAt: string
}

/**
 * Protocol-neutral repository contract for MCP tool assignments. Concrete
 * persistence lives in
 * `apps/server/src/adapters/persistence/sqlite/mcp/mcp-tool-assignment-repository.ts`.
 */
export interface McpToolAssignmentRepository {
  approveFingerprint: (
    scope: TenantScope,
    input: {
      approvedAt: string
      fingerprint: string
      toolProfileId: ToolProfileId
      runtimeName: string
    },
  ) => Result<McpToolAssignmentRecord, DomainError>
  approveFingerprintByAnyRuntimeName: (
    scope: TenantScope,
    input: {
      approvedAt: string
      fingerprint: string
      toolProfileId: ToolProfileId
      runtimeNames: string[]
    },
  ) => Result<McpToolAssignmentRecord, DomainError>
  deleteByServerId: (scope: TenantScope, serverId: string) => Result<number, DomainError>
  deleteByRuntimeName: (
    scope: TenantScope,
    profile: string,
    runtimeName: string,
  ) => Result<McpToolAssignmentRecord, DomainError>
  deleteByAnyRuntimeName: (
    scope: TenantScope,
    profile: string,
    runtimeNames: string[],
  ) => Result<McpToolAssignmentRecord, DomainError>
  getByAnyRuntimeName: (
    scope: TenantScope,
    profile: string,
    runtimeNames: readonly string[],
  ) => Result<McpToolAssignmentRecord, DomainError>
  getByRuntimeName: (
    scope: TenantScope,
    profile: string,
    runtimeName: string,
  ) => Result<McpToolAssignmentRecord, DomainError>
  listByProfile: (
    scope: TenantScope,
    profile: string,
  ) => Result<McpToolAssignmentRecord[], DomainError>
  upsert: (
    scope: TenantScope,
    input: UpsertMcpToolAssignmentInput,
  ) => Result<McpToolAssignmentRecord, DomainError>
}
