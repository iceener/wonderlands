import type { DomainError } from '../../shared/errors'
import type { AccountId, RunId, TenantId, WorkSessionId, WorkspaceId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export interface WorkSessionRecord {
  archivedAt: string | null
  createdAt: string
  createdByAccountId: AccountId | null
  deletedAt: string | null
  id: WorkSessionId
  metadata: Record<string, unknown> | null
  rootRunId: RunId | null
  status: 'active' | 'archived' | 'deleted'
  tenantId: TenantId
  title: string | null
  updatedAt: string
  workspaceId: WorkspaceId | null
  workspaceRef: string | null
}

export interface CreateWorkSessionInput {
  createdAt: string
  createdByAccountId: AccountId | null
  id: WorkSessionId
  metadata: Record<string, unknown> | null
  status: 'active'
  title: string | null
  updatedAt: string
  workspaceId: WorkspaceId | null
  workspaceRef: string | null
}

export interface AssignWorkSessionRootRunInput {
  rootRunId: RunId
  sessionId: WorkSessionId
  updatedAt: string
}

export interface AssignWorkSessionWorkspaceInput {
  sessionId: WorkSessionId
  updatedAt: string
  workspaceId: WorkspaceId
  workspaceRef: string
}

/**
 * Persistence-neutral port for work session storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface WorkSessionRepository {
  assignRootRun: (
    scope: TenantScope,
    input: AssignWorkSessionRootRunInput,
  ) => Result<WorkSessionRecord, DomainError>
  assignWorkspace: (
    scope: TenantScope,
    input: AssignWorkSessionWorkspaceInput,
  ) => Result<WorkSessionRecord, DomainError>
  create: (
    scope: TenantScope,
    input: CreateWorkSessionInput,
  ) => Result<WorkSessionRecord, DomainError>
  getById: (scope: TenantScope, sessionId: WorkSessionId) => Result<WorkSessionRecord, DomainError>
  /**
   * Looks up a work session by tenant + id without requiring an already
   * resolved {@link TenantScope}. Used to bootstrap a tenant scope (e.g.
   * resolving the owning account/role for a session) before the caller's
   * accountId/role are known. Returns `null` (not an error) when no session
   * matches.
   */
  findByIdForTenant: (
    tenantId: TenantId,
    sessionId: WorkSessionId,
  ) => Result<WorkSessionRecord | null, DomainError>
}
