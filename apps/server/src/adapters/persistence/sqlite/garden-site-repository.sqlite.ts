import { and, asc, desc, eq, ne } from 'drizzle-orm'
import type { RepositoryDatabase } from '../../../db/repository-database'
import { gardenSites } from '../../../db/schema'
import type {
  CreateGardenSiteInput,
  GardenSiteRecord,
  GardenSiteRepository,
  UpdateGardenSiteInput,
} from '../../../domain/garden/garden-site-repository'
import type { DomainError } from '../../../shared/errors'
import {
  asAccountId,
  asGardenBuildId,
  asGardenSiteId,
  asTenantId,
  type GardenSiteId,
} from '../../../shared/ids'
import { err, ok, type Result } from '../../../shared/result'
import type { TenantScope } from '../../../shared/scope'

const toGardenSiteRecord = (row: typeof gardenSites.$inferSelect): GardenSiteRecord => ({
  buildMode: row.buildMode,
  createdAt: row.createdAt,
  createdByAccountId: asAccountId(row.createdByAccountId),
  currentBuildId: row.currentBuildId ? asGardenBuildId(row.currentBuildId) : null,
  currentPublishedBuildId: row.currentPublishedBuildId
    ? asGardenBuildId(row.currentPublishedBuildId)
    : null,
  deployMode: row.deployMode,
  id: asGardenSiteId(row.id),
  isDefault: row.isDefault,
  name: row.name,
  protectedAccessMode: row.protectedAccessMode,
  protectedSecretRef: row.protectedSecretRef,
  protectedSessionTtlSeconds: row.protectedSessionTtlSeconds,
  slug: row.slug,
  sourceScopePath: row.sourceScopePath,
  status: row.status,
  tenantId: asTenantId(row.tenantId),
  updatedAt: row.updatedAt,
  updatedByAccountId: asAccountId(row.updatedByAccountId),
})

