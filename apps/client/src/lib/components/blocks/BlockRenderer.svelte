<script lang="ts">
import type { Block, MessageFinishReason, MessageStatus } from '@wonderlands/contracts/chat'
import { untrack } from 'svelte'
import { logChatDebug } from '../../runtime/chat-debug'
import { typewriter } from '../../stores/typewriter.svelte'
import { typewriterPlayback } from '../../stores/typewriter-playback.svelte'
import {
  BLOCK_ENTRANCE_STAGGER_MS,
  type FadeUpParams,
  fadeUpTransition,
  GROUPING_SETTLE_MS,
} from './block-motion'
import { buildVisibleBlocks } from './block-visibility'
import DelegationBlock from './DelegationBlock.svelte'
import { buildBlockRenderItems, type RenderItem } from './render-items'
import SafeBlock from './SafeBlock.svelte'
import ToolChain from './ToolChain.svelte'
import ToolGroup from './ToolGroup.svelte'
import { shouldEnableTypewriterGate } from './typewriter-gating'

interface Props {
  blocks?: Block[]
  messageFinishReason?: MessageFinishReason | null
  isLatest?: boolean
  messageUiKey?: string
  messageStatus?: MessageStatus
}

let {
  blocks = [],
  messageFinishReason = null,
  isLatest = false,
  messageUiKey = '',
  messageStatus = 'complete',
}: Props = $props()

let completedTextIds = $state(new Set<string>())
let previousDebugSignature = $state('')
let renderedBlocks = $state.raw<Block[]>([])
let bufferedBlocks = $state.raw<Block[] | null>(null)
let groupingMode = $state<'flat' | 'settling' | 'grouped'>('grouped')
let groupingIntroActive = $state(false)
let groupingLatched = $state(false)
const getInitialGroupingMode = () => (messageStatus === 'streaming' ? 'flat' : 'grouped')

groupingMode = getInitialGroupingMode()

/** Latches true once `messageStatus` is `streaming` for this visual message row. */
const streamSeen = { current: false }
const messageWasStreaming = $derived.by(() => {
  if (messageStatus === 'streaming') {
    streamSeen.current = true
  }
  return streamSeen.current
})

/** IDs of blocks that are children of a delegation (rendered inside DelegationBlock, not top-level). */
const delegationChildIds = $derived.by(() => {
  const childRunToParent = new Map<string, string>()
  for (const block of renderedBlocks) {
    if (
      block.type === 'tool_interaction' &&
      block.name === 'delegate_to_agent' &&
      block.childRunId
    ) {
      childRunToParent.set(block.childRunId, block.id)
    }
  }
  if (childRunToParent.size === 0) return new Set<string>()
  const ids = new Set<string>()
  for (const block of renderedBlocks) {
    const src = 'sourceRunId' in block ? (block as { sourceRunId?: string }).sourceRunId : undefined
    if (src && childRunToParent.has(src) && block.id !== childRunToParent.get(src)) {
      ids.add(block.id)
    }
  }
  return ids
})

const hasRenderableTextBlocks = $derived(
  renderedBlocks.some((block) => block.type === 'text' && !delegationChildIds.has(block.id)),
)

const hasStreamingTextBlocks = $derived(
  renderedBlocks.some(
    (block) => block.type === 'text' && block.streaming && !delegationChildIds.has(block.id),
  ),
)

$effect(() => {
  if (!messageUiKey || !hasStreamingTextBlocks) {
    return
  }

  typewriterPlayback.markStreamed(messageUiKey)
})

const hasPendingPlaybackForMessage = $derived(
  !!messageUiKey && typewriterPlayback.hasPendingKey(messageUiKey),
)

