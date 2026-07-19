import { and, asc, desc, eq, or } from 'drizzle-orm'
import { gardenBuilds } from '../../../db/schema'
import type { RepositoryDatabase } from '../../../db/repository-database'
import type { GardenBuildManifest } from '../../../domain/garden/garden-build-manifest'
import type {
  CreateGardenBuildInput,
  GardenBuildRecord,
  GardenBuildRepository,
  RecoverInterruptedGardenBuildsInput,
  UpdateGardenBuildInput,
} from '../../../domain/garden/garden-build-repository'
import type { DomainError } from '../../../shared/errors'
import {
  asAccountId,
  asGardenBuildId,
  asGardenSiteId,
  asTenantId,
  type GardenBuildId,
  type GardenSiteId,
  type TenantId,
} from '../../../shared/ids'
import { err, ok, type Result } from '../../../shared/result'
import type { TenantScope } from '../../../shared/scope'

const toGardenBuildRecord = (row: typeof gardenBuilds.$inferSelect): GardenBuildRecord => ({
  completedAt: row.completedAt,
  configFingerprintSha256: row.configFingerprintSha256,
  createdAt: row.createdAt,
  errorMessage: row.errorMessage,
  id: asGardenBuildId(row.id),
  manifestJson: (row.manifestJson as GardenBuildManifest | null) ?? null,
  protectedArtifactRoot: row.protectedArtifactRoot,
  protectedPageCount: row.protectedPageCount,
  publicArtifactRoot: row.publicArtifactRoot,
  publicPageCount: row.publicPageCount,
  requestedByAccountId: asAccountId(row.requestedByAccountId),
  siteId: asGardenSiteId(row.siteId),
  sourceFingerprintSha256: row.sourceFingerprintSha256,
  startedAt: row.startedAt,
  status: row.status,
  tenantId: asTenantId(row.tenantId),
  triggerKind: row.triggerKind,
  warningCount: row.warningCount,
})

