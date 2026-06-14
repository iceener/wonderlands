<script lang="ts">
import type { ArtifactBlock as ArtifactBlockModel } from '@wonderlands/contracts/chat'
import MarkdownHtml from '../MarkdownHtml.svelte'
import {
  focusAdjacentExpandableToggle,
  getBlockAnnouncement,
  getExpandablePanelId,
  getExpandableToggleLabel,
} from './block-accessibility'

let { block }: { block: ArtifactBlockModel } = $props()

let previewOpen = $state(true)

const artifactHref = (path: string | undefined): string =>
  path ? `/api/artifacts/${encodeURIComponent(path)}` : '#'

const previewSource = $derived(
  block.kind === 'json' ? `\`\`\`json\n${block.preview}\n\`\`\`` : block.preview,
)
const panelId = $derived(getExpandablePanelId(block))
const toggleLabel = $derived(getExpandableToggleLabel(block, previewOpen))
const announcement = $derived(getBlockAnnouncement(block))

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
    class="w-full flex items-center gap-2 py-1 text-left group text-text-secondary hover:text-text-primary transition-colors"
    onclick={() => { previewOpen = !previewOpen }}
    onkeydown={handleToggleKeydown}
    aria-controls={panelId}
    aria-expanded={previewOpen}
    aria-label={toggleLabel}
  >
    {#if announcement}
      <span class="sr-only" aria-live="polite">{announcement}</span>
    {/if}
    <div class="w-4 h-4 flex items-center justify-center shrink-0 text-text-tertiary group-hover:text-text-secondary transition-colors">
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/></svg>
    </div>

    <div class="flex-1 min-w-0 flex items-baseline gap-2">
      <span class="text-[13px] truncate text-text-secondary group-hover:text-text-primary transition-colors">{block.title}</span>
      {#if block.description}
        <span class="text-[12px] text-text-tertiary opacity-80 truncate">{block.description}</span>
      {/if}
    </div>

    <div class="flex items-center gap-2.5 shrink-0">
      {#if block.path}
        <a
          class="text-[12px] opacity-0 group-hover:opacity-100 hover:text-text-primary transition-all"
          href={artifactHref(block.path)}
          target="_blank"
          rel="noreferrer"
          onclick={(e) => e.stopPropagation()}
        >
          Open
        </a>
      {/if}

      <svg
        class="w-3.5 h-3.5 shrink-0 transition-all duration-150 opacity-0 group-hover:opacity-100 {previewOpen ? 'rotate-180 opacity-50' : ''}"
        viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
      >
        <path d="M4 6l4 4 4-4"/>
      </svg>
    </div>
  </button>

  <div
    id={panelId}
    class="collapsible {previewOpen ? 'open' : ''}"
    role="region"
    aria-labelledby={`${panelId}-toggle`}
  >
    <div>
      <div class="pl-6 pr-4 pb-2">
        {#if previewOpen}
          <MarkdownHtml
            className="text-[13px] leading-relaxed block-preview"
            highlight={true}
            source={previewSource}
          />
        {/if}
      </div>
    </div>
  </div>
</div>
