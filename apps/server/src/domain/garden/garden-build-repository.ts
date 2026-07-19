import type { DomainError } from '../../shared/errors'
import type { AccountId, GardenBuildId, GardenSiteId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { GardenBuildManifest } from './garden-build-manifest'

export type GardenBuildTriggerKind = 'auto_scan' | 'manual' | 'republish'
export type GardenBuildStatus = 'cancelled' | 'completed' | 'failed' | 'queued' | 'running'

export interface GardenBuildRecord {
  completedAt: string | null
  configFingerprintSha256: string | null
  createdAt: string
  errorMessage: string | null
  id: GardenBuildId
  manifestJson: GardenBuildManifest | null
  protectedArtifactRoot: string | null
  protectedPageCount: number
  publicArtifactRoot: string | null
  publicPageCount: number
  requestedByAccountId: AccountId
  siteId: GardenSiteId
  sourceFingerprintSha256: string | null
  startedAt: string | null
  status: GardenBuildStatus
  tenantId: TenantId
  triggerKind: GardenBuildTriggerKind
  warningCount: number
}

export interface CreateGardenBuildInput {
  completedAt?: string | null
  configFingerprintSha256?: string | null
  createdAt: string
  errorMessage?: string | null
  id: GardenBuildId
  manifestJson?: GardenBuildManifest | null
  protectedArtifactRoot?: string | null
  protectedPageCount?: number
  publicArtifactRoot?: string | null
  publicPageCount?: number
  requestedByAccountId: AccountId
  siteId: GardenSiteId
  sourceFingerprintSha256?: string | null
  startedAt?: string | null
  status: GardenBuildStatus
  triggerKind: GardenBuildTriggerKind
  warningCount?: number
}

export interface RecoverInterruptedGardenBuildsInput {
  completedAt: string
  errorMessage: string
}

export interface UpdateGardenBuildInput {
  completedAt?: string | null
  configFingerprintSha256?: string | null
  errorMessage?: string | null
  manifestJson?: GardenBuildManifest | null
  protectedArtifactRoot?: string | null
  protectedPageCount?: number
  publicArtifactRoot?: string | null
  publicPageCount?: number
  sourceFingerprintSha256?: string | null
  startedAt?: string | null
  status?: GardenBuildStatus
  warningCount?: number
}

/**
 * Persistence-neutral port for Garden build storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface GardenBuildRepository {
  create: (
    scope: TenantScope,
    input: CreateGardenBuildInput,
  ) => Result<GardenBuildRecord, DomainError>
  findActiveBySiteIdInTenant: (
    tenantId: TenantId,
    gardenSiteId: GardenSiteId,
  ) => Result<GardenBuildRecord | null, DomainError>
  getById: (
    scope: TenantScope,
    gardenBuildId: GardenBuildId,
  ) => Result<GardenBuildRecord, DomainError>
  getByIdInTenant: (
    tenantId: TenantId,
    gardenBuildId: GardenBuildId,
  ) => Result<GardenBuildRecord, DomainError>
  listBySiteId: (
    scope: TenantScope,
    gardenSiteId: GardenSiteId,
  ) => Result<GardenBuildRecord[], DomainError>
  /**
   * Atomically terminalizes builds left active by a process interruption.
   * This is a process-wide startup maintenance operation, not a scan-time operation.
   */
  recoverInterruptedBuilds: (
    input: RecoverInterruptedGardenBuildsInput,
  ) => Result<number, DomainError>
  update: (
    scope: TenantScope,
    gardenBuildId: GardenBuildId,
    input: UpdateGardenBuildInput,
  ) => Result<GardenBuildRecord, DomainError>
}
