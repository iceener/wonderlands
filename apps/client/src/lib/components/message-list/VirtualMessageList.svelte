<script lang="ts">
import { onMount, tick, untrack } from 'svelte'
import { fly } from 'svelte/transition'
import type { UiMessage } from '../../chat/types'
import { logChatDebug, registerChatDebugSnapshot } from '../../runtime/chat-debug'
import {
  createMessageHeightEstimator,
  describeMessageHeightEstimate,
  type HeightEstimateFallbackSurface,
} from '../../runtime/message-height-estimator'
import { createScrollController } from '../../runtime/scroll-controller'
import { getMessageNavigatorContext } from '../../stores/message-navigator.svelte'
import EmptyState from './EmptyState.svelte'
import MessageCard from './MessageCard.svelte'
import { getMessageListSurface } from './message-list-state'

const IS_DEV = import.meta.env.DEV
const CHUNK_SIZE = 12
const OVERSCAN_CHUNKS = 3
const DEFAULT_MESSAGE_HEIGHT = 220
const DEFAULT_ESTIMATE_WIDTH = 728
const HEIGHT_ESTIMATE_DELTA_LOG_THRESHOLD = 32
const PIN_RELEASE_DISTANCE = 80
const PIN_REACQUIRE_DISTANCE = 4
const SCROLL_TO_BOTTOM_BUTTON_DELAY_MS = 180

interface Props {
  initialHydrationPending?: boolean
  messages?: readonly Readonly<UiMessage>[]
  streamPulse?: number
  isLoading?: boolean
  /** Increment in parent to pin to bottom and jump scroll (submit, restart). */
  pinToBottomToken?: number
}

let {
  initialHydrationPending = false,
  messages = [],
  streamPulse = 0,
  isLoading = false,
  pinToBottomToken = 0,
}: Props = $props()

const messageNavigator = getMessageNavigatorContext()

let viewport: HTMLDivElement | null = $state(null)
let content: HTMLDivElement | null = $state(null)
let estimatedMessageWidth = $state(DEFAULT_ESTIMATE_WIDTH)
const scrollState = $state({
  pinnedToBottom: true,
  scrollTop: 0,
  viewportHeight: 0,
})
let chunkHeights = $state(new Map<number, number>())

let scrollDebugEnabled = false
let heightEstimateDebugEnabled = false
let previousLayoutDebugKey = ''
let lastHandledPinToBottomToken = 0
let previousChunkEstimateLogKeys = new Map<number, string>()
let previousMessageRenderDebugKey = ''
let seenMessageUiKeys = $state.raw(new Set<string>())
let pendingIntroMessageUiKeys = $state.raw(new Set<string>())
let consumedIntroMessageUiKeys = $state.raw(new Set<string>())

let previousFirstMessageId = ''
let previousMessageCount = 0
let previousEstimatedMessageWidth = DEFAULT_ESTIMATE_WIDTH
let showScrollToBottomButton = $state(false)
const messageHeightEstimator = createMessageHeightEstimator()

type MessageChunk = {
  index: number
  messages: UiMessage[]
  startIndex: number
}

type ChunkMetric = MessageChunk & {
  endOffset: number
  height: number
  startOffset: number
}

type ChunkHeightEstimateDebugSummary = {
  fallbackMessageCount: number
  fallbackSurfaces: HeightEstimateFallbackSurface[]
  messageCount: number
  messages: {
    fallbackSurfaces: HeightEstimateFallbackSurface[]
    id: string
    role: UiMessage['role']
    usesFallback: boolean
  }[]
  predictedHeight: number
}

const chunks = $derived.by(() => {
  const result: MessageChunk[] = []

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    result.push({
      index: result.length,
      messages: messages.slice(i, i + CHUNK_SIZE),
      startIndex: i,
    })
  }

  return result
})

const lastChunkIndex = $derived(chunks.length - 1)

const latestAssistantMessageId = $derived.by(() => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant') {
      return messages[i].id
    }
  }

  return null
})

const uniqueFallbackSurfaces = (
  surfaces: readonly HeightEstimateFallbackSurface[],
): HeightEstimateFallbackSurface[] => Array.from(new Set(surfaces))

