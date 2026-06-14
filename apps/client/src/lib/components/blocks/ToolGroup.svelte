<script lang="ts">
import type { MessageStatus, ToolInteractionBlock } from '@wonderlands/contracts/chat'
import SafeBlock from './SafeBlock.svelte'

interface Props {
  blocks: ToolInteractionBlock[]
  messageStatus?: MessageStatus
}

let { blocks, messageStatus = 'complete' }: Props = $props()

let expanded = $state(false)

const groupName = $derived(blocks[0]?.name ?? 'tool')
const countLabel = $derived(`${blocks.length} call${blocks.length === 1 ? '' : 's'}`)
</script>

<div class="tool-group">
  <button
    type="button"
    class="tool-group-header"
    onclick={() => {
      expanded = !expanded
    }}
    aria-expanded={expanded}
  >
    <div class="tool-group-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
    </div>
    <span class="tool-group-label">{groupName}</span>
    <span class="tool-group-count">{countLabel}</span>
    <svg
      class="tool-group-chevron {expanded ? 'open' : ''}"
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

  <div class="collapsible {expanded ? 'open' : ''}">
    <div>
      <div class="tool-group-children">
        {#each blocks as block (block.id)}
          <SafeBlock {block} {messageStatus} />
        {/each}
      </div>
    </div>
  </div>
</div>