export const createGardenSiteRepository = (db: RepositoryDatabase): GardenSiteRepository => {
  const getById = (
    scope: TenantScope,
    gardenSiteId: GardenSiteId,
  ): Result<GardenSiteRecord, DomainError> => {
    const row = db
      .select()
      .from(gardenSites)
      .where(and(eq(gardenSites.id, gardenSiteId), eq(gardenSites.tenantId, scope.tenantId)))
      .get()

    if (!row) {
      return err({
        message: `garden site ${gardenSiteId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toGardenSiteRecord(row))
  }

  const findBySlug = (slug: string): Result<GardenSiteRecord | null, DomainError> => {
    try {
      const row = db.select().from(gardenSites).where(eq(gardenSites.slug, slug)).get()

      return ok(row ? toGardenSiteRecord(row) : null)
    } catch (error) {
      return err({
        message: `failed to resolve garden site by slug ${slug}: ${error instanceof Error ? error.message : 'Unknown garden site lookup failure'}`,
        type: 'conflict',
      })
    }
  }

  const findById = (gardenSiteId: GardenSiteId): Result<GardenSiteRecord | null, DomainError> => {
    try {
      const row = db.select().from(gardenSites).where(eq(gardenSites.id, gardenSiteId)).get()

      return ok(row ? toGardenSiteRecord(row) : null)
    } catch (error) {
      return err({
        message: `failed to resolve garden site ${gardenSiteId}: ${error instanceof Error ? error.message : 'Unknown garden site lookup failure'}`,
        type: 'conflict',
      })
    }
  }

  const findDefault = (): Result<GardenSiteRecord | null, DomainError> => {
    try {
      const row = db.select().from(gardenSites).where(eq(gardenSites.isDefault, true)).get()

      return ok(row ? toGardenSiteRecord(row) : null)
    } catch (error) {
      return err({
        message: `failed to resolve default garden site: ${error instanceof Error ? error.message : 'Unknown garden site lookup failure'}`,
        type: 'conflict',
      })
    }
  }

  return {
    create: (
      scope: TenantScope,
      input: CreateGardenSiteInput,
    ): Result<GardenSiteRecord, DomainError> => {
      try {
        const record: GardenSiteRecord = {
          buildMode: input.buildMode,
          createdAt: input.createdAt,
          createdByAccountId: input.createdByAccountId,
          currentBuildId: input.currentBuildId ?? null,
          currentPublishedBuildId: input.currentPublishedBuildId ?? null,
          deployMode: input.deployMode,
          id: input.id,
          isDefault: input.isDefault ?? false,
          name: input.name,
          protectedAccessMode: input.protectedAccessMode,
          protectedSecretRef: input.protectedSecretRef ?? null,
          protectedSessionTtlSeconds: input.protectedSessionTtlSeconds,
          slug: input.slug,
          sourceScopePath: input.sourceScopePath,
          status: input.status,
          tenantId: scope.tenantId,
          updatedAt: input.updatedAt,
          updatedByAccountId: input.updatedByAccountId,
        }

        db.insert(gardenSites).values(record).run()

        return ok(record)
      } catch (error) {
        return err({
          message: `failed to create garden site ${input.id}: ${error instanceof Error ? error.message : 'Unknown garden site create failure'}`,
          type: 'conflict',
        })
      }
    },
    findDefault,
    findById,
    findBySlug,
    clearDefault: (exceptSiteId?: GardenSiteId): Result<null, DomainError> => {
      try {
        db.update(gardenSites)
          .set({
            isDefault: false,
          })
          .where(
            exceptSiteId
              ? and(eq(gardenSites.isDefault, true), ne(gardenSites.id, exceptSiteId))
              : eq(gardenSites.isDefault, true),
          )
          .run()

        return ok(null)
      } catch (error) {
        return err({
          message: `failed to clear garden default site: ${error instanceof Error ? error.message : 'Unknown garden site update failure'}`,
          type: 'conflict',
        })
      }
    },
    getById,
    listByTenant: (scope: TenantScope): Result<GardenSiteRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(gardenSites)
          .where(eq(gardenSites.tenantId, scope.tenantId))
          .orderBy(desc(gardenSites.isDefault), asc(gardenSites.slug), asc(gardenSites.id))
          .all()

        return ok(rows.map(toGardenSiteRecord))
      } catch (error) {
        return err({
          message: `failed to list garden sites for tenant ${scope.tenantId}: ${error instanceof Error ? error.message : 'Unknown garden site list failure'}`,
          type: 'conflict',
        })
      }
    },
    listActive: (): Result<GardenSiteRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(gardenSites)
          .where(eq(gardenSites.status, 'active'))
          .orderBy(asc(gardenSites.tenantId), asc(gardenSites.slug), asc(gardenSites.id))
          .all()

        return ok(rows.map(toGardenSiteRecord))
      } catch (error) {
        return err({
          message: `failed to list active garden sites: ${error instanceof Error ? error.message : 'Unknown garden site list failure'}`,
          type: 'conflict',
        })
      }
    },
    listAutoBuildCandidates: (): Result<GardenSiteRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(gardenSites)
          .where(and(eq(gardenSites.buildMode, 'debounced_scan'), eq(gardenSites.status, 'active')))
          .orderBy(asc(gardenSites.tenantId), asc(gardenSites.slug), asc(gardenSites.id))
          .all()

        return ok(rows.map(toGardenSiteRecord))
      } catch (error) {
        return err({
          message: `failed to list automatic garden build candidates: ${error instanceof Error ? error.message : 'Unknown garden site list failure'}`,
          type: 'conflict',
        })
      }
    },
    update: (
      scope: TenantScope,
      gardenSiteId: GardenSiteId,
      input: UpdateGardenSiteInput,
    ): Result<GardenSiteRecord, DomainError> => {
      const current = getById(scope, gardenSiteId)

      if (!current.ok) {
        return current
      }

      try {
        const nextRecord: GardenSiteRecord = {
          ...current.value,
          ...(input.buildMode !== undefined ? { buildMode: input.buildMode } : {}),
          ...(input.currentBuildId !== undefined ? { currentBuildId: input.currentBuildId } : {}),
          ...(input.currentPublishedBuildId !== undefined
            ? { currentPublishedBuildId: input.currentPublishedBuildId }
            : {}),
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
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.sourceScopePath !== undefined
            ? { sourceScopePath: input.sourceScopePath }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedAt: input.updatedAt,
          updatedByAccountId: input.updatedByAccountId,
        }

        db.update(gardenSites)
          .set({
            buildMode: nextRecord.buildMode,
            currentBuildId: nextRecord.currentBuildId,
            currentPublishedBuildId: nextRecord.currentPublishedBuildId,
            deployMode: nextRecord.deployMode,
            isDefault: nextRecord.isDefault,
            name: nextRecord.name,
            protectedAccessMode: nextRecord.protectedAccessMode,
            protectedSecretRef: nextRecord.protectedSecretRef,
            protectedSessionTtlSeconds: nextRecord.protectedSessionTtlSeconds,
            slug: nextRecord.slug,
            sourceScopePath: nextRecord.sourceScopePath,
            status: nextRecord.status,
            updatedAt: nextRecord.updatedAt,
            updatedByAccountId: nextRecord.updatedByAccountId,
          })
          .where(and(eq(gardenSites.id, gardenSiteId), eq(gardenSites.tenantId, scope.tenantId)))
          .run()

        return ok(nextRecord)
      } catch (error) {
        return err({
          message: `failed to update garden site ${gardenSiteId}: ${error instanceof Error ? error.message : 'Unknown garden site update failure'}`,
          type: 'conflict',
        })
      }
    },
  }
}
