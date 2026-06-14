const rootReservedApiBasePathPrefixes = ['/status', '/_auth'] as const
const alwaysReservedPublicSegments = ['_auth', 'ai', 'api', 'status', 'v1'] as const
const gardenAssetPublicSegments = ['_pagefind'] as const

const toFirstPathSegment = (path: string): string | null => {
  const firstSegment = path.replace(/^\/+/, '').split('/')[0]?.trim()
  return firstSegment ? firstSegment : null
}

export const getRootReservedApiBasePathPrefixes = (): readonly string[] =>
  rootReservedApiBasePathPrefixes

export const isRootReservedApiBasePath = (basePath: string): boolean =>
  rootReservedApiBasePathPrefixes.some(
    (prefix) => basePath === prefix || basePath.startsWith(`${prefix}/`),
  )

export const getReservedPublicSegments = (
  apiBasePath: string,
  options?: {
    includeGardenAssets?: boolean
  },
): Set<string> => {
  const reserved = new Set<string>(alwaysReservedPublicSegments)

  if (options?.includeGardenAssets) {
    for (const segment of gardenAssetPublicSegments) {
      reserved.add(segment)
    }
  }

  const apiBasePathFirstSegment = toFirstPathSegment(apiBasePath)

  if (apiBasePathFirstSegment) {
    reserved.add(apiBasePathFirstSegment)
  }

  return reserved
}

export const isReservedPublicPath = (
  apiBasePath: string,
  path: string,
  options?: {
    includeGardenAssets?: boolean
  },
): boolean => {
  const firstSegment = toFirstPathSegment(path)

  if (!firstSegment) {
    return false
  }

  return getReservedPublicSegments(apiBasePath, options).has(firstSegment)
}
