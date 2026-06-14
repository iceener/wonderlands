<script lang="ts">
import type {
  BackendGardenBuild,
  BackendGardenManifestPage,
  BackendGardenSite,
  GardenBuildMode,
  GardenDeployMode,
  GardenProtectedAccessMode,
  GardenSiteStatus,
} from '@wonderlands/contracts/chat'
import { onDestroy, onMount, tick } from 'svelte'
import {
  bootstrapGardenSource,
  createGardenSite,
  getGardenSite,
  listGardenBuilds,
  publishGarden,
  requestGardenBuild,
  streamTenantEvents,
  updateGardenSite,
} from '../../services/api'
import { toApiUrl } from '../../services/backend'
import { humanizeErrorMessage } from '../../services/response-errors'
import { getViewStoreContext, viewKey } from '../../stores/view-store.svelte'
import ActionButton from '../../ui/ActionButton.svelte'
import AlertBanner from '../../ui/AlertBanner.svelte'
import FieldInput from '../../ui/FieldInput.svelte'
import SectionCard from '../../ui/SectionCard.svelte'
import SegmentControl from '../../ui/SegmentControl.svelte'
import StatusBadge from '../../ui/StatusBadge.svelte'
import { scrollFormViewToTop } from '../../utils/scroll-form-view'

interface Props {
  currentAccountId: string | null
  gardenSiteId?: string
}

interface GardenFormState {
  buildMode: GardenBuildMode
  deployMode: GardenDeployMode
  isDefault: boolean
  name: string
  protectedAccessMode: GardenProtectedAccessMode
  protectedSecretRef: string
  protectedSessionTtlSeconds: string
  slug: string
  sourceScopePath: string
  status: GardenSiteStatus
}

interface StatusPresentation {
  label: string
  tone: string
}

const TTL_PRESETS: { label: string; value: string }[] = [
  { label: '1 hour', value: '3600' },
  { label: '24 hours', value: '86400' },
  { label: '7 days', value: '604800' },
  { label: '30 days', value: '2592000' },
]

let { currentAccountId, gardenSiteId }: Props = $props()

const viewStore = getViewStoreContext()
const getFormView = () => ({
  kind: 'garden-form' as const,
  ...(gardenSiteId ? { gardenSiteId } : {}),
})

const createInitialFormState = (): GardenFormState => ({
  buildMode: 'manual',
  deployMode: 'api_hosted',
  isDefault: false,
  name: '',
  protectedAccessMode: 'none',
  protectedSecretRef: '',
  protectedSessionTtlSeconds: '86400',
  slug: '',
  sourceScopePath: '.',
  status: 'draft',
})

const toFormState = (site: BackendGardenSite): GardenFormState => ({
  buildMode: site.buildMode,
  deployMode: site.deployMode,
  isDefault: site.isDefault,
  name: site.name,
  protectedAccessMode: site.protectedAccessMode,
  protectedSecretRef: site.protectedSecretRef ?? '',
  protectedSessionTtlSeconds: String(site.protectedSessionTtlSeconds),
  slug: site.slug,
  sourceScopePath: site.sourceScopePath,
  status: site.status,
})

const toComparableSnapshot = (state: GardenFormState): string =>
  JSON.stringify({
    ...state,
    name: state.name.trim(),
    protectedSecretRef: state.protectedSecretRef.trim(),
    protectedSessionTtlSeconds: state.protectedSessionTtlSeconds.trim(),
    slug: state.slug.trim(),
    sourceScopePath: state.sourceScopePath.trim(),
  })

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return 'Not set'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

const toBrowserRouteUrl = (path: string): string => {
  if (typeof window === 'undefined') return path
  return new URL(path, window.location.origin).toString()
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')

const isValidSlug = (value: string): boolean =>
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value) && !value.includes('--')

