<script lang="ts">
import type { ThinkingBlock as ThinkingBlockModel } from '@wonderlands/contracts/chat'
import { prepareMarkdownForRender } from '../../runtime/incomplete-markdown'
import MarkdownHtml from '../MarkdownHtml.svelte'
import {
  focusAdjacentExpandableToggle,
  getBlockAnnouncement,
  getExpandablePanelId,
  getExpandableToggleLabel,
} from './block-accessibility'

let { block }: { block: ThinkingBlockModel } = $props()

let expanded = $state(false)

const isActive = $derived(block.status === 'thinking')
const hasContent = $derived(block.content.trim().length > 0)
const markdownSource = $derived(
  prepareMarkdownForRender(block.content, block.status === 'thinking'),
)
const panelId = $derived(getExpandablePanelId(block))
const toggleLabel = $derived(getExpandableToggleLabel(block, expanded))
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
    class="sd-block-header w-full flex items-center gap-2 py-1 rounded text-left group text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
    onclick={() => { expanded = !expanded }}
    onkeydown={handleToggleKeydown}
    aria-controls={panelId}
    aria-expanded={expanded}
    aria-label={toggleLabel}
  >
    {#if announcement}
      <span class="sr-only" aria-live="polite">{announcement}</span>
    {/if}
    <div class="sd-block-icon w-4 h-4 flex items-center justify-center shrink-0 {isActive ? 'text-text-primary' : 'text-text-tertiary'} group-hover:text-text-secondary">
      {#if isActive}
        <span class="caret-blink" style="width:2px;height:12px;"></span>
      {:else}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      {/if}
    </div>

    <span class="sd-block-label flex-1 min-w-0 text-[13px] truncate {isActive ? 'text-text-primary' : 'text-text-secondary'} group-hover:text-text-primary">
      {block.title}{isActive ? '…' : ''}
    </span>

    <svg
      class="sd-block-chevron w-3.5 h-3.5 shrink-0 {expanded ? 'open' : ''}"
      viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
    >
      <path d="M4 6l4 4 4-4"/>
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
      <div class="pl-6 pr-4 pb-2">
        {#if expanded}
          {#if hasContent}
            <MarkdownHtml
              className="text-[12px] leading-relaxed block-preview"
              highlight={block.status !== 'thinking'}
              source={markdownSource}
            />
          {:else if isActive}
            <div class="flex items-center py-1 text-text-tertiary" aria-label="Waiting for reasoning output">
              <span class="caret-blink" style="width:2px;height:12px;"></span>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
</div>
