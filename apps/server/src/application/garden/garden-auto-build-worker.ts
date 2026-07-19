import {
  createGardenBuildRepository,
  createGardenSiteRepository,
} from '../../adapters/persistence/sqlite'
import type { AppConfig } from '../../app/config'
import type { AppServices } from '../../app/runtime'
import type { AppDatabase } from '../../db/client'
import type { GardenSiteRecord } from '../../domain/garden/garden-site-repository'
import type { GardenSiteId } from '../../shared/ids'
import type { TenantScope } from '../../shared/scope'
import { createPollingWorker } from '../polling-worker'
import { createWorkspaceService } from '../workspaces/workspace-service'
import { computeGardenSourceFingerprint } from './compiler/build-site'
import { createGardenService } from './garden-service'

export interface GardenAutoBuildWorker {
  processEligibleSites: () => Promise<number>
  start: () => void
  stop: () => Promise<void>
}

interface DebounceEntry {
  dueAtMs: number
  fingerprintSha256: string
}

export const createGardenAutoBuildWorker = (input: {
  config: AppConfig
  db: AppDatabase
  services: AppServices
}): GardenAutoBuildWorker => {
  const logger = input.services.logger.child({
    subsystem: 'garden_auto_build_worker',
  })
  const siteRepository = createGardenSiteRepository(input.db)
  const buildRepository = createGardenBuildRepository(input.db)
  const workspaceService = createWorkspaceService(input.db, {
    createId: input.services.ids.create,
    fileStorageRoot: input.config.files.storage.root,
  })
  const gardenService = createGardenService({
    apiBasePath: input.config.api.basePath,
    createId: input.services.ids.create,
    db: input.db,
    fileStorageRoot: input.config.files.storage.root,
    now: () => input.services.clock.nowIso(),
  })
  const debounceState = new Map<GardenSiteId, DebounceEntry>()

  const nowMs = (): number => {
    const value = Date.parse(input.services.clock.nowIso())
    return Number.isNaN(value) ? Date.now() : value
  }

  const toSiteScope = (site: GardenSiteRecord): TenantScope => ({
    accountId: site.updatedByAccountId,
    role: 'owner',
    tenantId: site.tenantId,
  })

  const resolveCompletedFingerprint = (site: GardenSiteRecord): string | null => {
    if (!site.currentBuildId) {
      return null
    }

    const currentBuild = buildRepository.getByIdInTenant(site.tenantId, site.currentBuildId)

    if (!currentBuild.ok || currentBuild.value.status !== 'completed') {
      return null
    }

    return currentBuild.value.sourceFingerprintSha256
  }

  const resolveSourceFingerprint = async (site: GardenSiteRecord): Promise<string | null> => {
    const scope = toSiteScope(site)
    const workspace = workspaceService.ensureAccountWorkspace(scope, {
      accountId: site.createdByAccountId,
      nowIso: input.services.clock.nowIso(),
    })

    if (!workspace.ok) {
      logger.warn('Skipped Garden auto-build scan because workspace resolution failed', {
        error: workspace.error.message,
        gardenSiteId: site.id,
        tenantId: site.tenantId,
      })
      return null
    }

    const fingerprint = await computeGardenSourceFingerprint({
      sourceScopePath: site.sourceScopePath,
      vaultRootRef: workspaceService.ensureVaultRef(workspace.value),
    })

    if (!fingerprint.ok) {
      logger.warn('Skipped Garden auto-build scan because source inspection failed', {
        error: fingerprint.error.message,
        gardenSiteId: site.id,
        sourceScopePath: site.sourceScopePath,
        tenantId: site.tenantId,
      })
      return null
    }

    return fingerprint.value
  }

  const processSite = async (site: GardenSiteRecord): Promise<boolean> => {
    const sourceFingerprintSha256 = await resolveSourceFingerprint(site)

    if (!sourceFingerprintSha256) {
      debounceState.delete(site.id)
      return false
    }

    const completedFingerprintSha256 = resolveCompletedFingerprint(site)

    if (completedFingerprintSha256 === sourceFingerprintSha256) {
      debounceState.delete(site.id)
      return false
    }

    const currentTimeMs = nowMs()
    const existingDebounce = debounceState.get(site.id)

    if (!existingDebounce || existingDebounce.fingerprintSha256 !== sourceFingerprintSha256) {
      debounceState.set(site.id, {
        dueAtMs: currentTimeMs + input.config.garden.worker.debounceWindowMs,
        fingerprintSha256: sourceFingerprintSha256,
      })
      return false
    }

    if (existingDebounce.dueAtMs > currentTimeMs) {
      return false
    }

    const activeBuild = buildRepository.findActiveBySiteIdInTenant(site.tenantId, site.id)

    if (!activeBuild.ok) {
      logger.warn('Skipped Garden auto-build trigger because active-build lookup failed', {
        error: activeBuild.error.message,
        gardenSiteId: site.id,
        tenantId: site.tenantId,
      })
      return false
    }

    if (activeBuild.value) {
      return false
    }

    const requestedBuild = await gardenService.requestAutoBuild(site.id)

    if (!requestedBuild.ok) {
      logger.warn('Automatic Garden build request failed', {
        error: requestedBuild.error.message,
        gardenSiteId: site.id,
        tenantId: site.tenantId,
      })
      return false
    }

    let autoPublished = false

    if (requestedBuild.value.status === 'completed') {
      const publishedSite = gardenService.publishCurrentBuild(
        site.id,
        requestedBuild.value.requestedByAccountId,
      )

      if (!publishedSite.ok) {
        logger.warn('Automatic Garden publish failed', {
          buildId: requestedBuild.value.id,
          error: publishedSite.error.message,
          gardenSiteId: site.id,
          tenantId: site.tenantId,
        })
      } else {
        autoPublished = publishedSite.value.currentPublishedBuildId === requestedBuild.value.id
      }
    }

    debounceState.delete(site.id)

    logger.info('Automatic Garden build finished', {
      autoPublished,
      buildId: requestedBuild.value.id,
      gardenSiteId: site.id,
      status: requestedBuild.value.status,
      tenantId: site.tenantId,
      triggerKind: requestedBuild.value.triggerKind,
    })

    return true
  }

  const processEligibleSites = async (): Promise<number> => {
    const candidates = siteRepository.listAutoBuildCandidates()

    if (!candidates.ok) {
      throw new Error(candidates.error.message)
    }

    const candidateIds = new Set(candidates.value.map((site) => site.id))

    for (const siteId of [...debounceState.keys()]) {
      if (!candidateIds.has(siteId)) {
        debounceState.delete(siteId)
      }
    }

    let triggeredCount = 0

    for (const site of candidates.value) {
      try {
        if (await processSite(site)) {
          triggeredCount += 1
        }
      } catch (error) {
        logger.error('Unhandled Garden auto-build site failure', {
          gardenSiteId: site.id,
          message: error instanceof Error ? error.message : 'Unknown Garden auto-build failure',
          tenantId: site.tenantId,
        })
      }
    }

    return triggeredCount
  }

  const lifecycle = createPollingWorker<number>({
    computeNextDelay: ({ result }) =>
      result && result > 0 ? 0 : input.config.garden.worker.pollIntervalMs,
    onError: (error) => {
      logger.error('Unhandled Garden auto-build worker failure', {
        message: error instanceof Error ? error.message : 'Unknown Garden auto-build failure',
      })
    },
    runOnce: processEligibleSites,
  })

  return {
    processEligibleSites,
    start: lifecycle.start,
    stop: lifecycle.stop,
  }
}
