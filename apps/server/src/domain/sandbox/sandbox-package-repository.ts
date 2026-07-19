import type { DomainError } from '../../shared/errors'
import type { SandboxExecutionId, SandboxExecutionPackageId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { SandboxPackageStatus } from './types'

export interface SandboxExecutionPackageRecord {
  createdAt: string
  errorText: string | null
  id: SandboxExecutionPackageId
  installScriptsAllowed: boolean
  name: string
  registryHost: string | null
  requestedVersion: string
  resolvedVersion: string | null
  sandboxExecutionId: SandboxExecutionId
  status: SandboxPackageStatus
  tenantId: TenantId
}

export interface CreateSandboxExecutionPackageInput {
  createdAt: string
  errorText?: string | null
  id: SandboxExecutionPackageId
  installScriptsAllowed?: boolean
  name: string
  registryHost?: string | null
  requestedVersion: string
  resolvedVersion?: string | null
  sandboxExecutionId: SandboxExecutionId
  status: SandboxPackageStatus
}

export interface UpdateSandboxExecutionPackageInput {
  errorText?: string | null
  id: SandboxExecutionPackageId
  resolvedVersion?: string | null
  status?: SandboxPackageStatus
}

/**
 * Persistence-neutral port for sandbox execution package storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface SandboxExecutionPackageRepository {
  create: (
    scope: TenantScope,
    input: CreateSandboxExecutionPackageInput,
  ) => Result<SandboxExecutionPackageRecord, DomainError>
  listBySandboxExecutionId: (
    scope: TenantScope,
    sandboxExecutionId: SandboxExecutionId,
  ) => Result<SandboxExecutionPackageRecord[], DomainError>
  update: (
    scope: TenantScope,
    input: UpdateSandboxExecutionPackageInput,
  ) => Result<SandboxExecutionPackageRecord, DomainError>
}
