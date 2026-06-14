<script lang="ts">
import type {
  WebSearchBlock as WebSearchBlockModel,
  WebSearchReference,
} from '@wonderlands/contracts/chat'
import {
  focusAdjacentExpandableToggle,
  getBlockAnnouncement,
  getExpandablePanelId,
  getExpandableToggleLabel,
} from './block-accessibility'

let { block }: { block: WebSearchBlockModel } = $props()

let expanded = $state(false)

const isActive = $derived(block.status === 'in_progress' || block.status === 'searching')
const isFailed = $derived(block.status === 'failed')
const panelId = $derived(getExpandablePanelId(block))
const toggleLabel = $derived(getExpandableToggleLabel(block, expanded))
const announcement = $derived(getBlockAnnouncement(block))

interface ReferenceEntry {
  count: number
  domain: string | null
  key: string
  label: string
  url: string
}

const hasBody = $derived(
  block.queries.length > 0 ||
    block.targetUrls.length > 0 ||
    block.patterns.length > 0 ||
    block.references.length > 0,
)

const linkDisplay = (ref: WebSearchReference): string => {
  const title = ref.title?.trim()
  if (title) {
    return title
  }
  const domain = ref.domain?.trim()
  if (domain) {
    return domain
  }
  try {
    return new URL(ref.url).hostname
  } catch {
    return ref.url
  }
}

const dedupeStrings = (values: string[]): string[] => {
  const deduped: string[] = []

  for (const value of values) {
    if (value.length === 0 || deduped.includes(value)) {
      continue
    }

    deduped.push(value)
  }

  return deduped
}

const compactQueries = $derived.by(() => dedupeStrings(block.queries.map((query) => query.trim())))
const compactTargetUrls = $derived.by(() =>
  dedupeStrings(block.targetUrls.map((url) => url.trim())),
)
const compactPatterns = $derived.by(() =>
  dedupeStrings(block.patterns.map((pattern) => pattern.trim())),
)
const referenceEntries = $derived.by((): ReferenceEntry[] => {
  const entriesByKey: Record<string, ReferenceEntry> = {}

  for (const reference of block.references) {
    const label = linkDisplay(reference)
    const key = `${label.toLowerCase()}|${reference.domain ?? ''}`
    const existing = entriesByKey[key]

    if (existing) {
      existing.count += 1
      continue
    }

    entriesByKey[key] = {
      count: 1,
      domain: reference.domain,
      key,
      label,
      url: reference.url,
    }
  }

  return Object.values(entriesByKey)
})
const previewReferences = $derived(referenceEntries.slice(0, 8))
const hiddenReferenceCount = $derived(
  Math.max(0, referenceEntries.length - previewReferences.length),
)
const summaryParts = $derived.by(() => {
  const parts: string[] = []

  if (compactQueries.length > 0) {
    parts.push(`${compactQueries.length} quer${compactQueries.length === 1 ? 'y' : 'ies'}`)
  }

  if (referenceEntries.length > 0) {
    parts.push(`${referenceEntries.length} source${referenceEntries.length === 1 ? '' : 's'}`)
  }

  if (compactTargetUrls.length > 0) {
    parts.push(
      `${compactTargetUrls.length} page${compactTargetUrls.length === 1 ? '' : 's'} opened`,
    )
  }

  return parts.join(' · ')
})

const handleToggleKeydown = (event: KeyboardEvent) => {
  const currentTarget = event.currentTarget
  if (!(currentTarget instanceof HTMLButtonElement)) {
    return
  }

  if (focusAdjacentExpandableToggle(currentTarget, event.key)) {
    event.preventDefault()
  }
}
</script>

