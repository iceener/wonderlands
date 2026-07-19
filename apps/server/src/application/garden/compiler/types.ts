// Garden build manifest persistence types now live in the domain layer
// (`domain/garden/garden-build-manifest.ts`). Re-exported here temporarily to
// avoid churn across the compiler call sites that still import them from
// this module.
import type {
  GardenBuildManifest,
  GardenBuildWarning,
  GardenManifestAsset,
  GardenManifestPage,
  GardenManifestSearch,
  GardenManifestSearchBundle,
  GardenPageExposure,
  GardenPageVisibility,
} from '../../../domain/garden/garden-build-manifest'

export type {
  GardenBuildManifest,
  GardenBuildWarning,
  GardenManifestAsset,
  GardenManifestPage,
  GardenManifestSearch,
  GardenManifestSearchBundle,
  GardenPageExposure,
  GardenPageVisibility,
}

export interface GardenNavigationItem {
  label: string
  path: string
}

export interface GardenSidebarItem {
  children: GardenSidebarItem[]
  description?: string
  label: string
  order?: number
  path?: string
}

export interface GardenSourceConfig {
  description?: string
  home?: string
  image?: string
  listing: {
    defaultPageSize: number
  }
  navigation: GardenNavigationItem[]
  noindex?: boolean
  public: {
    exclude: string[]
    roots: string[]
  }
  schema: 'garden/v1'
  sections: Record<
    string,
    {
      description?: string
      order?: number
      title?: string
    }
  >
  theme?: string
  title?: string
  twitter?: string
}

export interface GardenPageSeo {
  canonical?: string
  description?: string
  image?: string
  keywords?: string[]
  noindex?: boolean
  title?: string
}

export interface GardenSourceScopeResolution {
  configRef: string
  publicAssetsRef: string
  sourceScopePath: string
  sourceScopeRef: string
  vaultRootRef: string
}

export interface GardenParsedPage {
  aliases: string[]
  coverImage?: string
  date?: string
  description?: string
  draft: boolean
  excerpt?: string
  listing?: boolean
  listingPageSize?: number
  order?: number
  publish: boolean
  rawMarkdown: string
  routePath: string
  seo?: GardenPageSeo
  slug: string
  sourcePath: string
  sourceUpdatedAt?: string
  sourceUpdatedAtMs?: number
  synthetic?: boolean
  tags: string[]
  template?: string
  title: string
  unlisted: boolean
  updated?: string
  visibility: GardenPageVisibility
}

export interface GardenClassifiedPage extends GardenParsedPage {
  exposure: GardenPageExposure
  hiddenReason?: string
}

export interface GardenBuiltPage {
  artifactPath: string
  content: string
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

export interface GardenBuiltAsset {
  artifactPath: string
  sourcePath: string
  sourceRef: string
}

export interface GardenBuildResult {
  config: GardenSourceConfig
  manifest: GardenBuildManifest
  protectedAssets: GardenBuiltAsset[]
  protectedPages: GardenBuiltPage[]
  publicAssets: GardenBuiltAsset[]
  publicPages: GardenBuiltPage[]
  source: GardenSourceScopeResolution
}

export interface GardenBuildWriteResult {
  protectedRootRef: string
  publicRootRef: string
  search: GardenManifestSearch
}

export interface GardenCompiledBuildResult {
  config: GardenSourceConfig
  manifest: GardenBuildManifest
  protectedRootRef: string
  publicRootRef: string
  source: GardenSourceScopeResolution
}