const summarizeChunkHeightEstimate = (messages: UiMessage[]): ChunkHeightEstimateDebugSummary => {
  const messageSummaries = messages.map((message) => {
    const profile = describeMessageHeightEstimate(message)
    return {
      id: message.id,
      role: message.role,
      usesFallback: profile.usesFallback,
      fallbackSurfaces: profile.fallbackSurfaces,
    }
  })

  return {
    predictedHeight: Math.max(
      messages.reduce(
        (sum, message) =>
          sum + messageHeightEstimator.estimateMessageHeight(message, estimatedMessageWidth),
        0,
      ),
      messages.length * 48,
    ),
    messageCount: messageSummaries.length,
    fallbackMessageCount: messageSummaries.filter((message) => message.usesFallback).length,
    fallbackSurfaces: uniqueFallbackSurfaces(
      messageSummaries.flatMap((message) => message.fallbackSurfaces),
    ),
    messages: messageSummaries,
  }
}

const estimateChunkHeight = (messages: UiMessage[]): number =>
  summarizeChunkHeightEstimate(messages).predictedHeight

const logHeightEstimateMeasurement = (chunkIndex: number, measuredHeight: number) => {
  if (!IS_DEV || typeof window === 'undefined') {
    return
  }

  untrack(() => {
    if (!heightEstimateDebugEnabled) {
      return
    }

    const chunk = chunks[chunkIndex]
    if (!chunk) {
      return
    }

    const summary = summarizeChunkHeightEstimate(chunk.messages)
    const delta = measuredHeight - summary.predictedHeight
    const absDelta = Math.abs(delta)
    const shouldLog =
      absDelta >= HEIGHT_ESTIMATE_DELTA_LOG_THRESHOLD || summary.fallbackSurfaces.length > 0

    if (!shouldLog) {
      return
    }

    const logKey = [
      chunk.messages.map((message) => message.id).join(','),
      measuredHeight,
      summary.predictedHeight,
      Math.round(estimatedMessageWidth),
      summary.fallbackSurfaces.join(','),
    ].join(':')

    if (previousChunkEstimateLogKeys.get(chunkIndex) === logKey) {
      return
    }

    previousChunkEstimateLogKeys.set(chunkIndex, logKey)

    console.log('[height-estimate] chunk measurement', {
      chunkIndex,
      messageCount: summary.messageCount,
      fallbackMessageCount: summary.fallbackMessageCount,
      fallbackSurfaces: summary.fallbackSurfaces,
      predictedHeight: summary.predictedHeight,
      measuredHeight,
      delta,
      absDelta,
      estimatedMessageWidth: Math.round(estimatedMessageWidth),
      messages: summary.messages,
    })
  })
}

const chunkMetrics = $derived.by(() => {
  let offset = 0
  const metrics: ChunkMetric[] = []

  for (const chunk of chunks) {
    const estimatedHeight = chunkHeights.get(chunk.index) ?? estimateChunkHeight(chunk.messages)

    metrics.push({
      ...chunk,
      startOffset: offset,
      height: estimatedHeight,
      endOffset: offset + estimatedHeight,
    })

    offset += estimatedHeight
  }

  return metrics
})

const getMessageUiKey = (message: Pick<UiMessage, 'id' | 'uiKey'>): string =>
  message.uiKey ?? message.id

const shouldAnimateMessageIntro = (message: Pick<UiMessage, 'id' | 'uiKey'>): boolean => {
  const messageUiKey = getMessageUiKey(message)
  return (
    pendingIntroMessageUiKeys.has(messageUiKey) && !consumedIntroMessageUiKeys.has(messageUiKey)
  )
}

const consumeMessageIntro = (_node: HTMLDivElement, messageUiKey: string) => {
  if (
    !pendingIntroMessageUiKeys.has(messageUiKey) ||
    consumedIntroMessageUiKeys.has(messageUiKey)
  ) {
    return {}
  }

  consumedIntroMessageUiKeys = new Set([...consumedIntroMessageUiKeys, messageUiKey])

  requestAnimationFrame(() => {
    if (!pendingIntroMessageUiKeys.has(messageUiKey)) {
      return
    }

    const nextPending = new Set(pendingIntroMessageUiKeys)
    nextPending.delete(messageUiKey)
    pendingIntroMessageUiKeys = nextPending
  })

  return {}
}

const totalHeight = $derived(
  chunkMetrics.length > 0 ? chunkMetrics[chunkMetrics.length - 1].endOffset : 0,
)