$effect(() => {
  const hasIncomingReplacement = renderedBlocks !== blocks

  if (messageStatus !== 'streaming' && hasPendingPlaybackForMessage && hasIncomingReplacement) {
    const alreadyBuffered = !!bufferedBlocks
    if (!bufferedBlocks) {
      bufferedBlocks = blocks
    }
    logChatDebug('block-renderer', 'buffer:hold', {
      alreadyBuffered,
      incomingBlockIds: blocks.map((b) => b.id),
      messageUiKey,
      renderedBlockIds: renderedBlocks.map((b) => b.id),
    })
    return
  }

  const nextBlocks = bufferedBlocks ?? blocks
  if (renderedBlocks !== nextBlocks) {
    const source = bufferedBlocks ? 'flush' : 'direct'
    logChatDebug('block-renderer', `blocks:${source}`, {
      completedTextIds: [...completedTextIds],
      messageUiKey,
      newBlockIds: nextBlocks.map((b) => b.id),
      oldBlockIds: renderedBlocks.map((b) => b.id),
    })
    renderedBlocks = nextBlocks
  }

  if (!hasPendingPlaybackForMessage) {
    if (bufferedBlocks) {
      logChatDebug('block-renderer', 'buffer:clear', { messageUiKey })
    }
    bufferedBlocks = null
  }
})

/** Latches true once the durable handoff conditions are met — prevents re-typewriting
 *  when a subsequent replaceDurableMessages swaps in blocks with new IDs.
 *  Requires completedTextIds.size > 0 so the handoff cannot trigger before any
 *  typewriter animation has actually run (breaks the chicken-and-egg where
 *  hasPendingPlaybackForMessage is initially false). */
const handoffSeen = { current: false }
const isDurableTextHandoffReplay = $derived.by(() => {
  if (
    !!messageUiKey &&
    messageStatus !== 'streaming' &&
    hasRenderableTextBlocks &&
    !hasStreamingTextBlocks &&
    !hasPendingPlaybackForMessage &&
    completedTextIds.size > 0
  ) {
    if (!handoffSeen.current) {
      logChatDebug('block-renderer', 'handoff:latch', {
        completedTextIds: [...completedTextIds],
        messageUiKey,
      })
    }
    handoffSeen.current = true
  }
  return handoffSeen.current
})

const gatingActive = $derived(
  shouldEnableTypewriterGate({
    enabled: typewriter.enabled,
    finishReason: messageFinishReason,
    isDurableTextHandoffReplay,
    isLatest,
    messageWasLiveStreamed: !!messageUiKey && typewriterPlayback.hasStreamed(messageUiKey),
  }),
)

const markTextComplete = (id: string) => {
  logChatDebug('block-renderer', 'text:complete', { blockId: id, messageUiKey })
  completedTextIds = new Set([...completedTextIds, id])
}

const hasPendingTypewriter = $derived(
  gatingActive &&
    renderedBlocks.some(
      (block) =>
        block.type === 'text' &&
        !completedTextIds.has(block.id) &&
        !delegationChildIds.has(block.id),
    ),
)

$effect(() => {
  const key = messageUiKey
  const pending = hasPendingTypewriter
  if (!key) {
    return
  }

  logChatDebug('block-renderer', 'pending:sync', {
    gatingActive,
    handoffLatched: handoffSeen.current,
    isDurableTextHandoffReplay,
    messageUiKey: key,
    pending,
    renderedTextBlockIds: renderedBlocks
      .filter((b) => b.type === 'text')
      .map((b) => ({ id: b.id, completed: completedTextIds.has(b.id) })),
  })

  untrack(() => typewriterPlayback.setPending(key, pending))

  return () => {
    untrack(() => typewriterPlayback.clear(key))
  }
})

const hasDeferredTextBlocks = $derived.by(() => {
  let revealedActiveTextBlock = false

  for (const block of renderedBlocks) {
    if (
      block.type !== 'text' ||
      delegationChildIds.has(block.id) ||
      completedTextIds.has(block.id)
    ) {
      continue
    }

    if (!revealedActiveTextBlock) {
      revealedActiveTextBlock = true
      continue
    }

    return true
  }

  return false
})

const visibleBlocks = $derived.by(() =>
  buildVisibleBlocks(renderedBlocks, {
    completedTextIds,
    delegationChildIds,
    gatingActive,
  }),
)
const hasDelegations = $derived(
  visibleBlocks.some(
    (block) =>
      block.type === 'tool_interaction' && block.name === 'delegate_to_agent' && block.childRunId,
  ),
)

