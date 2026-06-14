<script lang="ts">
import type { Block, MessageStatus, ToolInteractionBlock } from '@wonderlands/contracts/chat'
import {
  BLOCK_ENTRANCE_STAGGER_MS,
  type FadeUpParams,
  fadeUpTransition,
  GROUPING_SETTLE_MS,
} from './block-motion'
import DelegationBlock from './DelegationBlock.svelte'
import { type DelegationStatus, getDelegationStatus, isReplyWaitBlock } from './delegation-state'
import { buildBlockRenderItems, type RenderItem } from './render-items'
import SafeBlock from './SafeBlock.svelte'
import ToolChain from './ToolChain.svelte'
import ToolGroup from './ToolGroup.svelte'

interface Props {
  parent: ToolInteractionBlock
  children: Block[]
  messageStatus?: MessageStatus
}

let { parent, children, messageStatus = 'complete' }: Props = $props()

let expanded = $state<boolean | null>(null)
let groupingMode = $state<'flat' | 'settling' | 'grouped'>('grouped')
let groupingIntroActive = $state(false)
let groupingLatched = $state(false)
const streamSeen = { current: false }
const messageWasStreaming = $derived.by(() => {
  if (messageStatus === 'streaming') {
    streamSeen.current = true
  }
  return streamSeen.current
})
const getInitialGroupingMode = () => (messageStatus === 'streaming' ? 'flat' : 'grouped')

groupingMode = getInitialGroupingMode()

const hasAppViewChild = $derived(
  children.some(
    (child) =>
      child.type === 'tool_interaction' &&
      Boolean((child as ToolInteractionBlock).appsMeta?.resourceUri),
  ),
)

const hasImageOutputChild = $derived(
  children.some(
    (child) =>
      child.type === 'tool_interaction' &&
      (child as ToolInteractionBlock).name === 'generate_image' &&
      (child as ToolInteractionBlock).status === 'complete' &&
      (child as ToolInteractionBlock).output != null &&
      typeof (child as ToolInteractionBlock).output === 'object' &&
      typeof ((child as ToolInteractionBlock).output as Record<string, unknown>).imageCount ===
        'number',
  ),
)

const agentAlias = $derived(
  typeof parent.args?.agentAlias === 'string' ? parent.args.agentAlias : 'agent',
)

const delegationStatus = $derived.by((): DelegationStatus => getDelegationStatus(parent, children))

const waitingForReply = $derived(
  delegationStatus === 'suspended' &&
    (isReplyWaitBlock(parent) || children.some((child) => isReplyWaitBlock(child))),
)

const isOpen = $derived(
  expanded ??
    (delegationStatus === 'running' ||
      delegationStatus === 'failed' ||
      delegationStatus === 'awaiting' ||
      delegationStatus === 'suspended' ||
      hasAppViewChild ||
      hasImageOutputChild),
)

const toolCount = $derived(children.filter((child) => child.type === 'tool_interaction').length)

