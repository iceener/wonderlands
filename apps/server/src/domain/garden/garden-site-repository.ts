import type { DomainError } from '../../shared/errors'
import type { AccountId, GardenBuildId, GardenSiteId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export type GardenSiteStatus = 'active' | 'archived' | 'disabled' | 'draft'
export type GardenBuildMode = 'debounced_scan' | 'manual'
export type GardenDeployMode = 'api_hosted' | 'github_pages'
export type GardenProtectedAccessMode = 'none' | 'site_password'

export interface GardenSiteRecord {
  buildMode: GardenBuildMode
  createdAt: string
  createdByAccountId: AccountId
  currentBuildId: GardenBuildId | null
  currentPublishedBuildId: GardenBuildId | null
  deployMode: GardenDeployMode
  id: GardenSiteId
  isDefault: boolean
  name: string
  protectedAccessMode: GardenProtectedAccessMode
  protectedSecretRef: string | null
  protectedSessionTtlSeconds: number
  slug: string
  sourceScopePath: string
  status: GardenSiteStatus
  tenantId: TenantId
  updatedAt: string
  updatedByAccountId: AccountId
}

export interface CreateGardenSiteInput {
  buildMode: GardenBuildMode
  createdAt: string
  createdByAccountId: AccountId
  currentBuildId?: GardenBuildId | null
  currentPublishedBuildId?: GardenBuildId | null
  deployMode: GardenDeployMode
  id: GardenSiteId
  isDefault?: boolean
  name: string
  protectedAccessMode: GardenProtectedAccessMode
  protectedSecretRef?: string | null
  protectedSessionTtlSeconds: number
  slug: string
  sourceScopePath: string
  status: GardenSiteStatus
  updatedAt: string
  updatedByAccountId: AccountId
}

export interface UpdateGardenSiteInput {
  buildMode?: GardenBuildMode
  currentBuildId?: GardenBuildId | null
  currentPublishedBuildId?: GardenBuildId | null
  deployMode?: GardenDeployMode
  isDefault?: boolean
  name?: string
  protectedAccessMode?: GardenProtectedAccessMode
  protectedSecretRef?: string | null
  protectedSessionTtlSeconds?: number
  slug?: string
  sourceScopePath?: string
  status?: GardenSiteStatus
  updatedAt: string
  updatedByAccountId: AccountId
}

/**
 * Persistence-neutral port for Garden site storage. Concrete implementations
 * (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface GardenSiteRepository {
  clearDefault: (exceptSiteId?: GardenSiteId) => Result<null, DomainError>
  create: (
    scope: TenantScope,
    input: CreateGardenSiteInput,
  ) => Result<GardenSiteRecord, DomainError>
  findById: (gardenSiteId: GardenSiteId) => Result<GardenSiteRecord | null, DomainError>
  findBySlug: (slug: string) => Result<GardenSiteRecord | null, DomainError>
  findDefault: () => Result<GardenSiteRecord | null, DomainError>
  getById: (scope: TenantScope, gardenSiteId: GardenSiteId) => Result<GardenSiteRecord, DomainError>
  /**
   * Lists every Garden site with `status: 'active'` across all tenants.
   * Used by out-of-band maintenance tooling (e.g. the active-Garden rebuild
   * script) that operates outside a single tenant scope.
   */
  listActive: () => Result<GardenSiteRecord[], DomainError>
  listAutoBuildCandidates: () => Result<GardenSiteRecord[], DomainError>
  listByTenant: (scope: TenantScope) => Result<GardenSiteRecord[], DomainError>
  update: (
    scope: TenantScope,
    gardenSiteId: GardenSiteId,
    input: UpdateGardenSiteInput,
  ) => Result<GardenSiteRecord, DomainError>
}