/** Groups blocks into delegations, chains, and individual blocks. */
const flatRenderItems = $derived.by(() =>
  buildBlockRenderItems(visibleBlocks, { groupingEnabled: false }),
)
const groupedRenderItems = $derived.by(() =>
  buildBlockRenderItems(visibleBlocks, { groupingEnabled: true }),
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

const isGroupingExitItem = (item: RenderItem): boolean =>
  groupingMode === 'settling' && item.kind === 'block' && absorbedGroupedBlockIds.has(item.block.id)

/** Matches `fade-up` in app.css — runs on intro only for keyed {#each} rows.
 *  Skipped when the message is no longer streaming to avoid a flash when
 *  `refreshThreadMessages` replaces the message array with new objects. */
function fadeUp(node: Element, params: FadeUpParams = {}) {
  if (messageStatus !== 'streaming' && !groupingIntroActive) {
    return { duration: 0, css: () => '' }
  }
  return fadeUpTransition(node, params)
}

// Trailing thinking indicator: shown when the message is streaming but the
// last visible block is NOT actively producing content. This bridges the gap
// between finished text → incoming tool call, or tool result → next text, etc.
const showTrailingActivity = $derived.by(() => {
  if (messageStatus !== 'streaming') return false
  if (visibleBlocks.length === 0) return false
  if (hasDeferredTextBlocks) return false

  const last = visibleBlocks[visibleBlocks.length - 1]

  if (last.type === 'text') return false
  if (last.type === 'thinking' && last.status === 'thinking') return false
  if (
    last.type === 'tool_interaction' &&
    (last.status === 'running' || last.status === 'awaiting_confirmation')
  ) {
    return false
  }
  if (
    last.type === 'web_search' &&
    (last.status === 'in_progress' || last.status === 'searching')
  ) {
    return false
  }

  if (hasDelegations) {
    const hasActiveChild = visibleBlocks.some(
      (b) =>
        b.type === 'tool_interaction' &&
        (b.status === 'running' || b.status === 'awaiting_confirmation'),
    )
    if (hasActiveChild) return false
  }

  return true
})

$effect(() => {
  const signature = [
    messageUiKey,
    messageStatus,
    isLatest ? '1' : '0',
    messageWasStreaming ? '1' : '0',
    gatingActive ? '1' : '0',
    renderedBlocks.length,
  ].join(':')

  if (signature === previousDebugSignature) {
    return
  }

  previousDebugSignature = signature
  logChatDebug('block-renderer', 'state', {
    blockIds: renderedBlocks.map((block) => block.id),
    blockTypes: renderedBlocks.map((block) => block.type),
    bufferedBlockTypes: bufferedBlocks?.map((block) => block.type) ?? null,
    completedTextIds: [...completedTextIds],
    gatingActive,
    handoffLatched: handoffSeen.current,
    hasPendingPlaybackForMessage,
    hasPendingTypewriter,
    isDurableTextHandoffReplay,
    isLatest,
    messageFinishReason,
    messageStatus,
    messageUiKey,
    messageWasStreaming,
    streamSeen: streamSeen.current,
    visibleBlockTypes: visibleBlocks.map((block) => block.type),
  })
})
</script>

{#if renderedBlocks.length === 0 && messageStatus === 'streaming'}
  <div
    class="flex items-center py-2 text-text-tertiary text-[13px]"
    aria-label="Waiting for response"
    aria-live="polite"
    role="status"
  >
    <span class="caret-blink"></span>
  </div>
{:else}
  <div class="flex flex-col">
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
          class={item.block.type === 'text' ? 'py-1.5' : ''}
          class:grouping-settle-exit={isGroupingExitItem(item)}
          in:fadeUp={{ delay: index * BLOCK_ENTRANCE_STAGGER_MS }}
        >
          <SafeBlock
            block={item.block}
            {isLatest}
            {messageStatus}
            shouldTypewrite={gatingActive}
            oncomplete={() => markTextComplete(item.block.id)}
          />
        </div>
      {/if}
    {/each}

    {#if showTrailingActivity}
      <div
        class="flex items-center py-1.5 text-text-tertiary text-[13px]"
        aria-label="Waiting for response"
        aria-live="polite"
        role="status"
        style="animation: fade-up 180ms ease both;"
      >
        <span class="caret-blink"></span>
      </div>
    {/if}
  </div>
{/if}