const getSiteStatusPresentation = (status: GardenSiteStatus): StatusPresentation => {
  switch (status) {
    case 'active':
      return { label: 'active', tone: 'ready' }
    case 'disabled':
      return { label: 'disabled', tone: 'degraded' }
    case 'archived':
      return { label: 'archived', tone: 'unknown' }
    default:
      return { label: 'draft', tone: 'unknown' }
  }
}

const getBuildStatusPresentation = (status: BackendGardenBuild['status']): StatusPresentation => {
  switch (status) {
    case 'completed':
      return { label: 'completed', tone: 'ready' }
    case 'running':
      return { label: 'running', tone: 'authorization_required' }
    case 'queued':
      return { label: 'queued', tone: 'pending' }
    case 'failed':
      return { label: 'failed', tone: 'degraded' }
    case 'cancelled':
      return { label: 'cancelled', tone: 'unknown' }
    default:
      return { label: status, tone: 'unknown' }
  }
}

const sortPages = (pages: BackendGardenManifestPage[]): BackendGardenManifestPage[] =>
  [...pages].sort(
    (a, b) => a.routePath.localeCompare(b.routePath) || a.sourcePath.localeCompare(b.sourcePath),
  )

let editingGardenSiteId = $state<string | null>(null)
let site = $state<BackendGardenSite | null>(null)
let builds = $state<BackendGardenBuild[]>([])
let form = $state<GardenFormState>(createInitialFormState())
let loadedForm = $state<GardenFormState>(createInitialFormState())
let errorMessage = $state('')
let successMessage = $state('')
let isLoading = $state(false)
let isReloading = $state(false)
let isSaving = $state(false)
let isBuilding = $state(false)
let isPublishing = $state(false)
let isBootstrapping = $state(false)
let isRealtimeReconnecting = $state(false)
let slugTouched = $state(false)
let formRoot: HTMLElement | undefined = $state()
let reloadVersion = 0

const anyDirty = $derived.by(() => toComparableSnapshot(form) !== toComparableSnapshot(loadedForm))

const slugError = $derived.by(() => {
  const trimmed = form.slug.trim()
  if (!trimmed) return null
  if (!isValidSlug(trimmed)) return 'Slug must be lowercase letters, numbers, and single hyphens.'
  return null
})

const scopePathError = $derived.by(() => {
  const trimmed = form.sourceScopePath.trim()
  if (!trimmed || trimmed === '.') return null
  if (trimmed.startsWith('/')) return 'Must be a relative path.'
  if (trimmed.includes('..')) return 'Path traversal (..) is not allowed.'
  if (/^(attachments|system|public)(\/|$)/i.test(trimmed)) return 'This is a reserved root.'
  return null
})

const resolvedSlug = $derived(form.slug.trim() ? slugify(form.slug) : '')

const currentBuild = $derived.by(() => {
  const id = site?.currentBuildId
  return id ? (builds.find((b) => b.id === id) ?? null) : null
})

const currentPublishedBuild = $derived.by(() => {
  const id = site?.currentPublishedBuildId
  return id ? (builds.find((b) => b.id === id) ?? null) : null
})

const recentBuilds = $derived(builds.slice(0, 5))

const routeSummaryBuild = $derived(currentBuild ?? currentPublishedBuild ?? null)
const publishedSlug = $derived(site?.slug ?? resolvedSlug)
const liveSitePath = $derived.by(() => {
  if (site?.isDefault ?? form.isDefault) return '/'
  return publishedSlug ? `/${publishedSlug}` : null
})
const previewUrl = $derived.by(() =>
  editingGardenSiteId
    ? toBrowserRouteUrl(toApiUrl(`/gardens/${editingGardenSiteId}/preview`))
    : null,
)
const liveSiteUrl = $derived.by(() => (liveSitePath ? toBrowserRouteUrl(liveSitePath) : null))

const publicRoutes = $derived.by(() =>
  routeSummaryBuild?.manifestJson
    ? sortPages(routeSummaryBuild.manifestJson.pages.filter((p) => p.visibility === 'public'))
    : [],
)
const protectedRoutes = $derived.by(() =>
  routeSummaryBuild?.manifestJson
    ? sortPages(routeSummaryBuild.manifestJson.pages.filter((p) => p.visibility === 'protected'))
    : [],
)