const visibleRange = $derived.by(() => {
  if (chunkMetrics.length === 0) {
    return { start: 0, end: 0 }
  }

  if (scrollState.pinnedToBottom) {
    const targetTop = Math.max(0, totalHeight - Math.max(scrollState.viewportHeight, 1))
    let start = chunkMetrics.length - 1

    while (start > 0 && chunkMetrics[start].startOffset > targetTop) {
      start -= 1
    }

    return {
      start: Math.max(0, start - OVERSCAN_CHUNKS),
      end: chunkMetrics.length,
    }
  }

  const top = scrollState.scrollTop
  const bottom = scrollState.scrollTop + Math.max(scrollState.viewportHeight, 1)

  let start = 0
  while (start < chunkMetrics.length && chunkMetrics[start].endOffset < top) {
    start += 1
  }

  let end = start
  while (end < chunkMetrics.length && chunkMetrics[end].startOffset <= bottom) {
    end += 1
  }

  const rangeStart = Math.max(0, start - OVERSCAN_CHUNKS)
  const naturalEnd = Math.min(chunkMetrics.length, Math.max(end + OVERSCAN_CHUNKS, start + 1))

  const nearTail = chunkMetrics.length - naturalEnd <= OVERSCAN_CHUNKS
  const rangeEnd = nearTail ? chunkMetrics.length : naturalEnd

  return { start: rangeStart, end: rangeEnd }
})

const renderedChunks = $derived(chunkMetrics.slice(visibleRange.start, visibleRange.end))

const topSpacerHeight = $derived(renderedChunks.length > 0 ? renderedChunks[0].startOffset : 0)
const listSurface = $derived(
  getMessageListSurface({
    initialHydrationPending,
    isLoading,
    messageCount: messages.length,
  }),
)

const bottomSpacerHeight = $derived.by(() => {
  if (scrollState.pinnedToBottom || renderedChunks.length === 0) return 0
  const lastRendered = renderedChunks[renderedChunks.length - 1]
  return Math.max(0, totalHeight - lastRendered.endOffset)
})

let scrollController: ReturnType<typeof createScrollController> | null = null
let scrollToBottomButtonTimer: ReturnType<typeof setTimeout> | null = null

const getScrollSnapshot = (): Record<string, number | boolean | null> => {
  const now = performance.now()
  const timing = scrollController?.getTimingState()

  return {
    atMs: Math.round(now),
    messages: messages.length,
    pinnedToBottom: scrollState.pinnedToBottom,
    scrollTop: Math.round(scrollState.scrollTop),
    viewportScrollTop: viewport ? Math.round(viewport.scrollTop) : null,
    viewportHeight: Math.round(scrollState.viewportHeight),
    viewportClientHeight: viewport ? Math.round(viewport.clientHeight) : null,
    viewportScrollHeight: viewport ? Math.round(viewport.scrollHeight) : null,
    totalHeight: Math.round(totalHeight),
    topSpacerHeight: Math.round(topSpacerHeight),
    bottomSpacerHeight: Math.round(bottomSpacerHeight),
    visibleRangeStart: visibleRange.start,
    visibleRangeEnd: visibleRange.end,
    renderedChunkStart: renderedChunks[0]?.index ?? null,
    renderedChunkEnd: renderedChunks[renderedChunks.length - 1]?.index ?? null,
    renderedChunkCount: renderedChunks.length,
    lastChunkIndex,
    scrollGuardForMs: Math.max(0, Math.round((timing?.scrollGuardUntil ?? 0) - now)),
    bottomLockForMs: Math.max(0, Math.round((timing?.bottomLockUntil ?? 0) - now)),
  }
}

const logScroll = (event: string, extra: Record<string, unknown> = {}) => {
  if (!IS_DEV || typeof window === 'undefined') {
    return
  }

  untrack(() => {
    if (!scrollDebugEnabled) {
      return
    }

    console.log(`[scroll] ${event}`, {
      ...getScrollSnapshot(),
      ...extra,
    })
  })
}

scrollController = createScrollController({
  state: scrollState,
  defaultMessageHeight: DEFAULT_MESSAGE_HEIGHT,
  getChunkHeights: () => chunkHeights,
  setChunkHeights: (next) => {
    chunkHeights = next
  },
  getChunkMetric: (chunkIndex) => chunkMetrics[chunkIndex],
  getTotalHeight: () => totalHeight,
  getViewport: () => viewport,
  log: logScroll,
  pinReacquireDistance: PIN_REACQUIRE_DISTANCE,
  pinReleaseDistance: PIN_RELEASE_DISTANCE,
})

