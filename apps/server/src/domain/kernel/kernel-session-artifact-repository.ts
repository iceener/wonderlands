import type { DomainError } from '../../shared/errors'
import type { FileId, KernelSessionArtifactId, KernelSessionId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { KernelArtifactKind } from './types'

export interface KernelSessionArtifactRecord {
  createdAt: string
  fileId: FileId | null
  id: KernelSessionArtifactId
  kernelSessionId: KernelSessionId
  kind: KernelArtifactKind
  metadataJson: Record<string, unknown> | null
  mimeType: string | null
  sizeBytes: number | null
  tenantId: TenantId
}

export interface CreateKernelSessionArtifactInput {
  createdAt: string
  fileId?: FileId | null
  id: KernelSessionArtifactId
  kernelSessionId: KernelSessionId
  kind: KernelArtifactKind
  metadataJson?: Record<string, unknown> | null
  mimeType?: string | null
  sizeBytes?: number | null
}

/**
 * Persistence-neutral port for kernel session artifact storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface KernelSessionArtifactRepository {
  create: (
    scope: TenantScope,
    input: CreateKernelSessionArtifactInput,
  ) => Result<KernelSessionArtifactRecord, DomainError>
  listBySessionId: (
    scope: TenantScope,
    kernelSessionId: KernelSessionId,
  ) => Result<KernelSessionArtifactRecord[], DomainError>
}