const statusDescription = $derived.by(() => {
  switch (form.status) {
    case 'draft':
      return 'Not served publicly. Use this while setting up.'
    case 'active':
      return 'Garden is live and serves published builds.'
    case 'disabled':
      return 'Taken offline. Config and builds are preserved.'
    case 'archived':
      return 'Hidden from management. Restore from the archive.'
    default:
      return ''
  }
})

const buildModeDescription = $derived.by(() => {
  switch (form.buildMode) {
    case 'manual':
      return 'You trigger builds manually.'
    case 'debounced_scan':
      return 'Builds and publishes automatically when source files change.'
    default:
      return ''
  }
})

const canSave = $derived(
  anyDirty && !isSaving && !isLoading && !isReloading && !slugError && !scopePathError,
)
const canBootstrap = $derived(
  Boolean(editingGardenSiteId) &&
    !anyDirty &&
    !isSaving &&
    !isLoading &&
    !isReloading &&
    !isBuilding &&
    !isPublishing &&
    !isBootstrapping,
)
const canBuild = $derived(
  Boolean(editingGardenSiteId) &&
    !anyDirty &&
    !isSaving &&
    !isLoading &&
    !isReloading &&
    !isBuilding &&
    !isBootstrapping,
)
const canPublish = $derived(
  Boolean(editingGardenSiteId) &&
    !anyDirty &&
    !isSaving &&
    !isLoading &&
    !isReloading &&
    !isPublishing &&
    !isBootstrapping &&
    site?.status === 'active' &&
    Boolean(site.currentBuildId),
)
const canOpenPreview = $derived(Boolean(editingGardenSiteId && currentBuild) && !anyDirty)
const canOpenPublicSite = $derived(
  Boolean(site?.currentPublishedBuildId && site.status === 'active'),
)

const hydrateSite = (nextSite: BackendGardenSite): void => {
  site = nextSite
  const snapshot = toFormState(nextSite)
  form = { ...snapshot }
  loadedForm = snapshot
  slugTouched = true
}

const loadBuilds = async (siteId: string): Promise<void> => {
  builds = await listGardenBuilds(siteId)
}

const reloadSiteData = async (
  siteId: string,
  options: { preserveAlerts?: boolean; silent?: boolean } = {},
): Promise<void> => {
  const version = ++reloadVersion
  if (!options.preserveAlerts) {
    errorMessage = ''
    successMessage = ''
  }
  if (options.silent) {
    isReloading = true
  } else {
    isLoading = true
  }

  try {
    const [loadedSite, loadedBuilds] = await Promise.all([
      getGardenSite(siteId),
      listGardenBuilds(siteId),
    ])
    // Only apply results if this is still the latest reload and user hasn't started editing
    if (reloadVersion !== version || anyDirty) return
    hydrateSite(loadedSite)
    builds = loadedBuilds
  } finally {
    if (reloadVersion === version) {
      if (options.silent) {
        isReloading = false
      } else {
        isLoading = false
      }
    }
  }
}

const showTopOfForm = async (): Promise<void> => {
  await tick()
  scrollFormViewToTop(formRoot)
}

const toDisplayError = (error: unknown, fallback: string): string =>
  humanizeErrorMessage(error instanceof Error ? error.message : fallback)

