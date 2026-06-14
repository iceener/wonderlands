<script lang="ts">
import type { BackendGardenSite } from '@wonderlands/contracts/chat'
import { onMount } from 'svelte'
import { listGardens, updateGardenSite } from '../../services/api'
import { humanizeErrorMessage } from '../../services/response-errors'
import { getViewStoreContext } from '../../stores/view-store.svelte'
import ActionButton from '../../ui/ActionButton.svelte'
import AlertBanner from '../../ui/AlertBanner.svelte'
import SectionCard from '../../ui/SectionCard.svelte'
import StatusBadge from '../../ui/StatusBadge.svelte'

const viewStore = getViewStoreContext()

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

const sortArchivedSites = (sites: readonly BackendGardenSite[]): BackendGardenSite[] =>
  [...sites].sort((a, b) => {
    const updatedAtDiff =
      new Date(b.updatedAt ?? 0).valueOf() - new Date(a.updatedAt ?? 0).valueOf()
    if (updatedAtDiff !== 0) {
      return updatedAtDiff
    }

    return a.name.localeCompare(b.name)
  })

let archivedSites = $state<BackendGardenSite[]>([])
let errorMessage = $state('')
let successMessage = $state('')
let isLoading = $state(false)
let restoringSiteId = $state<string | null>(null)

const loadArchivedSites = async (options: { preserveAlerts?: boolean } = {}): Promise<void> => {
  isLoading = true
  if (!options.preserveAlerts) {
    errorMessage = ''
    successMessage = ''
  }

  try {
    const sites = await listGardens()
    archivedSites = sortArchivedSites(sites.filter((site) => site.status === 'archived'))
  } catch (error) {
    errorMessage = humanizeErrorMessage(
      error instanceof Error ? error.message : 'Could not load archived gardens.',
    )
  } finally {
    isLoading = false
  }
}

const restoreSite = async (site: BackendGardenSite): Promise<void> => {
  if (restoringSiteId) return

  restoringSiteId = site.id
  errorMessage = ''
  successMessage = ''

  try {
    await updateGardenSite(site.id, { status: 'draft' })
    archivedSites = archivedSites.filter((candidate) => candidate.id !== site.id)
    successMessage = `Restored "${site.name}" to draft.`
  } catch (error) {
    errorMessage = humanizeErrorMessage(
      error instanceof Error ? error.message : `Could not restore "${site.name}".`,
    )
  } finally {
    restoringSiteId = null
  }
}

onMount(() => {
  void loadArchivedSites()
})
</script>

<div class="mx-auto w-full px-6 py-8" style="max-width: var(--chat-max-w, 42rem)">
  <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0">
      <h2 class="text-[16px] font-semibold text-text-primary">Garden Archive</h2>
      <p class="mt-1 text-[13px] text-text-secondary">
        Archived gardens stay out of the command palette. Restore them here when you want them back in rotation.
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      <ActionButton onclick={() => { void loadArchivedSites({ preserveAlerts: true }) }} disabled={isLoading || Boolean(restoringSiteId)}>
        Refresh
      </ActionButton>
      <ActionButton onclick={() => { void viewStore.requestPop() }}>
        {viewStore.backLabel ?? 'Back to Chat'}
      </ActionButton>
    </div>
  </div>

  {#if errorMessage}
    <AlertBanner variant="error" message={errorMessage} ondismiss={() => { errorMessage = '' }} />
  {/if}
  {#if successMessage}
    <AlertBanner variant="success" message={successMessage} ondismiss={() => { successMessage = '' }} />
  {/if}

  <SectionCard title="Archived Gardens" description="Restore to draft to edit or republish a site.">
    {#if isLoading}
      <div class="rounded-md border border-border bg-surface-0 px-3 py-4 text-[13px] text-text-secondary">
        Loading archived gardens&#8230;
      </div>
    {:else if archivedSites.length === 0}
      <div class="rounded-md border border-border bg-surface-0 px-3 py-4 text-[13px] text-text-secondary">
        No archived gardens yet.
      </div>
    {:else}
      <div class="space-y-3">
        {#each archivedSites as site (site.id)}
          <div class="rounded-lg border border-border bg-surface-0 px-4 py-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="truncate text-[14px] font-semibold text-text-primary">{site.name}</p>
                  <StatusBadge status="unknown" label="archived" />
                  {#if site.currentPublishedBuildId}
                    <StatusBadge status="ready" label="published" />
                  {/if}
                  {#if site.isDefault}
                    <StatusBadge status="ready" label="default" />
                  {/if}
                </div>
                <p class="mt-1 text-[12px] text-text-secondary">
                  <span class="font-mono text-text-tertiary">{site.isDefault ? '/' : `/${site.slug}`}</span>
                  <span class="mx-1.5 text-text-tertiary">·</span>
                  <span class="font-mono text-text-tertiary">vault/{site.sourceScopePath}</span>
                </p>
                <p class="mt-1 text-[11px] text-text-tertiary">
                  Updated {formatDateTime(site.updatedAt)} by <span class="font-mono">{site.updatedByAccountId}</span>
                </p>
              </div>

              <div class="flex flex-wrap gap-2">
                <ActionButton
                  onclick={() => {
                    viewStore.push({ kind: 'garden-form', gardenSiteId: site.id })
                  }}
                  disabled={Boolean(restoringSiteId)}
                >
                  Open
                </ActionButton>
                <ActionButton
                  variant="accent"
                  onclick={() => { void restoreSite(site) }}
                  disabled={Boolean(restoringSiteId)}
                >
                  {restoringSiteId === site.id ? 'Restoring…' : 'Restore to Draft'}
                </ActionButton>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </SectionCard>
</div>
