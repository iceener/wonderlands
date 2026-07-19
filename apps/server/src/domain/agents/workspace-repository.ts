import type { DomainError } from '../../shared/errors'
import type { AccountId, TenantId, WorkspaceId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { WorkspaceKind, WorkspaceStatus } from './agent-types'

export interface WorkspaceRecord {
  accountId: AccountId
  createdAt: string
  id: WorkspaceId
  kind: WorkspaceKind
  label: string | null
  rootRef: string
  status: WorkspaceStatus
  tenantId: TenantId
  updatedAt: string
}

export interface CreateWorkspaceInput {
  accountId: AccountId
  createdAt: string
  id: WorkspaceId
  kind: WorkspaceKind
  label?: string | null
  rootRef: string
  status: Extract<WorkspaceStatus, 'active' | 'archived'>
  updatedAt: string
}

/**
 * Persistence-neutral port for workspace storage. Concrete implementations
 * (e.g. the Drizzle/SQLite adapter) live under `adapters/persistence/sqlite/`.
 * This module must not import anything from `db`, `drizzle-orm`,
 * `application`, or `adapters` -- see `test/architecture-guardrails.test.ts`.
 */
export interface WorkspaceRepository {
  create: (scope: TenantScope, input: CreateWorkspaceInput) => Result<WorkspaceRecord, DomainError>
  getByAccountAndKind: (
    scope: TenantScope,
    input: { accountId: AccountId; kind: WorkspaceKind },
  ) => Result<WorkspaceRecord, DomainError>
  getById: (scope: TenantScope, workspaceId: WorkspaceId) => Result<WorkspaceRecord, DomainError>
}
