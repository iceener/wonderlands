import type { Context } from 'hono'

import type { AppEnv } from '../../../app/types'
import { normalizeGardenRequestPath } from '../../../application/garden/artifact-response'
import {
  createGardenService,
  type GardenSiteBuildResolution,
} from '../../../application/garden/garden-service'
import { isReservedPublicPath } from '../../../shared/http-routing'

export const toGardenService = (c: Context<AppEnv>) =>
  createGardenService({
    apiBasePath: c.get('config').api.basePath,
    createId: c.get('services').ids.create,
    db: c.get('db'),
    fileStorageRoot: c.get('config').files.storage.root,
    now: () => c.get('services').clock.nowIso(),
  })

export const buildGardenPreviewMountBasePath = (c: Context<AppEnv>, gardenSiteId: string): string =>
  `${c.get('config').api.basePath}/gardens/${gardenSiteId}/preview`

export const resolvePublicGardenRequestPath = (
  path: string,
  input?: {
    mountBasePath?: string
  },
): string | null =>
  normalizeGardenRequestPath(input?.mountBasePath ? path.slice(input.mountBasePath.length) : path)

export const resolvePublishedSiteBySlugOrDefault = (
  c: Context<AppEnv>,
  siteSlug: string,
): {
  fallbackToDefault: boolean
  resolution: GardenSiteBuildResolution
} | null => {
  const service = toGardenService(c)
  const resolution = service.resolvePublishedSiteBySlug(siteSlug)

  if (resolution.ok) {
    return {
      fallbackToDefault: false,
      resolution: resolution.value,
    }
  }

  if (isReservedPublicPath(c.get('config').api.basePath, `/${siteSlug}`)) {
    return null
  }

  const defaultResolution = service.resolvePublishedDefaultSite()

  if (!defaultResolution.ok) {
    return null
  }

  return {
    fallbackToDefault: true,
    resolution: defaultResolution.value,
  }
}
