export type GardenPageVisibility = 'private' | 'protected' | 'public'

export type GardenPageExposure = Exclude<GardenPageVisibility, 'private'> | 'hidden'

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
  listing: {
    defaultPageSize: number
  }
  navigation: GardenNavigationItem[]
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
  coverImage?: string
  date?: string
  description?: string
  draft: boolean
  excerpt?: string
  listing: boolean
  listingPageSize?: number
  order?: number
  publish: boolean
  rawMarkdown: string
  routePath: string
  seo?: GardenPageSeo
  slug: string
  sourcePath: string
  tags: string[]
  template?: string
  title: string
  updated?: string
  visibility: GardenPageVisibility
}

export interface GardenClassifiedPage extends GardenParsedPage {
  exposure: GardenPageExposure
  hiddenReason?: string
}

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