const durationLabel = $derived.by((): string | null => {
  if (parent.status !== 'complete' || !parent.finishedAt) return null
  const start = Date.parse(parent.createdAt)
  const end = Date.parse(parent.finishedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  const ms = Math.max(0, end - start)
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
})

const taskLabel = $derived(
  typeof parent.args?.task === 'string' && parent.args.task.length > 0
    ? parent.args.task.length > 60
      ? `${parent.args.task.slice(0, 57)}…`
      : parent.args.task
    : null,
)

const metaLabel = $derived.by((): string => {
  const parts: string[] = []
  if (delegationStatus === 'running') parts.push('Running')
  else if (delegationStatus === 'pending') parts.push('Pending')
  else if (delegationStatus === 'awaiting') parts.push('Waiting')
  else if (delegationStatus === 'suspended')
    parts.push(waitingForReply ? 'Waiting for reply' : 'Suspended')
  else if (delegationStatus === 'completed') parts.push('Completed')
  else if (delegationStatus === 'failed') parts.push('Failed')

  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount > 1 ? 's' : ''}`)
  if (durationLabel) parts.push(durationLabel)
  return parts.join(' · ')
})

const accentClass = $derived.by((): string => {
  switch (delegationStatus) {
    case 'pending':
      return 'deleg-pending'
    case 'running':
      return 'deleg-running'
    case 'awaiting':
      return 'deleg-awaiting'
    case 'suspended':
      return 'deleg-suspended'
    case 'failed':
      return 'deleg-failed'
    default:
      return 'deleg-completed'
  }
})

const resultSummary = $derived.by((): string | null => {
  if (!parent.output || typeof parent.output !== 'object' || Array.isArray(parent.output)) {
    return null
  }

  const candidate = parent.output as {
    error?: unknown
    kind?: unknown
    summary?: unknown
  }

  if (typeof candidate.summary === 'string' && candidate.summary.trim().length > 0) {
    return candidate.summary.trim()
  }

  if (
    candidate.kind === 'failed' &&
    typeof candidate.error === 'string' &&
    candidate.error.trim()
  ) {
    return candidate.error.trim()
  }

  return null
})

const flatRenderItems = $derived.by(() =>
  buildBlockRenderItems(children, { groupingEnabled: false }),
)
const groupedRenderItems = $derived.by(() =>
  buildBlockRenderItems(children, { groupingEnabled: true }),
)
const hasTerminalGrouping = $derived(
  groupedRenderItems.some((item) => item.kind === 'chain' || item.kind === 'tool_group'),
)
const absorbedGroupedBlockIds = $derived.by(() => {
  const ids = new Set<string>()

  for (const item of groupedRenderItems) {
    if (item.kind === 'chain' || item.kind === 'tool_group') {
      for (const block of item.blocks) {
        ids.add(block.id)
      }
    }
  }

  return ids
})
const renderItems = $derived.by(() =>
  groupingMode === 'grouped' ? groupedRenderItems : flatRenderItems,
)

$effect(() => {
  if (messageStatus === 'streaming') {
    groupingIntroActive = false
    if (!groupingLatched) {
      groupingMode = 'flat'
    }
    return
  }

  if (!messageWasStreaming) {
    groupingMode = 'grouped'
    groupingIntroActive = false
    return
  }

  if (!hasTerminalGrouping) {
    if (groupingMode !== 'settling') {
      groupingMode = 'flat'
    }
    return
  }

  if (groupingMode === 'flat') {
    groupingMode = 'settling'
  }
})

$effect(() => {
  if (groupingMode === 'grouped' && hasTerminalGrouping) {
    groupingLatched = true
  }
})

$effect(() => {
  if (groupingMode !== 'settling') {
    return
  }

  const timerId = setTimeout(() => {
    groupingMode = 'grouped'
    groupingIntroActive = true
  }, GROUPING_SETTLE_MS)

  return () => clearTimeout(timerId)
})

$effect(() => {
  if (!groupingIntroActive) {
    return
  }

  const frameId = requestAnimationFrame(() => {
    groupingIntroActive = false
  })

  return () => cancelAnimationFrame(frameId)
})

const toggle = () => {
  expanded = !isOpen
}

const isGroupingExitItem = (item: RenderItem): boolean =>
  groupingMode === 'settling' && item.kind === 'block' && absorbedGroupedBlockIds.has(item.block.id)

function fadeUp(node: Element, params: FadeUpParams = {}) {
  if ((messageStatus !== 'streaming' && !groupingIntroActive) || !isOpen) {
    return { duration: 0, css: () => '' }
  }

  return fadeUpTransition(node, params)
}
</script>

<div class="deleg-accent {accentClass}">
  <button
    type="button"
    class="deleg-header"
    onclick={toggle}
  >
    <div class="deleg-icon {delegationStatus === 'failed' ? 'text-danger-text' : delegationStatus === 'running' || delegationStatus === 'awaiting' ? 'text-text-primary' : 'text-text-tertiary'}">
      {#if delegationStatus === 'failed'}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      {:else if delegationStatus === 'pending'}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
        </svg>
      {:else if delegationStatus === 'running' || delegationStatus === 'awaiting'}
        <span class="caret-blink" style="width:2px;height:12px;" aria-hidden="true"></span>
      {:else if delegationStatus === 'suspended'}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
          <path d="M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
        </svg>
      {:else}
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      {/if}
    </div>
    <span class="deleg-name">{agentAlias}</span>
    {#if taskLabel && delegationStatus !== 'completed'}
      <span class="deleg-task">{taskLabel}</span>
    {/if}
    <span class="deleg-meta">{metaLabel}</span>
    {#if children.length > 0}
      <svg
        class="deleg-chevron {isOpen ? 'open' : ''}"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M4 6l4 4 4-4" />
      </svg>
    {/if}
  </button>

  {#if children.length > 0}
    <div class="collapsible {isOpen ? 'open' : ''}">
      <div>
        <div class="deleg-children">
          {#each renderItems as item, index (item.id)}
            {#if item.kind === 'chain'}
              <div in:fadeUp={{ delay: index * BLOCK_ENTRANCE_STAGGER_MS }}>
                <ToolChain blocks={item.blocks} />
              </div>
            {:else if item.kind === 'tool_group'}
              <div in:fadeUp={{ delay: index * BLOCK_ENTRANCE_STAGGER_MS }}>
                <ToolGroup blocks={item.blocks} {messageStatus} />
              </div>
            {:else if item.kind === 'delegation'}
              <div in:fadeUp={{ delay: index * BLOCK_ENTRANCE_STAGGER_MS }}>
                <DelegationBlock parent={item.parent} children={item.children} {messageStatus} />
              </div>
            {:else}
              <div
                class:grouping-settle-exit={isGroupingExitItem(item)}
                in:fadeUp={{ delay: index * BLOCK_ENTRANCE_STAGGER_MS }}
              >
                <SafeBlock block={item.block} messageStatus={messageStatus} />
              </div>
            {/if}
          {/each}
        </div>
      </div>
    </div>
  {/if}

  {#if resultSummary && isOpen}
    <div class="deleg-summary">{resultSummary}</div>
  {/if}
</div>

<style>
  .deleg-accent {
    border-left: 2px solid var(--color-border-strong);
    padding-left: 12px;
    margin: 4px 0 4px 7px;
    transition: border-color 300ms;
  }

  .deleg-running {
    border-color: var(--color-accent);
  }

  .deleg-pending {
    border-color: var(--color-border-strong);
    opacity: 0.5;
    transition: opacity 200ms ease, border-color 300ms ease;
  }

  .deleg-awaiting {
    border-color: var(--color-accent);
  }

  .deleg-suspended {
    border-color: var(--color-border-strong);
  }

  .deleg-completed {
    border-color: var(--color-text-tertiary);
    opacity: 0.75;
    transition: opacity 200ms ease, border-color 300ms ease;
  }

  .deleg-completed:hover {
    opacity: 1;
  }

  .deleg-failed {
    border-color: var(--color-danger-text);
  }

  .deleg-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    background: none;
    border: none;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: color var(--motion-hover-ms) ease;
  }

  .deleg-header:hover {
    color: var(--color-text-primary);
  }

  .deleg-header:hover .deleg-name {
    color: var(--color-text-primary);
  }

  .deleg-header:hover .deleg-chevron {
    opacity: 1;
  }

  .deleg-icon {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: color 200ms ease;
  }

  .deleg-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-secondary);
    transition: color var(--motion-hover-ms) ease;
  }

  .deleg-task {
    font-size: 12px;
    color: var(--color-text-tertiary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .deleg-meta {
    font-size: 11px;
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }

  .deleg-chevron {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    opacity: 0;
    transition:
      opacity var(--motion-hover-ms) ease,
      transform var(--motion-chevron-ms) cubic-bezier(0.2, 0, 0, 1);
    margin-left: auto;
  }

  .deleg-chevron.open {
    opacity: 0.5;
    transform: rotate(180deg);
  }

  .deleg-children {
    padding: 0 0 4px 0;
  }

  .deleg-summary {
    padding: 2px 0 0 24px;
    color: var(--color-text-secondary);
    font-size: 13px;
    line-height: 1.55;
    white-space: pre-wrap;
  }
</style>
