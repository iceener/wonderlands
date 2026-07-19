import type { DomainError } from '../../shared/errors'
import type { AccountId, FileId, TenantId, UploadId, WorkSessionId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { FileAccessScope, UploadStatus } from './file-access'

export interface UploadRecord {
  accessScope: FileAccessScope
  accountId: AccountId | null
  checksumSha256: string | null
  completedAt: string | null
  createdAt: string
  declaredMimeType: string | null
  detectedMimeType: string | null
  errorText: string | null
  fileId: FileId | null
  id: UploadId
  originalFilename: string
  sessionId: WorkSessionId | null
  sizeBytes: number | null
  stagedStorageKey: string | null
  status: UploadStatus
  tenantId: TenantId
  title: string | null
  updatedAt: string
}

export interface CreateUploadInput {
  accessScope: FileAccessScope
  accountId: AccountId | null
  createdAt: string
  declaredMimeType?: string | null
  id: UploadId
  originalFilename: string
  sessionId?: WorkSessionId | null
  status: Extract<UploadStatus, 'pending'>
  title?: string | null
  updatedAt: string
}

export interface CompleteUploadInput {
  checksumSha256: string
  completedAt: string
  detectedMimeType: string | null
  fileId: FileId
  id: UploadId
  sizeBytes: number
  stagedStorageKey: string
  updatedAt: string
}

export interface FailUploadInput {
  errorText: string
  id: UploadId
  updatedAt: string
}

/**
 * Persistence-neutral port for upload storage. Concrete implementations
 * (e.g. the Drizzle/SQLite adapter) live under `adapters/persistence/sqlite/`.
 * This module must not import anything from `db`, `drizzle-orm`,
 * `application`, or `adapters` -- see `test/architecture-guardrails.test.ts`.
 */
export interface UploadRepository {
  complete: (scope: TenantScope, input: CompleteUploadInput) => Result<UploadRecord, DomainError>
  create: (scope: TenantScope, input: CreateUploadInput) => Result<UploadRecord, DomainError>
  fail: (scope: TenantScope, input: FailUploadInput) => Result<UploadRecord, DomainError>
  getById: (scope: TenantScope, uploadId: UploadId) => Result<UploadRecord, DomainError>
}
