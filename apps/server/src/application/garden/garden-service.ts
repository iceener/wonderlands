import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  createGardenBuildRepository,
  createGardenSiteRepository,
} from '../../adapters/persistence/sqlite'
import { createTenantMembershipRepository } from '../../adapters/persistence/sqlite/tenancy/tenant-membership-repository'
import type { AppDatabase } from '../../db/client'
import { withTransaction } from '../../db/transaction'
import type { RepositoryDatabase } from '../../domain/database-port'
import type { GardenBuildRecord } from '../../domain/garden/garden-build-repository'
import type { GardenSiteRecord } from '../../domain/garden/garden-site-repository'
import type { DomainError } from '../../shared/errors'
import { getReservedPublicSegments } from '../../shared/http-routing'
import {
  type AccountId,
  asGardenBuildId,
  asGardenSiteId,
  type GardenBuildId,
  type GardenSiteId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { createWorkspaceService } from '../workspaces/workspace-service'
import { bootstrapGardenSource, type GardenSourceBootstrapResult } from './bootstrap-source'
import { compileGardenBuildOutput } from './compiler/build-site'
import {
  normalizeGardenRelativePath,
  resolveGardenSourceScope,
} from './compiler/resolve-source-path'
import type {
  CreateGardenSiteInput,
  RequestGardenBuildInput,
  UpdateGardenSiteInput,
} from './garden-inputs'
import { ensureGardenSourceMetaFiles } from './meta-files'

export type {
  CreateGardenSiteInput,
  RequestGardenBuildInput,
  UpdateGardenSiteInput,
} from './garden-inputs'
export {
  parseCreateGardenSiteInput,
  parseRequestGardenBuildInput,
  parseUpdateGardenSiteInput,
} from './garden-inputs'

const gardenAdminRoles = new Set<TenantScope['role']>(['admin', 'owner'])

export interface GardenServiceDependencies {
  apiBasePath: string
  createId: <TPrefix extends string>(prefix: TPrefix) => `${TPrefix}_${string}`
  db: AppDatabase
  fileStorageRoot: string
  now: () => string
}

export interface GardenSiteBuildResolution {
  build: GardenBuildRecord
  site: GardenSiteRecord
}

export interface GardenService {
  createSite: (
    scope: TenantScope,
    input: CreateGardenSiteInput,
  ) => Result<GardenSiteRecord, DomainError>
  bootstrapSource: (
    scope: TenantScope,
    gardenSiteId: GardenSiteId,
  ) => Promise<Result<GardenSourceBootstrapResult, DomainError>>
  getBuildById: (
    scope: TenantScope,
    gardenSiteId: GardenSiteId,
    gardenBuildId: GardenBuildId,
  ) => Result<GardenBuildRecord, DomainError>
  getPreviewBuild: (
    scope: TenantScope,
    gardenSiteId: GardenSiteId,
  ) => Result<GardenSiteBuildResolution, DomainError>
  getPreviewBuildForAccount: (
    accountId: AccountId,
    gardenSiteId: GardenSiteId,
  ) => Result<GardenSiteBuildResolution, DomainError>
  getSiteById: (
    scope: TenantScope,
    gardenSiteId: GardenSiteId,
  ) => Result<GardenSiteRecord, DomainError>
  listBuilds: (
    scope: TenantScope,
    gardenSiteId: GardenSiteId,
  ) => Result<GardenBuildRecord[], DomainError>
  listSites: (scope: TenantScope) => Result<GardenSiteRecord[], DomainError>
  publishCurrentBuild: (
    gardenSiteId: GardenSiteId,
    requestedByAccountId: AccountId,
  ) => Result<GardenSiteRecord, DomainError>
  publishSite: (
    scope: TenantScope,
    gardenSiteId: GardenSiteId,
  ) => Result<GardenSiteRecord, DomainError>
  requestAutoBuild: (gardenSiteId: GardenSiteId) => Promise<Result<GardenBuildRecord, DomainError>>
  requestBuild: (
    scope: TenantScope,
    gardenSiteId: GardenSiteId,
    input: RequestGardenBuildInput,
  ) => Promise<Result<GardenBuildRecord, DomainError>>
  resolvePublishedDefaultSite: () => Result<GardenSiteBuildResolution, DomainError>
  resolvePublishedSiteBySlug: (siteSlug: string) => Result<GardenSiteBuildResolution, DomainError>
  updateSite: (
    scope: TenantScope,
    gardenSiteId: GardenSiteId,
    input: UpdateGardenSiteInput,
  ) => Result<GardenSiteRecord, DomainError>
}

const requireGardenAdminScope = (
  db: RepositoryDatabase,
  scope: TenantScope,
): Result<null, DomainError> => {
  const membership = createTenantMembershipRepository(db).requireMembership(scope)

  if (!membership.ok) {
    return membership
  }

  if (!gardenAdminRoles.has(scope.role)) {
    return err({
      message: `tenant role ${scope.role} cannot manage garden sites`,
      type: 'permission',
    })
  }

  return ok(null)
}

const normalizeSourceScopePath = (value: string | undefined): Result<string, DomainError> =>
  normalizeGardenRelativePath(value ?? '.', 'sourceScopePath')

const validateGardenSlug = (apiBasePath: string, slug: string): Result<string, DomainError> => {
  const normalizedSlug = slug.trim()

  if (getReservedPublicSegments(apiBasePath, { includeGardenAssets: true }).has(normalizedSlug)) {
    return err({
      message: `slug ${normalizedSlug} is reserved for platform routing`,
      type: 'validation',
    })
  }

  return ok(normalizedSlug)
}

const toArtifactBuildRoot = (
  fileStorageRoot: string,
  siteId: GardenSiteId,
  buildId: GardenBuildId,
): string => resolve(fileStorageRoot, '..', 'garden-sites', siteId, 'builds', buildId)

const hashFileIfPresent = async (fileRef: string): Promise<string | null> => {
  try {
    return createHash('sha256')
      .update(await readFile(fileRef))
      .digest('hex')
  } catch {
    return null
  }
}

export const createGardenService = (dependencies: GardenServiceDependencies): GardenService => {
  const { apiBasePath, createId, db, fileStorageRoot, now } = dependencies
  const siteRepository = createGardenSiteRepository(db)
  const buildRepository = createGardenBuildRepository(db)
  const workspaceService = createWorkspaceService(db, {
    createId,
    fileStorageRoot,
  })
  const withSiteTransaction = <TValue>(
    execute: (txDb: RepositoryDatabase) => Result<TValue, DomainError>,
  ): Result<TValue, DomainError> => withTransaction(db, (tx) => execute(tx))

  const resolveBuildForSite = (
    site: GardenSiteRecord,
    gardenBuildId: GardenBuildId,
  ): Result<GardenBuildRecord, DomainError> => {
    const build = buildRepository.getByIdInTenant(site.tenantId, gardenBuildId)

    if (!build.ok) {
      return build
    }

    if (build.value.siteId !== site.id) {
      return err({
        message: `garden build ${gardenBuildId} does not belong to site ${site.id}`,
        type: 'not_found',
      })
    }

    return build
  }

  const requireCompletedBuildArtifacts = (
    build: GardenBuildRecord,
  ): Result<GardenBuildRecord, DomainError> => {
    if (build.status !== 'completed') {
      return err({
        message: `garden build ${build.id} is not completed`,
        type: 'conflict',
      })
    }

    if (!build.manifestJson) {
      return err({
        message: `garden build ${build.id} is missing a manifest`,
        type: 'conflict',
      })
    }

    if (!build.publicArtifactRoot) {
      return err({
        message: `garden build ${build.id} is missing public artifacts`,
        type: 'conflict',
      })
    }

    if (build.protectedPageCount > 0 && !build.protectedArtifactRoot) {
      return err({
        message: `garden build ${build.id} is missing protected artifacts`,
        type: 'conflict',
      })
    }

    return ok(build)
  }

  const resolvePreviewScopeForAccount = (
    accountId: AccountId,
    gardenSiteId: GardenSiteId,
  ): Result<TenantScope, DomainError> => {
    const site = siteRepository.findById(gardenSiteId)

    if (!site.ok) {
      return site
    }

    if (!site.value) {
      return err({
        message: `garden site ${gardenSiteId} was not found`,
        type: 'not_found',
      })
    }

    const membership = createTenantMembershipRepository(db).findMembership(
      accountId,
      site.value.tenantId,
    )

    if (!membership.ok) {
      return membership
    }

    if (!membership.value) {
      return err({
        message: `garden site ${gardenSiteId} is not accessible for account ${accountId}`,
        type: 'permission',
      })
    }

    return ok({
      accountId,
      role: membership.value.role,
      tenantId: membership.value.tenantId,
    })
  }

  const getPreviewBuildForScope = (
    scope: TenantScope,
    gardenSiteId: GardenSiteId,
  ): Result<GardenSiteBuildResolution, DomainError> => {
    const allowed = requireGardenAdminScope(db, scope)

    if (!allowed.ok) {
      return allowed
    }

    const site = siteRepository.getById(scope, gardenSiteId)

    if (!site.ok) {
      return site
    }

    if (!site.value.currentBuildId) {
      return err({
        message: `garden site ${gardenSiteId} does not have a current build`,
        type: 'not_found',
      })
    }

    const build = resolveBuildForSite(site.value, site.value.currentBuildId)

    if (!build.ok) {
      return build
    }

    const completedBuild = requireCompletedBuildArtifacts(build.value)

    if (!completedBuild.ok) {
      return completedBuild
    }

    return ok({
      build: completedBuild.value,
      site: site.value,
    })
  }

  const resolvePublishedSite = (
    site: GardenSiteRecord | null,
    label: string,
  ): Result<GardenSiteBuildResolution, DomainError> => {
    if (!site || site.status !== 'active' || !site.currentPublishedBuildId) {
      return err({
        message: `${label} was not found`,
        type: 'not_found',
      })
    }

    const build = resolveBuildForSite(site, site.currentPublishedBuildId)

    if (!build.ok) {
      return build
    }

    const completedBuild = requireCompletedBuildArtifacts(build.value)

    if (!completedBuild.ok) {
      return completedBuild
    }

    return ok({
      build: completedBuild.value,
      site,
    })
  }

  const toSiteScope = (site: GardenSiteRecord, accountId: AccountId): TenantScope => ({
    accountId,
    role: 'owner',
    tenantId: site.tenantId,
  })

  const publishResolvedSite = (
    site: GardenSiteRecord,
    requestedByAccountId: AccountId,
  ): Result<GardenSiteRecord, DomainError> => {
    if (site.status !== 'active') {
      return err({
        message: `garden site ${site.id} must be active before publishing`,
        type: 'conflict',
      })
    }

    if (!site.currentBuildId) {
      return err({
        message: `garden site ${site.id} does not have a current build to publish`,
        type: 'not_found',
      })
    }

    const build = resolveBuildForSite(site, site.currentBuildId)

    if (!build.ok) {
      return build
    }

    const completedBuild = requireCompletedBuildArtifacts(build.value)

    if (!completedBuild.ok) {
      return completedBuild
    }

    if (
      completedBuild.value.protectedPageCount > 0 &&
      (site.protectedAccessMode !== 'site_password' || !site.protectedSecretRef)
    ) {
      return err({
        message: `garden site ${site.id} requires site password protection before publishing protected pages`,
        type: 'conflict',
      })
    }

    return siteRepository.update(toSiteScope(site, requestedByAccountId), site.id, {
      currentPublishedBuildId: completedBuild.value.id,
      updatedAt: now(),
      updatedByAccountId: requestedByAccountId,
    })
  }

  const executeBuild = async (input: {
    requestedByAccountId: AccountId
    site: GardenSiteRecord
    triggerKind: GardenBuildRecord['triggerKind']
  }): Promise<Result<GardenBuildRecord, DomainError>> => {
    if (input.site.status === 'archived') {
      return err({
        message: `garden site ${input.site.id} is archived and cannot be built`,
        type: 'conflict',
      })
    }

    const activeBuild = buildRepository.findActiveBySiteIdInTenant(
      input.site.tenantId,
      input.site.id,
    )

    if (!activeBuild.ok) {
      return activeBuild
    }

    if (activeBuild.value) {
      return err({
        message: `garden site ${input.site.id} already has an active build`,
        type: 'conflict',
      })
    }

    const scope = toSiteScope(input.site, input.requestedByAccountId)
    const createdAt = now()
    const buildId = asGardenBuildId(createId('gbd'))
    const build = buildRepository.create(scope, {
      createdAt,
      id: buildId,
      requestedByAccountId: input.requestedByAccountId,
      siteId: input.site.id,
      status: 'queued',
      triggerKind: input.triggerKind,
    })

    if (!build.ok) {
      return build
    }

    const running = buildRepository.update(scope, buildId, {
      startedAt: createdAt,
      status: 'running',
    })

    if (!running.ok) {
      return running
    }

    const workspace = workspaceService.ensureAccountWorkspace(scope, {
      accountId: input.site.createdByAccountId,
      nowIso: createdAt,
    })

    if (!workspace.ok) {
      return buildRepository.update(scope, buildId, {
        completedAt: now(),
        errorMessage: workspace.error.message,
        status: 'failed',
      })
    }

    const vaultRootRef = workspaceService.ensureVaultRef(workspace.value)
    const resolvedSourceScope = await resolveGardenSourceScope({
      sourceScopePath: input.site.sourceScopePath,
      vaultRootRef,
    })

    if (!resolvedSourceScope.ok) {
      return buildRepository.update(scope, buildId, {
        completedAt: now(),
        errorMessage: resolvedSourceScope.error.message,
        status: 'failed',
      })
    }

    try {
      await ensureGardenSourceMetaFiles(resolvedSourceScope.value.sourceScopeRef)
    } catch {
      // The helper reference is best-effort and should not block builds.
    }

    const compiledOutput = await compileGardenBuildOutput({
      outputRootRef: toArtifactBuildRoot(fileStorageRoot, input.site.id, buildId),
      sourceScopePath: input.site.sourceScopePath,
      vaultRootRef,
    })

    if (!compiledOutput.ok) {
      const failedBuild = buildRepository.update(scope, buildId, {
        completedAt: now(),
        errorMessage: compiledOutput.error.message,
        status: 'failed',
      })

      return failedBuild.ok ? failedBuild : build
    }

    const completedAt = now()
    const configFingerprintSha256 = await hashFileIfPresent(compiledOutput.value.source.configRef)
    const manifestJson = compiledOutput.value.manifest
    const completedBuild = buildRepository.update(scope, buildId, {
      completedAt,
      configFingerprintSha256,
      errorMessage: null,
      manifestJson,
      protectedArtifactRoot: compiledOutput.value.protectedRootRef,
      protectedPageCount: manifestJson.protectedPageCount,
      publicArtifactRoot: compiledOutput.value.publicRootRef,
      publicPageCount: manifestJson.publicPageCount,
      sourceFingerprintSha256: manifestJson.sourceFingerprintSha256,
      status: 'completed',
      warningCount: manifestJson.warnings.length,
    })

    if (!completedBuild.ok) {
      return completedBuild
    }

    const updatedSite = siteRepository.update(scope, input.site.id, {
      currentBuildId: completedBuild.value.id,
      updatedAt: completedAt,
      updatedByAccountId: input.requestedByAccountId,
    })

    if (!updatedSite.ok) {
      return updatedSite
    }

    return completedBuild
  }

  return {
    bootstrapSource: async (scope: TenantScope, gardenSiteId: GardenSiteId) => {
      const allowed = requireGardenAdminScope(db, scope)

      if (!allowed.ok) {
        return allowed
      }

      const site = siteRepository.getById(scope, gardenSiteId)

      if (!site.ok) {
        return site
      }

      const workspace = workspaceService.ensureAccountWorkspace(scope, {
        accountId: site.value.createdByAccountId,
        nowIso: now(),
      })

      if (!workspace.ok) {
        return workspace
      }

      const vaultRootRef = workspaceService.ensureVaultRef(workspace.value)
      const normalizedSourceScopePath = normalizeSourceScopePath(site.value.sourceScopePath)

      if (!normalizedSourceScopePath.ok) {
        return normalizedSourceScopePath
      }

      try {
        const sourceScopeCandidateRef = resolve(
          vaultRootRef,
          normalizedSourceScopePath.value === '.' ? '' : normalizedSourceScopePath.value,
        )
        await mkdir(sourceScopeCandidateRef, { recursive: true })
        const resolvedSourceScope = await resolveGardenSourceScope({
          sourceScopePath: normalizedSourceScopePath.value,
          vaultRootRef,
        })

        if (!resolvedSourceScope.ok) {
          return resolvedSourceScope
        }

        return ok(
          await bootstrapGardenSource({
            site: site.value,
            sourceScopePath: normalizedSourceScopePath.value,
            sourceScopeRef: resolvedSourceScope.value.sourceScopeRef,
          }),
        )
      } catch (error) {
        return err({
          message: `failed to bootstrap garden source ${gardenSiteId}: ${error instanceof Error ? error.message : 'Unknown garden source bootstrap failure'}`,
          type: 'conflict',
        })
      }
    },
    createSite: (scope: TenantScope, input: CreateGardenSiteInput) => {
      const allowed = requireGardenAdminScope(db, scope)

      if (!allowed.ok) {
        return allowed
      }

      const sourceScopePath = normalizeSourceScopePath(input.sourceScopePath)

      if (!sourceScopePath.ok) {
        return sourceScopePath
      }

      const validatedSlug = validateGardenSlug(apiBasePath, input.slug)

      if (!validatedSlug.ok) {
        return validatedSlug
      }

      const protectedAccessMode = input.protectedAccessMode ?? 'none'
      const protectedSecretRef = input.protectedSecretRef ?? null

      if (protectedAccessMode === 'site_password' && !protectedSecretRef) {
        return err({
          message: 'protectedSecretRef is required when protectedAccessMode=site_password',
          type: 'validation',
        })
      }

      const timestamp = now()
      const createInput = {
        buildMode: input.buildMode ?? 'manual',
        createdAt: timestamp,
        createdByAccountId: scope.accountId,
        deployMode: input.deployMode ?? 'api_hosted',
        id: asGardenSiteId(createId('gst')),
        isDefault: input.isDefault ?? false,
        name: input.name,
        protectedAccessMode,
        protectedSecretRef,
        protectedSessionTtlSeconds: input.protectedSessionTtlSeconds ?? 86_400,
        slug: validatedSlug.value,
        sourceScopePath: sourceScopePath.value,
        status: input.status ?? 'draft',
        updatedAt: timestamp,
        updatedByAccountId: scope.accountId,
      }

      if (!createInput.isDefault) {
        return siteRepository.create(scope, createInput)
      }

      return withSiteTransaction((txDb) => {
        const txSiteRepository = createGardenSiteRepository(txDb)
        const cleared = txSiteRepository.clearDefault()

        if (!cleared.ok) {
          return cleared
        }

        return txSiteRepository.create(scope, createInput)
      })
    },
    getBuildById: (
      scope: TenantScope,
      gardenSiteId: GardenSiteId,
      gardenBuildId: GardenBuildId,
    ) => {
      const allowed = requireGardenAdminScope(db, scope)

      if (!allowed.ok) {
        return allowed
      }

      const site = siteRepository.getById(scope, gardenSiteId)

      if (!site.ok) {
        return site
      }

      const build = buildRepository.getById(scope, gardenBuildId)

      if (!build.ok) {
        return build
      }

      if (build.value.siteId !== site.value.id) {
        return err({
          message: `garden build ${gardenBuildId} does not belong to site ${gardenSiteId}`,
          type: 'not_found',
        })
      }

      return build
    },
    getPreviewBuild: (scope: TenantScope, gardenSiteId: GardenSiteId) =>
      getPreviewBuildForScope(scope, gardenSiteId),
    getPreviewBuildForAccount: (accountId: AccountId, gardenSiteId: GardenSiteId) => {
      const scope = resolvePreviewScopeForAccount(accountId, gardenSiteId)

      if (!scope.ok) {
        return scope
      }

      return getPreviewBuildForScope(scope.value, gardenSiteId)
    },
    getSiteById: (scope: TenantScope, gardenSiteId: GardenSiteId) => {
      const allowed = requireGardenAdminScope(db, scope)

      if (!allowed.ok) {
        return allowed
      }

      return siteRepository.getById(scope, gardenSiteId)
    },
    listBuilds: (scope: TenantScope, gardenSiteId: GardenSiteId) => {
      const allowed = requireGardenAdminScope(db, scope)

      if (!allowed.ok) {
        return allowed
      }

      const site = siteRepository.getById(scope, gardenSiteId)

      if (!site.ok) {
        return site
      }

      return buildRepository.listBySiteId(scope, site.value.id)
    },
    listSites: (scope: TenantScope) => {
      const allowed = requireGardenAdminScope(db, scope)

      if (!allowed.ok) {
        return allowed
      }

      return siteRepository.listByTenant(scope)
    },
    publishCurrentBuild: (gardenSiteId: GardenSiteId, requestedByAccountId: AccountId) => {
      const site = siteRepository.findById(gardenSiteId)

      if (!site.ok) {
        return site
      }

      if (!site.value) {
        return err({
          message: `garden site ${gardenSiteId} was not found`,
          type: 'not_found',
        })
      }

      return publishResolvedSite(site.value, requestedByAccountId)
    },
    publishSite: (scope: TenantScope, gardenSiteId: GardenSiteId) => {
      const allowed = requireGardenAdminScope(db, scope)

      if (!allowed.ok) {
        return allowed
      }

      const site = siteRepository.getById(scope, gardenSiteId)

      if (!site.ok) {
        return site
      }

      return publishResolvedSite(site.value, scope.accountId)
    },
    requestAutoBuild: async (
      gardenSiteId: GardenSiteId,
    ): Promise<Result<GardenBuildRecord, DomainError>> => {
      const site = siteRepository.findById(gardenSiteId)

      if (!site.ok) {
        return site
      }

      if (!site.value) {
        return err({
          message: `garden site ${gardenSiteId} was not found`,
          type: 'not_found',
        })
      }

      return executeBuild({
        requestedByAccountId: site.value.updatedByAccountId,
        site: site.value,
        triggerKind: 'auto_scan',
      })
    },
    requestBuild: async (
      scope: TenantScope,
      gardenSiteId: GardenSiteId,
      input: RequestGardenBuildInput,
    ): Promise<Result<GardenBuildRecord, DomainError>> => {
      const allowed = requireGardenAdminScope(db, scope)

      if (!allowed.ok) {
        return allowed
      }

      const site = siteRepository.getById(scope, gardenSiteId)

      if (!site.ok) {
        return site
      }

      return executeBuild({
        requestedByAccountId: scope.accountId,
        site: site.value,
        triggerKind: input.triggerKind ?? 'manual',
      })
    },
    resolvePublishedDefaultSite: () => {
      const site = siteRepository.findDefault()

      if (!site.ok) {
        return site
      }

      return resolvePublishedSite(site.value, 'published default garden site')
    },
    resolvePublishedSiteBySlug: (siteSlug: string) => {
      const site = siteRepository.findBySlug(siteSlug)

      if (!site.ok) {
        return site
      }

      if (site.value?.isDefault) {
        return err({
          message: `published garden site ${siteSlug} was not found`,
          type: 'not_found',
        })
      }

      return resolvePublishedSite(site.value, `published garden site ${siteSlug}`)
    },
    updateSite: (scope: TenantScope, gardenSiteId: GardenSiteId, input: UpdateGardenSiteInput) => {
      const allowed = requireGardenAdminScope(db, scope)

      if (!allowed.ok) {
        return allowed
      }

      const current = siteRepository.getById(scope, gardenSiteId)

      if (!current.ok) {
        return current
      }

      const nextSourceScopePath =
        input.sourceScopePath !== undefined
          ? normalizeSourceScopePath(input.sourceScopePath)
          : ok(current.value.sourceScopePath)

      if (!nextSourceScopePath.ok) {
        return nextSourceScopePath
      }

      const nextSlug =
        input.slug !== undefined
          ? validateGardenSlug(apiBasePath, input.slug)
          : ok(current.value.slug)

      if (!nextSlug.ok) {
        return nextSlug
      }

      const nextProtectedAccessMode = input.protectedAccessMode ?? current.value.protectedAccessMode
      const nextProtectedSecretRef =
        input.protectedSecretRef !== undefined
          ? input.protectedSecretRef
          : current.value.protectedSecretRef

      if (nextProtectedAccessMode === 'site_password' && !nextProtectedSecretRef) {
        return err({
          message: 'protectedSecretRef is required when protectedAccessMode=site_password',
          type: 'validation',
        })
      }

      const updateInput = {
        ...(input.buildMode !== undefined ? { buildMode: input.buildMode } : {}),
        ...(input.deployMode !== undefined ? { deployMode: input.deployMode } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.protectedAccessMode !== undefined
          ? { protectedAccessMode: input.protectedAccessMode }
          : {}),
        ...(input.protectedSecretRef !== undefined
          ? { protectedSecretRef: input.protectedSecretRef }
          : {}),
        ...(input.protectedSessionTtlSeconds !== undefined
          ? { protectedSessionTtlSeconds: input.protectedSessionTtlSeconds }
          : {}),
        ...(input.slug !== undefined ? { slug: nextSlug.value } : {}),
        ...(input.sourceScopePath !== undefined
          ? { sourceScopePath: nextSourceScopePath.value }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: now(),
        updatedByAccountId: scope.accountId,
      }

      if (input.isDefault === true && !current.value.isDefault) {
        return withSiteTransaction((txDb) => {
          const txSiteRepository = createGardenSiteRepository(txDb)
          const cleared = txSiteRepository.clearDefault(gardenSiteId)

          if (!cleared.ok) {
            return cleared
          }

          return txSiteRepository.update(scope, gardenSiteId, updateInput)
        })
      }

      return siteRepository.update(scope, gardenSiteId, updateInput)
    },
  }
}