const measureChunk = (node: HTMLDivElement, chunkIndex: number) => {
  const measure = () => {
    const measuredHeight = Math.ceil(node.getBoundingClientRect().height)
    scrollController?.updateChunkHeight(chunkIndex, measuredHeight)
    logHeightEstimateMeasurement(chunkIndex, measuredHeight)
  }

  measure()

  const observer = new ResizeObserver(() => {
    measure()
  })

  observer.observe(node)

  return {
    destroy() {
      observer.disconnect()
    },
  }
}

const handleViewportScroll = () => {
  scrollController?.handleScroll()
}

const clearScrollToBottomButtonTimer = () => {
  if (scrollToBottomButtonTimer == null) {
    return
  }

  clearTimeout(scrollToBottomButtonTimer)
  scrollToBottomButtonTimer = null
}

const syncEstimatedMessageWidth = () => {
  const viewportWidth = viewport?.clientWidth ?? 0
  const contentWidth = content?.clientWidth ?? Math.min(viewportWidth, 808)
  const innerWidth =
    contentWidth > 0 ? contentWidth - 40 : Math.min(Math.max(viewportWidth - 40, 0), 768)

  estimatedMessageWidth = Math.max(280, innerWidth || DEFAULT_ESTIMATE_WIDTH)
}

const runJumpToBottom = async () => {
  if (!scrollController) {
    return
  }

  await scrollController.jumpToBottom({
    awaitTick: tick,
    schedule: (task) => {
      requestAnimationFrame(task)
    },
  })
}

// Parent-driven pin (after send / restart): stay pinned and follow stream until user scrolls away.
$effect(() => {
  const token = pinToBottomToken
  if (token === 0 || token === lastHandledPinToBottomToken) return

  lastHandledPinToBottomToken = token
  logScroll('pinToBottomToken', { token })
  untrack(() => {
    void runJumpToBottom()
  })
})

// Watchdog: any store update while pinned scrolls to bottom once.
$effect(() => {
  const pulse = streamPulse
  if (pulse === 0) return

  const shouldFollow = untrack(() => scrollState.pinnedToBottom && !!viewport)
  if (!shouldFollow) return

  scrollController?.followStreamPulse((task) => {
    requestAnimationFrame(task)
  })
})

// Primary bottom-follow: when content resizes (streaming text grows,
// new chunks mount), scroll to bottom if pinned. No rAF loop needed.
$effect(() => {
  if (!content) return

  const ro = new ResizeObserver(() => {
    syncEstimatedMessageWidth()
    scrollController?.handleContentResize()
  })

  ro.observe(content)
  return () => ro.disconnect()
})

$effect(() => {
  if (!viewport) return

  scrollController?.syncViewportHeight()
  syncEstimatedMessageWidth()

  const ro = new ResizeObserver(() => {
    scrollController?.syncViewportHeight()
    syncEstimatedMessageWidth()
  })

  ro.observe(viewport)
  return () => ro.disconnect()
})

$effect(() => {
  const firstMessageId = messages[0]?.id ?? ''
  const currentCount = messages.length
  const currentMessageUiKeys = messages.map((message) => getMessageUiKey(message))

  if (firstMessageId !== previousFirstMessageId || currentCount < previousMessageCount) {
    chunkHeights = new Map()
    previousChunkEstimateLogKeys = new Map()
    scrollState.scrollTop = 0
    seenMessageUiKeys = new Set(currentMessageUiKeys)
    pendingIntroMessageUiKeys = new Set()
    consumedIntroMessageUiKeys = new Set()
    logScroll('resetChunkHeights', {
      firstMessageId,
      previousFirstMessageId,
      currentCount,
      previousMessageCount,
    })
  } else {
    const nextSeen = new Set(seenMessageUiKeys)
    const nextPending = new Set<string>()

    for (const message of messages) {
      const messageUiKey = getMessageUiKey(message)
      if (nextSeen.has(messageUiKey)) {
        continue
      }

      nextSeen.add(messageUiKey)
      nextPending.add(messageUiKey)
    }

    if (nextPending.size > 0) {
      seenMessageUiKeys = nextSeen
      pendingIntroMessageUiKeys = nextPending
      consumedIntroMessageUiKeys = new Set()
    }
  }

  previousFirstMessageId = firstMessageId
  previousMessageCount = currentCount
})

