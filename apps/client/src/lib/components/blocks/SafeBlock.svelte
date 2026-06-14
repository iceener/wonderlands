<script lang="ts">
import type { Block, MessageStatus } from '@wonderlands/contracts/chat'
import ArtifactBlock from './ArtifactBlock.svelte'
import { getBlockRenderErrorMessage } from './block-accessibility'
import ErrorBlock from './ErrorBlock.svelte'
import TextBlock from './TextBlock.svelte'
import ThinkingBlock from './ThinkingBlock.svelte'
import ToolBlock from './ToolBlock.svelte'
import WebSearchBlock from './WebSearchBlock.svelte'

interface Props {
  block: Block
  isLatest?: boolean
  messageStatus?: MessageStatus
  shouldTypewrite?: boolean
  oncomplete?: () => void
}

let {
  block,
  isLatest = false,
  messageStatus = 'complete',
  shouldTypewrite = false,
  oncomplete,
}: Props = $props()

const logBlockRenderError = (error: unknown) => {
  console.error('[05_04_ui] block render failed', {
    blockId: block.id,
    blockType: block.type,
    error,
  })
}
</script>

{#snippet renderFailure(_error: unknown, reset: () => void)}
  <ErrorBlock
    message={getBlockRenderErrorMessage(block)}
    action={{ label: 'Retry', onclick: () => reset() }}
  />
{/snippet}

<svelte:boundary failed={renderFailure} onerror={logBlockRenderError}>
  {#if block.type === 'text'}
    <TextBlock
      {block}
      {isLatest}
      {messageStatus}
      {shouldTypewrite}
      {oncomplete}
    />
  {:else if block.type === 'thinking'}
    <ThinkingBlock {block} />
  {:else if block.type === 'tool_interaction'}
    <ToolBlock {block} />
  {:else if block.type === 'web_search'}
    <WebSearchBlock {block} />
  {:else if block.type === 'artifact'}
    <ArtifactBlock {block} />
  {:else if block.type === 'error'}
    <ErrorBlock {block} />
  {/if}
</svelte:boundary>
