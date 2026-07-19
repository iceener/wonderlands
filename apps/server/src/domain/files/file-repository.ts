import type { DomainError } from '../../shared/errors'
import type { AccountId, FileId, RunId, SessionMessageId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { FileAccessScope } from './file-access'

export interface FileRecord {
  accessScope: FileAccessScope
  checksumSha256: string | null
  createdAt: string
  createdByAccountId: AccountId | null
  createdByRunId: RunId | null
  id: FileId
  metadata: unknown | null
  mimeType: string | null
  originUploadId: string | null
  originalFilename: string | null
  sizeBytes: number | null
  sourceKind: 'upload' | 'artifact' | 'generated' | 'derived'
  status: 'ready' | 'processing' | 'failed' | 'deleted'
  storageKey: string
  tenantId: TenantId
  title: string | null
  updatedAt: string
}

export interface CreateFileInput {
  accessScope: FileAccessScope
  checksumSha256?: string | null
  createdAt: string
  createdByAccountId?: AccountId | null
  createdByRunId?: RunId | null
  id: FileId
  metadata?: unknown | null
  mimeType?: string | null
  originUploadId?: string | null
  originalFilename?: string | null
  sizeBytes?: number | null
  sourceKind: FileRecord['sourceKind']
  status: FileRecord['status']
  storageKey: string
  title?: string | null
  updatedAt: string
}

export interface MessageLinkedFileRecord {
  file: FileRecord
  messageId: SessionMessageId
}

export interface RunLinkedFileRecord {
  file: FileRecord
  runId: RunId
}

/**
 * Persistence-neutral port for file storage. Concrete implementations (e.g.
 * the Drizzle/SQLite adapter) live under `adapters/persistence/sqlite/`. This
 * module must not import anything from `db`, `drizzle-orm`, `application`, or
 * `adapters` -- see `test/architecture-guardrails.test.ts`.
 */
export interface FileRepository {
  create: (scope: TenantScope, input: CreateFileInput) => Result<FileRecord, DomainError>
  getById: (scope: TenantScope, fileId: FileId) => Result<FileRecord, DomainError>
  listAccountLibraryByAccountId: (scope: TenantScope) => Result<FileRecord[], DomainError>
  listByIds: (scope: TenantScope, fileIds: FileId[]) => Result<FileRecord[], DomainError>
  listByMessageIds: (
    scope: TenantScope,
    messageIds: SessionMessageId[],
  ) => Result<MessageLinkedFileRecord[], DomainError>
  listByRunId: (scope: TenantScope, runId: RunId) => Result<FileRecord[], DomainError>
  listByRunIds: (scope: TenantScope, runIds: RunId[]) => Result<RunLinkedFileRecord[], DomainError>
  listBySessionId: (scope: TenantScope, sessionId: string) => Result<FileRecord[], DomainError>
}
