import type { DomainError } from '../../shared/errors'
import type {
  AccountId,
  SandboxExecutionId,
  SandboxWritebackOperationId,
  TenantId,
} from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { SandboxWritebackOperation, SandboxWritebackStatus } from './types'

export interface SandboxWritebackOperationRecord {
  appliedAt: string | null
  approvedAt: string | null
  approvedByAccountId: AccountId | null
  createdAt: string
  errorText: string | null
  id: SandboxWritebackOperationId
  operation: SandboxWritebackOperation
  requiresApproval: boolean
  sandboxExecutionId: SandboxExecutionId
  sourceSandboxPath: string
  status: SandboxWritebackStatus
  targetVaultPath: string
  tenantId: TenantId
}

export interface CreateSandboxWritebackOperationInput {
  createdAt: string
  id: SandboxWritebackOperationId
  operation: SandboxWritebackOperation
  requiresApproval?: boolean
  sandboxExecutionId: SandboxExecutionId
  sourceSandboxPath: string
  status: SandboxWritebackStatus
  targetVaultPath: string
}

export interface UpdateSandboxWritebackOperationInput {
  appliedAt?: string | null
  approvedAt?: string | null
  approvedByAccountId?: AccountId | null
  errorText?: string | null
  id: SandboxWritebackOperationId
  status?: SandboxWritebackStatus
}

/**
 * Persistence-neutral port for sandbox writeback operation storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface SandboxWritebackRepository {
  create: (
    scope: TenantScope,
    input: CreateSandboxWritebackOperationInput,
  ) => Result<SandboxWritebackOperationRecord, DomainError>
  listBySandboxExecutionId: (
    scope: TenantScope,
    sandboxExecutionId: SandboxExecutionId,
  ) => Result<SandboxWritebackOperationRecord[], DomainError>
  update: (
    scope: TenantScope,
    input: UpdateSandboxWritebackOperationInput,
  ) => Result<SandboxWritebackOperationRecord, DomainError>
}