$effect(() => {
  const nextEstimatedMessageWidth = estimatedMessageWidth

  if (Math.abs(nextEstimatedMessageWidth - previousEstimatedMessageWidth) <= 1) {
    return
  }

  previousEstimatedMessageWidth = nextEstimatedMessageWidth
  chunkHeights = new Map()
  previousChunkEstimateLogKeys = new Map()
  logScroll('resetChunkHeightsForWidthChange', {
    estimatedMessageWidth: Math.round(nextEstimatedMessageWidth),
  })
})

onMount(() => {
  const unregisterChatListSnapshot = registerChatDebugSnapshot('list', () => ({
    latestAssistantMessageId,
    messageCount: messages.length,
    rows: messages.map((message) => ({
      id: message.id,
      role: message.role,
      runId: message.runId,
      status: message.status,
      uiKey: message.uiKey ?? message.id,
    })),
  }))

  if (IS_DEV && typeof window !== 'undefined') {
    const globalWindow = window as unknown as Record<string, unknown>

    globalWindow.__scrollSnapshot = () => {
      console.log('[scroll] manual snapshot', getScrollSnapshot())
    }
    globalWindow.__scrollDebugOn = () => {
      scrollDebugEnabled = true
      console.log('[scroll] debug on')
    }
    globalWindow.__scrollDebugOff = () => {
      scrollDebugEnabled = false
      console.log('[scroll] debug off')
    }
    globalWindow.__heightEstimateSnapshot = () => {
      console.log(
        '[height-estimate] snapshot',
        chunks.map((chunk) => ({
          chunkIndex: chunk.index,
          ...summarizeChunkHeightEstimate(chunk.messages),
        })),
      )
    }
    globalWindow.__heightEstimateDebugOn = () => {
      heightEstimateDebugEnabled = true
      console.log('[height-estimate] debug on')
    }
    globalWindow.__heightEstimateDebugOff = () => {
      heightEstimateDebugEnabled = false
      console.log('[height-estimate] debug off')
    }

    console.log(
      '%c[scroll] debug available%c  call %c__scrollDebugOn()%c to enable, %c__scrollSnapshot()%c for state',
      'color:#38bdf8;font-weight:600',
      'color:inherit',
      'color:#b4a9f8;font-family:monospace',
      'color:inherit',
      'color:#b4a9f8;font-family:monospace',
      'color:inherit',
    )
    console.log(
      '%c[height-estimate] debug available%c  call %c__heightEstimateDebugOn()%c to log predicted vs measured deltas, %c__heightEstimateSnapshot()%c for current chunk summaries',
      'color:#22c55e;font-weight:600',
      'color:inherit',
      'color:#b4a9f8;font-family:monospace',
      'color:inherit',
      'color:#b4a9f8;font-family:monospace',
      'color:inherit',
    )
  }

  syncEstimatedMessageWidth()
  scrollController?.syncViewportHeight()
  scrollController?.scrollToEnd()

  return () => {
    unregisterChatListSnapshot()
  }
})

$effect(() => {
  const renderDebugKey = messages
    .map((message) =>
      [
        message.uiKey ?? message.id,
        message.id,
        message.status,
        message.role,
        message.runId ?? '',
      ].join(':'),
    )
    .join('|')

  if (renderDebugKey === previousMessageRenderDebugKey) {
    return
  }

  previousMessageRenderDebugKey = renderDebugKey

  logChatDebug('list', 'renderRows', {
    latestAssistantMessageId,
    rows: messages.map((message) => ({
      id: message.id,
      role: message.role,
      runId: message.runId,
      status: message.status,
      uiKey: message.uiKey ?? message.id,
    })),
  })
})

$effect(() => {
  const layoutDebugKey = [
    scrollState.pinnedToBottom ? '1' : '0',
    Math.round(scrollState.scrollTop),
    visibleRange.start,
    visibleRange.end,
    Math.round(topSpacerHeight),
    Math.round(bottomSpacerHeight),
  ].join(':')

  if (layoutDebugKey === previousLayoutDebugKey) {
    return
  }

  previousLayoutDebugKey = layoutDebugKey
  logScroll('layout')
})