<div>
  <button
    id={`${panelId}-toggle`}
    type="button"
    data-block-toggle="true"
    class="sd-block-header w-full flex items-center gap-2 py-1 text-left group text-text-secondary hover:text-text-primary"
    onclick={() => {
      expanded = !expanded
    }}
    onkeydown={handleToggleKeydown}
    aria-controls={panelId}
    aria-expanded={expanded}
    aria-label={toggleLabel}
    >
    {#if announcement}
      <span class="sr-only" aria-live={isFailed ? 'assertive' : 'polite'}>{announcement}</span>
    {/if}
    <div
      class="sd-block-icon w-4 h-4 flex items-center justify-center shrink-0 {isActive
        ? 'text-text-primary'
        : isFailed
          ? 'text-danger-text'
          : 'text-text-tertiary'} group-hover:text-text-secondary"
    >
      {#if isFailed}
        <svg
          class="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      {:else if isActive}
        <span class="caret-blink" style="width:2px;height:12px;" aria-hidden="true"></span>
      {:else}
        <svg
          class="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      {/if}
    </div>

    <span
      class="sd-block-label flex-1 min-w-0 text-[13px] truncate {isActive ? 'text-text-primary' : 'text-text-secondary'} group-hover:text-text-primary"
    >
      {#if isFailed}
        web search failed
      {:else}
        web search{isActive ? '...' : ''}
      {/if}
    </span>
    {#if !isActive && summaryParts}
      <span class="max-w-[40%] truncate text-[11px] text-text-tertiary">
        {summaryParts}
      </span>
    {/if}

    <svg
      class="sd-block-chevron w-3.5 h-3.5 shrink-0 {expanded ? 'open' : ''}"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  </button>

  <div
    id={panelId}
    class="collapsible {expanded ? 'open' : ''}"
    role="region"
    aria-busy={isActive || undefined}
    aria-labelledby={`${panelId}-toggle`}
  >
    <div>
      <div class="pl-6 pr-4 pb-2 space-y-3">
        {#if expanded}
          {#if hasBody}
            {#if compactQueries.length > 0}
              <div>
                <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5">
                  Queries
                </div>
                <div class="flex flex-wrap gap-1.5">
                  {#each compactQueries as q, qi (`q-${qi}`)}
                    <span
                      class="rounded-md border border-border bg-surface-0 px-2 py-0.5 text-[12px] text-text-secondary"
                    >{q}</span>
                  {/each}
                </div>
              </div>
            {/if}
            {#if compactTargetUrls.length > 0}
              <div>
                <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5">
                  Pages Opened
                </div>
                <ul class="m-0 list-none space-y-1 p-0">
                  {#each compactTargetUrls.slice(0, 3) as url, ui (`u-${ui}`)}
                    <li>
                      <a
                        class="text-[12px] text-accent break-all hover:underline"
                        href={url}
                        rel="noopener noreferrer"
                        target="_blank">{url}</a>
                    </li>
                  {/each}
                </ul>
                {#if compactTargetUrls.length > 3}
                  <p class="mt-1 text-[11px] text-text-tertiary">
                    +{compactTargetUrls.length - 3} more page{compactTargetUrls.length - 3 === 1 ? '' : 's'}
                  </p>
                {/if}
              </div>
            {/if}
            {#if compactPatterns.length > 0}
              <div>
                <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5">
                  Find In Page
                </div>
                <div class="flex flex-wrap gap-1.5">
                  {#each compactPatterns.slice(0, 6) as p, pi (`p-${pi}`)}
                    <span
                      class="rounded-md border border-border bg-surface-0 px-2 py-0.5 font-mono text-[11px] text-text-secondary"
                    >{p}</span>
                  {/each}
                </div>
              </div>
            {/if}
            {#if referenceEntries.length > 0}
              <div>
                <div class="text-[10px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5">
                  Sources
                </div>
                <ul class="m-0 list-none space-y-1 p-0">
                  {#each previewReferences as ref (`r-${ref.key}`)}
                    <li>
                      <a
                        class="text-[12px] text-accent hover:underline"
                        href={ref.url}
                        rel="noopener noreferrer"
                        target="_blank">{ref.label}</a>
                      {#if ref.domain && ref.domain !== ref.label}
                        <span class="ml-2 text-[11px] text-text-tertiary">{ref.domain}</span>
                      {/if}
                      {#if ref.count > 1}
                        <span class="ml-2 text-[11px] text-text-tertiary">×{ref.count}</span>
                      {/if}
                    </li>
                  {/each}
                </ul>
                {#if hiddenReferenceCount > 0}
                  <p class="mt-1 text-[11px] text-text-tertiary">
                    +{hiddenReferenceCount} more source{hiddenReferenceCount === 1 ? '' : 's'}
                  </p>
                {/if}
              </div>
            {/if}
          {:else if isActive}
            <div class="flex items-center py-1 text-text-tertiary" aria-label="Web search in progress">
              <span class="caret-blink" style="width:2px;height:12px;" aria-hidden="true"></span>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
</div>