const toGardenPayload = () => {
  const trimmedName = form.name.trim()
  const trimmedSlug = resolvedSlug
  const trimmedSecretRef = form.protectedSecretRef.trim()
  const trimmedSourceScopePath = form.sourceScopePath.trim() || '.'
  const ttlSeconds = Number.parseInt(form.protectedSessionTtlSeconds.trim(), 10)

  if (!trimmedName) {
    errorMessage = 'Site name is required.'
    return null
  }
  if (!trimmedSlug) {
    errorMessage = 'Slug is required.'
    return null
  }
  if (slugError) {
    errorMessage = slugError
    return null
  }
  if (scopePathError) {
    errorMessage = scopePathError
    return null
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    errorMessage = 'Session TTL must be a positive number.'
    return null
  }
  if (form.protectedAccessMode === 'site_password' && !trimmedSecretRef) {
    errorMessage = 'A password is required when protected access is enabled.'
    return null
  }

  return {
    buildMode: form.buildMode,
    deployMode: form.deployMode,
    isDefault: form.isDefault,
    name: trimmedName,
    protectedAccessMode: form.protectedAccessMode,
    protectedSecretRef: form.protectedAccessMode === 'site_password' ? trimmedSecretRef : null,
    protectedSessionTtlSeconds: ttlSeconds,
    slug: trimmedSlug,
    sourceScopePath: trimmedSourceScopePath,
    status: form.status,
  }
}

const initializeSource = async (): Promise<void> => {
  if (!editingGardenSiteId || !canBootstrap) return
  isBootstrapping = true
  errorMessage = ''
  successMessage = ''

  try {
    const bootstrap = await bootstrapGardenSource(editingGardenSiteId)
    successMessage =
      bootstrap.createdPaths.length > 0
        ? `Initialized ${bootstrap.sourceScopePath} with ${bootstrap.createdPaths.join(', ')}.`
        : `Source scope ${bootstrap.sourceScopePath} already had _garden.yml, _meta/frontmatter.md, index.md, and public/.`
  } catch (error) {
    errorMessage = toDisplayError(error, 'Could not initialize this garden source.')
  } finally {
    isBootstrapping = false
  }
}

const save = async (): Promise<boolean> => {
  if (!canSave) return false
  const payload = toGardenPayload()
  if (!payload) return false

  isSaving = true
  errorMessage = ''
  successMessage = ''

  try {
    const wasEditing = Boolean(editingGardenSiteId)
    const savedSite = editingGardenSiteId
      ? await updateGardenSite(editingGardenSiteId, payload)
      : await createGardenSite(payload)

    editingGardenSiteId = savedSite.id
    hydrateSite(savedSite)
    await loadBuilds(savedSite.id)
    successMessage = wasEditing ? `Saved "${savedSite.name}".` : `Created "${savedSite.name}".`
    return true
  } catch (error) {
    errorMessage = toDisplayError(error, 'Could not save this garden site.')
    return false
  } finally {
    isSaving = false
  }
}

const buildSite = async (): Promise<void> => {
  if (!editingGardenSiteId || !canBuild) return
  isBuilding = true
  errorMessage = ''
  successMessage = ''

  try {
    const build = await requestGardenBuild(editingGardenSiteId, { triggerKind: 'manual' })
    await reloadSiteData(editingGardenSiteId, { preserveAlerts: true, silent: true })

    if (build.status === 'completed') {
      successMessage = `Build completed with ${build.warningCount} warning${build.warningCount === 1 ? '' : 's'}.`
    } else {
      errorMessage = build.errorMessage?.trim() || `Build finished with status "${build.status}".`
    }
  } catch (error) {
    errorMessage = toDisplayError(error, 'Could not build this garden site.')
  } finally {
    isBuilding = false
  }
}

const publishSite = async (): Promise<void> => {
  if (!editingGardenSiteId || !canPublish) return
  isPublishing = true
  errorMessage = ''
  successMessage = ''

  try {
    const publishedSite = await publishGarden(editingGardenSiteId)
    hydrateSite(publishedSite)
    await loadBuilds(publishedSite.id)
    successMessage = `Published "${publishedSite.name}" to ${publishedSite.isDefault ? '/' : `/${publishedSite.slug}`}.`
  } catch (error) {
    errorMessage = toDisplayError(error, 'Could not publish this garden site.')
  } finally {
    isPublishing = false
  }
}