$effect(() => {
  const pinnedToBottom = scrollState.pinnedToBottom

  clearScrollToBottomButtonTimer()

  if (pinnedToBottom) {
    showScrollToBottomButton = false
    return
  }

  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const timing = scrollController?.getTimingState()
  const remainingProtectedMs = Math.max(
    0,
    (timing?.scrollGuardUntil ?? 0) - nowMs,
    (timing?.bottomLockUntil ?? 0) - nowMs,
  )
  const delayMs = Math.max(SCROLL_TO_BOTTOM_BUTTON_DELAY_MS, Math.ceil(remainingProtectedMs))

  showScrollToBottomButton = false
  scrollToBottomButtonTimer = setTimeout(() => {
    scrollToBottomButtonTimer = null
    if (!scrollState.pinnedToBottom) {
      showScrollToBottomButton = true
    }
  }, delayMs)

  return () => {
    clearScrollToBottomButtonTimer()
  }
})

// Scroll highlighted message into view when navigator selection changes.
$effect(() => {
  const id = messageNavigator.highlightedMessageId
  if (!id || !viewport) return

  requestAnimationFrame(() => {
    const el = viewport?.querySelector(`[data-message-id="${CSS.escape(id)}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
})
</script>

<div class="relative flex min-h-0 flex-1 flex-col">
  {#if listSurface === 'skeleton'}
    <div class="mx-auto w-full px-5 py-10" style="max-width: var(--chat-max-w, 42rem)">
      <div class="space-y-8">
        {#each [0.5, 0.3, 0.15] as opacity (opacity)}
          <div class="flex items-start gap-3" style="opacity: {opacity};">
            <div class="w-6 h-6 rounded-full bg-surface-2 shrink-0 shimmer"></div>
            <div class="flex-1 space-y-2 pt-1">
              <div class="h-3 w-20 rounded bg-surface-2 shimmer"></div>
              <div class="h-12 w-3/4 rounded bg-surface-2 shimmer"></div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {:else if listSurface === 'empty'}
    <EmptyState />
  {:else}
    <div
      bind:this={viewport}
      onscroll={handleViewportScroll}
      class="absolute inset-0 overflow-y-auto overscroll-contain"
      style="scrollbar-gutter: stable; overflow-anchor: none; contain: layout style; will-change: scroll-position;"
      role="log"
      data-block-toggle-root="true"
      aria-label="Conversation transcript"
      aria-live="polite"
      aria-relevant="additions text"
      aria-busy={isLoading || undefined}
    >
      <div bind:this={content} class="mx-auto px-4.5 pt-4" style="max-width: var(--chat-max-w, 42rem)">
        {#if topSpacerHeight > 0}
          <div
            aria-hidden="true"
            style={`height: ${topSpacerHeight}px;`}
          ></div>
        {/if}

        {#each renderedChunks as chunk (chunk.index)}
          <div use:measureChunk={chunk.index}>
            {#each chunk.messages as message (message.uiKey ?? message.id)}
              {@const messageUiKey = getMessageUiKey(message)}
              <div
                use:consumeMessageIntro={messageUiKey}
                class:message-card-intro={shouldAnimateMessageIntro(message)}
              >
                <MessageCard
                  {message}
                  isLatest={message.id === latestAssistantMessageId}
                />
              </div>
            {/each}
          </div>
        {/each}

        {#if bottomSpacerHeight > 0}
          <div
            aria-hidden="true"
            style={`height: ${bottomSpacerHeight}px;`}
          ></div>
        {/if}
      </div>
    </div>

    {#if showScrollToBottomButton}
      <button
        type="button"
        class="absolute bottom-5 left-1/2 z-10 flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-md border border-border bg-surface-0/92 px-3 text-[11px] font-medium text-text-secondary shadow-lg backdrop-blur-sm transition-colors hover:bg-surface-1 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
        onclick={() => {
          void runJumpToBottom()
        }}
        transition:fly={{ y: 6, duration: 120 }}
      >
        <svg class="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2.5 4.5l3.5 3.5 3.5-3.5"/>
        </svg>
        Scroll to bottom
      </button>
    {/if}
  {/if}
</div>

<style>
  .message-card-intro {
    animation: fade-up var(--motion-card-ms) cubic-bezier(0.23, 1, 0.32, 1) both;
  }

  @media (prefers-reduced-motion: reduce) {
    .message-card-intro {
      animation: none;
    }
  }

  .shimmer {
    animation: shimmer 2s infinite linear;
    background-image: linear-gradient(90deg, var(--color-surface-2) 0%, var(--color-surface-3) 50%, var(--color-surface-2) 100%);
    background-size: 200% 100%;
  }
</style>
