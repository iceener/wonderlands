import type { DomainError } from '../../shared/errors'
import type { FileId, SandboxExecutionFileId, SandboxExecutionId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { SandboxExecutionFileRole } from './types'

export interface SandboxExecutionFileRecord {
  checksumSha256: string | null
  createdAt: string
  createdFileId: FileId | null
  id: SandboxExecutionFileId
  mimeType: string | null
  role: SandboxExecutionFileRole
  sandboxExecutionId: SandboxExecutionId
  sandboxPath: string
  sizeBytes: number | null
  sourceFileId: FileId | null
  sourceVaultPath: string | null
  targetVaultPath: string | null
  tenantId: TenantId
}

export interface CreateSandboxExecutionFileInput {
  checksumSha256?: string | null
  createdAt: string
  createdFileId?: FileId | null
  id: SandboxExecutionFileId
  mimeType?: string | null
  role: SandboxExecutionFileRole
  sandboxExecutionId: SandboxExecutionId
  sandboxPath: string
  sizeBytes?: number | null
  sourceFileId?: FileId | null
  sourceVaultPath?: string | null
  targetVaultPath?: string | null
}

/**
 * Persistence-neutral port for sandbox execution file storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface SandboxExecutionFileRepository {
  create: (
    scope: TenantScope,
    input: CreateSandboxExecutionFileInput,
  ) => Result<SandboxExecutionFileRecord, DomainError>
  listBySandboxExecutionId: (
    scope: TenantScope,
    sandboxExecutionId: SandboxExecutionId,
  ) => Result<SandboxExecutionFileRecord[], DomainError>
}