const openPreview = (): void => {
  if (!previewUrl || !canOpenPreview || typeof window === 'undefined') return
  window.open(previewUrl, '_blank', 'noopener,noreferrer')
}

const openPublicSite = (): void => {
  if (!liveSiteUrl || !canOpenPublicSite || typeof window === 'undefined') return
  window.open(liveSiteUrl, '_blank', 'noopener,noreferrer')
}

const isActiveView = (): boolean => viewKey(viewStore.activeView) === viewKey(getFormView())

let isConfirmingDiscard = $state(false)
let discardTimer: ReturnType<typeof setTimeout> | null = null

const requestClose = (): void => {
  if (!anyDirty) {
    viewStore.pop()
    return
  }
  if (!isConfirmingDiscard) {
    isConfirmingDiscard = true
    discardTimer = setTimeout(() => {
      isConfirmingDiscard = false
    }, 3000)
    return
  }
  if (discardTimer) clearTimeout(discardTimer)
  isConfirmingDiscard = false
  viewStore.pop()
}

const saveAndClose = async (): Promise<void> => {
  if (!anyDirty) {
    viewStore.pop()
    return
  }

  if (await save()) {
    viewStore.pop()
  }
}

const handleKeydown = (event: KeyboardEvent): void => {
  if (!isActiveView()) {
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    void requestClose()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void saveAndClose()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault()
    void save()
  }
}

onMount(() => {
  editingGardenSiteId = gardenSiteId?.trim() || null
  form = createInitialFormState()
  loadedForm = createInitialFormState()

  window.addEventListener('keydown', handleKeydown)
  viewStore.registerDirtyGuard(getFormView(), () => anyDirty)
  void showTopOfForm()

  if (!editingGardenSiteId) return

  isLoading = true
  void reloadSiteData(editingGardenSiteId)
    .catch((error) => {
      errorMessage = toDisplayError(error, 'Could not load this garden site.')
    })
    .finally(() => {
      isLoading = false
      void showTopOfForm()
    })
})

$effect(() => {
  const liveSiteId = editingGardenSiteId
  if (!liveSiteId) return

  const controller = new AbortController()
  let closed = false

  void streamTenantEvents({
    onEvents: (events) => {
      if (closed || anyDirty) return
      const shouldRefresh = events.some((event) => {
        const aggregateType = event.aggregateType.toLowerCase()
        const eventType = event.type.toLowerCase()
        return (
          event.aggregateId === liveSiteId ||
          aggregateType.includes('garden') ||
          eventType.includes('garden')
        )
      })
      if (shouldRefresh) {
        void reloadSiteData(liveSiteId, { preserveAlerts: true, silent: true }).catch(
          () => undefined,
        )
      }
    },
    onReconnectStateChange: (next) => {
      isRealtimeReconnecting = next
    },
    signal: controller.signal,
  }).catch((error) => {
    if (error instanceof Error && error.name === 'AbortError') return
    console.warn('[garden-form:streamTenantEvents]', error)
  })

  return () => {
    closed = true
    isRealtimeReconnecting = false
    controller.abort()
  }
})

onDestroy(() => {
  if (discardTimer) clearTimeout(discardTimer)
  window.removeEventListener('keydown', handleKeydown)
  viewStore.clearDirtyGuard(getFormView())
})
</script>