export const createGardenBuildRepository = (db: RepositoryDatabase): GardenBuildRepository => {
  const getById = (
    scope: TenantScope,
    gardenBuildId: GardenBuildId,
  ): Result<GardenBuildRecord, DomainError> => {
    const row = db
      .select()
      .from(gardenBuilds)
      .where(and(eq(gardenBuilds.id, gardenBuildId), eq(gardenBuilds.tenantId, scope.tenantId)))
      .get()

    if (!row) {
      return err({
        message: `garden build ${gardenBuildId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toGardenBuildRecord(row))
  }

  const getByIdInTenant = (
    tenantId: TenantId,
    gardenBuildId: GardenBuildId,
  ): Result<GardenBuildRecord, DomainError> => {
    const row = db
      .select()
      .from(gardenBuilds)
      .where(and(eq(gardenBuilds.id, gardenBuildId), eq(gardenBuilds.tenantId, tenantId)))
      .get()

    if (!row) {
      return err({
        message: `garden build ${gardenBuildId} not found in tenant ${tenantId}`,
        type: 'not_found',
      })
    }

    return ok(toGardenBuildRecord(row))
  }

  const findActiveBySiteIdInTenant = (
    tenantId: TenantId,
    gardenSiteId: GardenSiteId,
  ): Result<GardenBuildRecord | null, DomainError> => {
    try {
      const row = db
        .select()
        .from(gardenBuilds)
        .where(
          and(
            eq(gardenBuilds.siteId, gardenSiteId),
            eq(gardenBuilds.tenantId, tenantId),
            or(eq(gardenBuilds.status, 'queued'), eq(gardenBuilds.status, 'running')),
          ),
        )
        .orderBy(desc(gardenBuilds.createdAt), asc(gardenBuilds.id))
        .get()

      return ok(row ? toGardenBuildRecord(row) : null)
    } catch (error) {
      return err({
        message: `failed to resolve active garden build for site ${gardenSiteId}: ${error instanceof Error ? error.message : 'Unknown garden build lookup failure'}`,
        type: 'conflict',
      })
    }
  }

  return {
    create: (
      scope: TenantScope,
      input: CreateGardenBuildInput,
    ): Result<GardenBuildRecord, DomainError> => {
      try {
        const record: GardenBuildRecord = {
          completedAt: input.completedAt ?? null,
          configFingerprintSha256: input.configFingerprintSha256 ?? null,
          createdAt: input.createdAt,
          errorMessage: input.errorMessage ?? null,
          id: input.id,
          manifestJson: input.manifestJson ?? null,
          protectedArtifactRoot: input.protectedArtifactRoot ?? null,
          protectedPageCount: input.protectedPageCount ?? 0,
          publicArtifactRoot: input.publicArtifactRoot ?? null,
          publicPageCount: input.publicPageCount ?? 0,
          requestedByAccountId: input.requestedByAccountId,
          siteId: input.siteId,
          sourceFingerprintSha256: input.sourceFingerprintSha256 ?? null,
          startedAt: input.startedAt ?? null,
          status: input.status,
          tenantId: scope.tenantId,
          triggerKind: input.triggerKind,
          warningCount: input.warningCount ?? 0,
        }

        db.insert(gardenBuilds).values(record).run()

        return ok(record)
      } catch (error) {
        return err({
          message: `failed to create garden build ${input.id}: ${error instanceof Error ? error.message : 'Unknown garden build create failure'}`,
          type: 'conflict',
        })
      }
    },
    findActiveBySiteIdInTenant,
    getById,
    getByIdInTenant,
    listBySiteId: (
      scope: TenantScope,
      gardenSiteId: GardenSiteId,
    ): Result<GardenBuildRecord[], DomainError> => {
      try {
        const rows = db
          .select()
          .from(gardenBuilds)
          .where(
            and(eq(gardenBuilds.siteId, gardenSiteId), eq(gardenBuilds.tenantId, scope.tenantId)),
          )
          .orderBy(desc(gardenBuilds.createdAt), asc(gardenBuilds.id))
          .all()

        return ok(rows.map(toGardenBuildRecord))
      } catch (error) {
        return err({
          message: `failed to list garden builds for site ${gardenSiteId}: ${error instanceof Error ? error.message : 'Unknown garden build list failure'}`,
          type: 'conflict',
        })
      }
    },
    recoverInterruptedBuilds: (
      input: RecoverInterruptedGardenBuildsInput,
    ): Result<number, DomainError> => {
      try {
        const recovered = db
          .update(gardenBuilds)
          .set({
            completedAt: input.completedAt,
            errorMessage: input.errorMessage,
            status: 'failed',
          })
          .where(or(eq(gardenBuilds.status, 'queued'), eq(gardenBuilds.status, 'running')))
          .run()

        return ok(recovered.changes)
      } catch (error) {
        return err({
          message: `failed to recover interrupted garden builds: ${error instanceof Error ? error.message : 'Unknown garden build recovery failure'}`,
          type: 'conflict',
        })
      }
    },
    update: (
      scope: TenantScope,
      gardenBuildId: GardenBuildId,
      input: UpdateGardenBuildInput,
    ): Result<GardenBuildRecord, DomainError> => {
      const current = getById(scope, gardenBuildId)

      if (!current.ok) {
        return current
      }

      try {
        const nextRecord: GardenBuildRecord = {
          ...current.value,
          ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
          ...(input.configFingerprintSha256 !== undefined
            ? { configFingerprintSha256: input.configFingerprintSha256 }
            : {}),
          ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
          ...(input.manifestJson !== undefined ? { manifestJson: input.manifestJson } : {}),
          ...(input.protectedArtifactRoot !== undefined
            ? { protectedArtifactRoot: input.protectedArtifactRoot }
            : {}),
          ...(input.protectedPageCount !== undefined
            ? { protectedPageCount: input.protectedPageCount }
            : {}),
          ...(input.publicArtifactRoot !== undefined
            ? { publicArtifactRoot: input.publicArtifactRoot }
            : {}),
          ...(input.publicPageCount !== undefined
            ? { publicPageCount: input.publicPageCount }
            : {}),
          ...(input.sourceFingerprintSha256 !== undefined
            ? { sourceFingerprintSha256: input.sourceFingerprintSha256 }
            : {}),
          ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.warningCount !== undefined ? { warningCount: input.warningCount } : {}),
        }

        db.update(gardenBuilds)
          .set({
            completedAt: nextRecord.completedAt,
            configFingerprintSha256: nextRecord.configFingerprintSha256,
            errorMessage: nextRecord.errorMessage,
            manifestJson: nextRecord.manifestJson,
            protectedArtifactRoot: nextRecord.protectedArtifactRoot,
            protectedPageCount: nextRecord.protectedPageCount,
            publicArtifactRoot: nextRecord.publicArtifactRoot,
            publicPageCount: nextRecord.publicPageCount,
            sourceFingerprintSha256: nextRecord.sourceFingerprintSha256,
            startedAt: nextRecord.startedAt,
            status: nextRecord.status,
            warningCount: nextRecord.warningCount,
          })
          .where(and(eq(gardenBuilds.id, gardenBuildId), eq(gardenBuilds.tenantId, scope.tenantId)))
          .run()

        return ok(nextRecord)
      } catch (error) {
        return err({
          message: `failed to update garden build ${gardenBuildId}: ${error instanceof Error ? error.message : 'Unknown garden build update failure'}`,
          type: 'conflict',
        })
      }
    },
  }
}
