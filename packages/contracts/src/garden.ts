import type { GardenBuildId, GardenSiteId } from './ids'

export type GardenSiteStatus = 'active' | 'archived' | 'disabled' | 'draft'
export type GardenBuildMode = 'debounced_scan' | 'manual'
export type GardenDeployMode = 'api_hosted' | 'github_pages'
export type GardenProtectedAccessMode = 'none' | 'site_password'
export type GardenBuildTriggerKind = 'auto_scan' | 'manual' | 'republish'
export type GardenBuildStatus = 'cancelled' | 'completed' | 'failed' | 'queued' | 'running'
export type GardenPageVisibility = 'protected' | 'public'

export interface BackendGardenBuildWarning {
  code: 'hidden_link' | 'unresolved_link'
  message: string
  sourcePath: string
  target?: string
}

export interface BackendGardenManifestPage {
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
  visibility: GardenPageVisibility
}

export interface BackendGardenManifestAsset {
  artifactPath: string
  sourcePath: string
}

export interface BackendGardenManifestSearchBundle {
  artifactPrefix: string
  fileCount: number
  indexedPageCount: number
}

export interface BackendGardenManifestSearch {
  enabled: boolean
  engine: 'pagefind'
  protectedBundle: BackendGardenManifestSearchBundle | null
  publicBundle: BackendGardenManifestSearchBundle
}

export interface BackendGardenBuildManifest {
  assets: BackendGardenManifestAsset[]
  pages: BackendGardenManifestPage[]
  protectedPageCount: number
  publicPageCount: number
  search?: BackendGardenManifestSearch
  sourceFingerprintSha256: string
  warnings: BackendGardenBuildWarning[]
}

export interface BackendGardenSite {
  buildMode: GardenBuildMode
  createdAt: string
  createdByAccountId: string
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
  tenantId: string
  updatedAt: string
  updatedByAccountId: string
}

export interface BackendGardenSourceBootstrapResult {
  createdPaths: string[]
  skippedPaths: string[]
  sourceScopePath: string
}

export interface BackendGardenBuild {
  completedAt: string | null
  configFingerprintSha256: string | null
  createdAt: string
  errorMessage: string | null
  id: GardenBuildId
  manifestJson: BackendGardenBuildManifest | null
  protectedArtifactRoot: string | null
  protectedPageCount: number
  publicArtifactRoot: string | null
  publicPageCount: number
  requestedByAccountId: string
  siteId: GardenSiteId
  sourceFingerprintSha256: string | null
  startedAt: string | null
  status: GardenBuildStatus
  tenantId: string
  triggerKind: GardenBuildTriggerKind
  warningCount: number
}

export interface CreateGardenSiteInput {
  buildMode?: GardenBuildMode
  deployMode?: GardenDeployMode
  isDefault?: boolean
  name: string
  protectedAccessMode?: GardenProtectedAccessMode
  protectedSecretRef?: string | null
  protectedSessionTtlSeconds?: number
  slug: string
  sourceScopePath?: string
  status?: GardenSiteStatus
}

export interface UpdateGardenSiteInput {
  buildMode?: GardenBuildMode
  deployMode?: GardenDeployMode
  isDefault?: boolean
  name?: string
  protectedAccessMode?: GardenProtectedAccessMode
  protectedSecretRef?: string | null
  protectedSessionTtlSeconds?: number
  slug?: string
  sourceScopePath?: string
  status?: GardenSiteStatus
}

export interface RequestGardenBuildInput {
  triggerKind?: Extract<GardenBuildTriggerKind, 'manual' | 'republish'>
}
