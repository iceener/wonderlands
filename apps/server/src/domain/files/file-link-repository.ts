import type { DomainError } from '../../shared/errors'
import type { FileId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export interface FileLinkRecord {
  createdAt: string
  fileId: FileId
  id: string
  linkType: 'session' | 'thread' | 'message' | 'run' | 'tool_execution'
  targetId: string
  tenantId: TenantId
}

export interface CreateFileLinkInput {
  createdAt: string
  fileId: FileId
  id: string
  linkType: FileLinkRecord['linkType']
  targetId: string
}

/**
 * Persistence-neutral port for file link storage. Concrete implementations
 * (e.g. the Drizzle/SQLite adapter) live under `adapters/persistence/sqlite/`.
 * This module must not import anything from `db`, `drizzle-orm`,
 * `application`, or `adapters` -- see `test/architecture-guardrails.test.ts`.
 */
export interface FileLinkRepository {
  create: (scope: TenantScope, input: CreateFileLinkInput) => Result<FileLinkRecord, DomainError>
  exists: (
    scope: TenantScope,
    input: Pick<CreateFileLinkInput, 'fileId' | 'linkType' | 'targetId'>,
  ) => Result<boolean, DomainError>
  listByFileId: (scope: TenantScope, fileId: FileId) => Result<FileLinkRecord[], DomainError>
}
