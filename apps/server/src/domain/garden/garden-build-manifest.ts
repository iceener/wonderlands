// Garden build manifest persistence types.
//
// These types describe the shape of the JSON manifest persisted alongside a
// Garden build record (see `garden-build-repository.ts`). They previously
// lived in `application/garden/compiler/types.ts`; that module now re-exports
// them from here to avoid churn across compiler call sites.

export type GardenPageVisibility = 'private' | 'protected' | 'public'

export type GardenPageExposure = Exclude<GardenPageVisibility, 'private'> | 'hidden'

export interface GardenBuildWarning {
  code: 'asset_link_rewritten' | 'hidden_link' | 'unresolved_link'
  message: string
  sourcePath: string
  target?: string
}

export interface GardenManifestPage {
  artifactPath: string
  coverImageArtifactPath?: string
  description?: string
  excerpt?: string
  listingPageNumber?: number
  order?: number
  routePath: string
  sourcePath: string
  sourceSlug: string
  tags: string[]
  title: string
  visibility: Exclude<GardenPageExposure, 'hidden'>
}

export interface GardenManifestAsset {
  artifactPath: string
  sourcePath: string
}

export interface GardenManifestSearchBundle {
  artifactPrefix: string
  fileCount: number
  indexedPageCount: number
}

export interface GardenManifestSearch {
  enabled: boolean
  engine: 'pagefind'
  protectedBundle: GardenManifestSearchBundle | null
  publicBundle: GardenManifestSearchBundle
}

export interface GardenBuildManifest {
  assets: GardenManifestAsset[]
  pages: GardenManifestPage[]
  protectedPageCount: number
  publicPageCount: number
  search?: GardenManifestSearch
  sourceFingerprintSha256: string
  warnings: GardenBuildWarning[]
}