<div class="mx-auto w-full px-6 py-8" style="max-width: var(--chat-max-w, 42rem)" bind:this={formRoot}>
  <!-- Header + primary actions -->
  <div class="mb-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-[16px] font-semibold text-text-primary">
            {editingGardenSiteId ? 'Garden Admin' : 'New Garden Site'}
          </h2>
          {#if site}
            {@const siteStatus = getSiteStatusPresentation(site.status)}
            <StatusBadge status={siteStatus.tone} label={siteStatus.label} />
            {#if site.isDefault}
              <StatusBadge status="ready" label="default" />
            {/if}
            {#if site.currentPublishedBuildId}
              <StatusBadge status="ready" label="live" />
            {/if}
          {/if}
        </div>
        <p class="mt-1 text-[13px] text-text-secondary">
          Publish a static site from your vault.
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <ActionButton variant={isConfirmingDiscard ? 'danger' : 'secondary'} onclick={() => { requestClose() }}>
          {isConfirmingDiscard ? 'Discard' : viewStore.backLabel ?? 'Back to Chat'}
        </ActionButton>
        <ActionButton variant="primary" disabled={isSaving} onclick={() => { void saveAndClose() }}>
          {isSaving ? 'Saving…' : 'Save & Close'}
        </ActionButton>
      </div>
    </div>

    <!-- Primary actions bar -->
    {#if editingGardenSiteId}
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <ActionButton onclick={() => void initializeSource()} disabled={!canBootstrap}>
          {isBootstrapping ? 'Initializing\u2026' : 'Init Source'}
        </ActionButton>
        <ActionButton onclick={() => void buildSite()} disabled={!canBuild}>
          {isBuilding ? 'Building\u2026' : 'Build'}
        </ActionButton>
        <ActionButton variant="accent" onclick={() => void publishSite()} disabled={!canPublish}>
          {isPublishing ? 'Publishing\u2026' : 'Publish'}
        </ActionButton>
        {#if previewUrl && canOpenPreview}
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary">
            Preview &#8599;
          </a>
        {/if}
        {#if liveSiteUrl && canOpenPublicSite}
          <a href={liveSiteUrl} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary">
            Live Site &#8599;
          </a>
        {/if}
      </div>
    {/if}
  </div>

  {#if errorMessage}
    <AlertBanner variant="error" message={errorMessage} ondismiss={() => { errorMessage = '' }} />
  {/if}
  {#if successMessage}
    <AlertBanner variant="success" message={successMessage} ondismiss={() => { successMessage = '' }} />
  {/if}
  {#if isRealtimeReconnecting}
    <AlertBanner variant="warning" message="Live updates are reconnecting." ondismiss={null} />
  {/if}

  {#if isLoading}
    <div class="rounded-lg border border-border bg-surface-1/60 px-4 py-5 text-[13px] text-text-secondary">
      Loading garden site&#8230;
    </div>
  {:else}
    <form class="space-y-6" onsubmit={(event) => { event.preventDefault(); void save() }}>

      <!-- Build status (single line) -->
      {#if editingGardenSiteId}
        <p class="text-[12px] text-text-secondary">
          {#if currentPublishedBuild}
            Live · {currentPublishedBuild.publicPageCount} pages · built {formatDateTime(currentPublishedBuild.completedAt)}
          {:else if currentBuild}
            Built · {currentBuild.publicPageCount} pages · not published
            {#if currentBuild.errorMessage}<span class="text-danger-text"> · {currentBuild.errorMessage}</span>{/if}
          {:else}
            No build yet.
          {/if}
        </p>
      {/if}

      <!-- Site -->
      <SectionCard title="Site">
        <div class="space-y-4">
          <FieldInput
            label="Site Name"
            value={form.name}
            placeholder="Wonderlands Garden"
            oninput={(value) => {
              form.name = value
              if (!slugTouched) form.slug = slugify(value)
            }}
          />

          <div>
            <FieldInput
              label="Slug"
              value={form.slug}
              placeholder="wonderlands-garden"
              oninput={(value) => { slugTouched = true; form.slug = slugify(value) }}
            />
            {#if form.slug.trim() && resolvedSlug !== form.slug.trim()}
              <p class="mt-1 text-[11px] text-text-tertiary">
                Resolved: <span class="font-mono text-text-secondary">{resolvedSlug}</span>
              </p>
            {/if}
            {#if slugError}
              <p class="mt-1 text-[11px] text-danger-text">{slugError}</p>
            {/if}
            <p class="mt-1 text-[11px] text-text-tertiary">
              Published at <span class="font-mono text-text-secondary">{form.isDefault ? '/' : `/${resolvedSlug || 'site-slug'}`}</span>
            </p>
          </div>

          <button
            type="button"
            class="flex items-center gap-2 cursor-pointer"
            onclick={() => { form.isDefault = !form.isDefault }}
          >
            <span
              class="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors {form.isDefault ? 'border-accent bg-accent text-white' : 'border-border-strong bg-surface-1 text-transparent hover:border-text-tertiary'}"
            >
              <svg class="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6 5 8.5 9.5 3.5" /></svg>
            </span>
            <span class="text-[13px] text-text-secondary">Make this the default site (serves at /)</span>
          </button>

          <div>
            <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Status</span>
            <SegmentControl
              options={[
                { value: 'draft', label: 'Draft' },
                { value: 'active', label: 'Active' },
                { value: 'disabled', label: 'Disabled' },
                { value: 'archived', label: 'Archived' },
              ]}
              value={form.status}
              onchange={(value) => { form.status = value }}
            />
            <p class="mt-1 text-[11px] text-text-tertiary">{statusDescription}</p>
          </div>
        </div>
      </SectionCard>

      <!-- Source -->
      <SectionCard title="Source" description="Folder inside your vault to publish from.">
        <div class="space-y-4">
          {#if !editingGardenSiteId && currentAccountId}
            <div class="rounded-md border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-secondary">
              Source binds to account <span class="font-mono text-text-primary">{currentAccountId}</span>.
            </div>
          {/if}

          <div>
            <FieldInput
              label="Vault Folder"
              value={form.sourceScopePath}
              placeholder=". (entire vault)"
              oninput={(value) => { form.sourceScopePath = value }}
            />
            {#if scopePathError}
              <p class="mt-1 text-[11px] text-danger-text">{scopePathError}</p>
            {:else}
              <p class="mt-1 text-[11px] text-text-tertiary">
                Relative to <span class="font-mono">vault/</span>. Use <span class="font-mono">.</span> for the entire vault.
              </p>
            {/if}
          </div>

          <div>
            <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Build Mode</span>
            <SegmentControl
              options={[
                { value: 'manual', label: 'Manual' },
                { value: 'debounced_scan', label: 'Auto Scan' },
              ]}
              value={form.buildMode}
              onchange={(value) => { form.buildMode = value }}
            />
            <p class="mt-1 text-[11px] text-text-tertiary">{buildModeDescription}</p>
          </div>

          {#if routeSummaryBuild?.manifestJson}
            <div class="rounded-md border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-secondary">
              <p>{routeSummaryBuild.manifestJson.publicPageCount} public page{routeSummaryBuild.manifestJson.publicPageCount === 1 ? '' : 's'}, {routeSummaryBuild.manifestJson.protectedPageCount} protected, {routeSummaryBuild.manifestJson.assets.length} asset{routeSummaryBuild.manifestJson.assets.length === 1 ? '' : 's'}.</p>
              {#if routeSummaryBuild.manifestJson.warnings.length > 0}
                <p class="mt-1 text-warning-text">{routeSummaryBuild.manifestJson.warnings.length} warning{routeSummaryBuild.manifestJson.warnings.length === 1 ? '' : 's'} in last build.</p>
              {/if}
            </div>
          {/if}
        </div>
      </SectionCard>

      <!-- Protection -->
      <SectionCard title="Protection" collapsible defaultOpen={form.protectedAccessMode !== 'none'}>
        <div class="space-y-4">
          <div>
            <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Protected Access</span>
            <SegmentControl
              options={[
                { value: 'none', label: 'None' },
                { value: 'site_password', label: 'Site Password' },
              ]}
              value={form.protectedAccessMode}
              onchange={(value) => { form.protectedAccessMode = value }}
            />
            <p class="mt-2 text-[12px] leading-5 text-text-secondary">
              Only pages with
              <code class="rounded bg-surface-1 px-1 py-0.5 font-mono text-[11px] text-text-primary">visibility: protected</code>
              require this password. Public pages stay open.
            </p>
          </div>

          {#if form.protectedAccessMode === 'site_password'}
            <FieldInput
              label="Password"
              value={form.protectedSecretRef}
              type="password"
              placeholder="Shared password for protected pages"
              oninput={(value) => { form.protectedSecretRef = value }}
            />

            <div>
              <span class="mb-2 block text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Session Duration</span>
              <div class="flex flex-wrap gap-2">
                {#each TTL_PRESETS as preset}
                  <button
                    type="button"
                    class="rounded-md border px-3 py-1.5 text-[12px] transition-colors {form.protectedSessionTtlSeconds === preset.value ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-surface-1 text-text-secondary hover:bg-surface-2'}"
                    onclick={() => { form.protectedSessionTtlSeconds = preset.value }}
                  >
                    {preset.label}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </SectionCard>

      <!-- Routes -->
      {#if routeSummaryBuild?.manifestJson && (publicRoutes.length > 0 || protectedRoutes.length > 0)}
        <SectionCard
          title="Routes ({publicRoutes.length + protectedRoutes.length})"
          collapsible
          defaultOpen={false}
        >
          {#if publicRoutes.length > 0}
            <div class="mb-3">
              <p class="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Public ({publicRoutes.length})</p>
              <div class="space-y-1">
                {#each publicRoutes as page}
                  <div class="flex items-baseline justify-between gap-2 px-2 py-1 text-[11px]">
                    <span class="font-mono text-text-tertiary">{page.routePath}</span>
                    <span class="truncate text-text-tertiary">{page.sourcePath}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
          {#if protectedRoutes.length > 0}
            <div>
              <p class="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-text-tertiary">Protected ({protectedRoutes.length})</p>
              <div class="space-y-1">
                {#each protectedRoutes as page}
                  <div class="flex items-baseline justify-between gap-2 px-2 py-1 text-[11px]">
                    <span class="font-mono text-text-tertiary">{page.routePath}</span>
                    <span class="truncate text-text-tertiary">{page.sourcePath}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </SectionCard>
      {/if}

      <!-- Build History -->
      {#if recentBuilds.length > 0}
        <SectionCard title="History ({recentBuilds.length})" collapsible defaultOpen={false}>
          <div class="space-y-0.5">
            {#each recentBuilds as build}
              {@const isPublished = build.id === site?.currentPublishedBuildId}
              <p class="text-[11px] text-text-tertiary">
                {formatDateTime(build.createdAt)} · {build.publicPageCount} pages{#if build.warningCount > 0} · {build.warningCount}w{/if}{#if build.status === 'failed'} · <span class="text-danger-text">failed</span>{/if}{#if isPublished} · <span class="text-text-secondary">live</span>{/if}
              </p>
            {/each}
          </div>
        </SectionCard>
      {/if}

      {#if editingGardenSiteId}
        <div class="rounded-md border border-border bg-surface-0 px-3 py-2 text-[11px] text-text-tertiary">
          <p>ID: <span class="font-mono text-text-secondary">{editingGardenSiteId}</span></p>
          <p class="mt-0.5">Created {formatDateTime(site?.createdAt)} · updated {formatDateTime(site?.updatedAt)}</p>
        </div>
      {/if}
    </form>

    <!-- Sticky save bar -->
    <div class="sticky bottom-0 -mx-6 mt-6 flex items-center justify-between border-t border-border bg-bg/80 px-6 py-4 backdrop-blur-sm">
      <div>
        {#if anyDirty}
          <span class="text-[11px] text-text-tertiary">Unsaved changes</span>
        {/if}
      </div>
      <ActionButton variant="primary" disabled={!canSave} onclick={() => void save()}>
        {#if isSaving}
          Saving&#8230;
        {:else if editingGardenSiteId}
          Save Changes
        {:else}
          Create Site
        {/if}
      </ActionButton>
    </div>
  {/if}
</div>
