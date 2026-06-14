<script lang="ts">
import type {
  MarkdownSegment,
  MessageStatus,
  TextBlock as TextBlockModel,
  TextRenderState,
} from '@wonderlands/contracts/chat'
import { onMount } from 'svelte'
import { repairIncompleteMarkdown } from '../../runtime/incomplete-markdown'
import { typewriter } from '../../stores/typewriter.svelte'
import MarkdownHtml from '../MarkdownHtml.svelte'
import StructuralMarkdown from '../StructuralMarkdown.svelte'
import { resolveTextBlockCaretPlacement } from './text-block-caret'
import { shouldRearmDeferredTypewriter } from './text-block-typewriter'

interface Props {
  block: TextBlockModel
  isLatest?: boolean
  messageStatus?: MessageStatus
  shouldTypewrite?: boolean
  oncomplete?: () => void
}

const EMPTY_RENDER_STATE: TextRenderState = {
  committedSegments: [],
  liveTail: '',
  processedContent: '',
  nextSegmentIndex: 0,
}

let {
  block,
  isLatest = false,
  messageStatus = 'complete',
  shouldTypewrite = false,
  oncomplete,
}: Props = $props()

let displayedLength = $state(0)
let frameId: number | null = null
let nextTickAt = 0
let completeFired = false
let animationStarted = false
let activeBlockId = $state('')
let appliedRenderState: TextRenderState = $state.raw(EMPTY_RENDER_STATE)

const isWindowActive = (): boolean =>
  typeof document === 'undefined'
    ? true
    : document.visibilityState === 'visible' &&
      (typeof document.hasFocus !== 'function' || document.hasFocus())

let windowActive = $state(isWindowActive())

const shouldAnimate = $derived(
  shouldTypewrite && displayedLength < block.content.length && windowActive,
)

const visibleCharacterCount = $derived(
  shouldTypewrite
    ? Math.min(displayedLength, appliedRenderState.processedContent.length)
    : appliedRenderState.processedContent.length,
)

const isRevealed = $derived(!shouldTypewrite || displayedLength >= block.content.length)

const applyRenderState = (nextRenderState: TextRenderState) => {
  appliedRenderState = nextRenderState
}

const stopAnimation = () => {
  if (frameId != null) {
    cancelAnimationFrame(frameId)
    frameId = null
  }
}

$effect(() => {
  const nextBlockId = block.id

  if (nextBlockId === activeBlockId) {
    return
  }

  activeBlockId = nextBlockId
  stopAnimation()
  nextTickAt = 0
  completeFired = false
  animationStarted = false
  appliedRenderState = block.renderState
  displayedLength = shouldTypewrite && windowActive ? 0 : block.content.length
})

$effect(() => {
  const nextRenderState = block.renderState

  if (block.id !== activeBlockId || appliedRenderState === nextRenderState) {
    return
  }

  applyRenderState(nextRenderState)
})

onMount(() => {
  const syncWindowActivity = () => {
    windowActive = isWindowActive()
  }

  document.addEventListener('visibilitychange', syncWindowActivity)
  window.addEventListener('focus', syncWindowActivity)
  window.addEventListener('blur', syncWindowActivity)

  return () => {
    document.removeEventListener('visibilitychange', syncWindowActivity)
    window.removeEventListener('focus', syncWindowActivity)
    window.removeEventListener('blur', syncWindowActivity)
  }
})

$effect(() => {
  if (isRevealed && !block.streaming && !completeFired && shouldTypewrite) {
    completeFired = true
    oncomplete?.()
  }
})

$effect(() => {
  if (!shouldTypewrite || !windowActive) {
    displayedLength = block.content.length
    return
  }

  if (displayedLength > block.content.length) {
    displayedLength = block.content.length
  }
})

$effect(() => {
  // Post-tool text can mount before the gate/window is ready. If that happens,
  // the block gets revealed in full once and would otherwise never animate.
  if (
    !shouldRearmDeferredTypewriter({
      completeFired,
      contentLength: block.content.length,
      displayedLength,
      started: animationStarted,
      shouldTypewrite,
      windowActive,
    })
  ) {
    return
  }

  stopAnimation()
  nextTickAt = 0
  displayedLength = 0
})

$effect(() => {
  if (!shouldAnimate) {
    stopAnimation()
    if (!shouldTypewrite) {
      displayedLength = block.content.length
    }
    return () => stopAnimation()
  }

  if (frameId != null) {
    return () => stopAnimation()
  }

  animationStarted = true

  const animate = (timestamp: number) => {
    const targetLength = block.content.length

    if (displayedLength >= targetLength) {
      frameId = null
      return
    }

    if (nextTickAt === 0 || timestamp >= nextTickAt) {
      const { burst, interval } = typewriter.config
      displayedLength = Math.min(targetLength, displayedLength + burst)
      nextTickAt = timestamp + interval
    }

    frameId = requestAnimationFrame(animate)
  }

  frameId = requestAnimationFrame(animate)

  return () => {
    nextTickAt = 0
    stopAnimation()
  }
})

const visibleRenderState = $derived.by(() => {
  let remaining = visibleCharacterCount
  const committedSegments: MarkdownSegment[] = []
  let partialMarkdownSource = ''

  for (const segment of appliedRenderState.committedSegments) {
    if (remaining >= segment.source.length) {
      committedSegments.push(segment)
      remaining -= segment.source.length
      continue
    }

    if (remaining > 0) {
      partialMarkdownSource = segment.source.slice(0, remaining)
    }

    remaining = 0
    break
  }

  const visibleLiveTail = remaining > 0 ? appliedRenderState.liveTail.slice(0, remaining) : ''

  return {
    committedSegments,
    partialMarkdownSource,
    visibleLiveTail,
  }
})

const partialMarkdown = $derived(
  visibleRenderState.partialMarkdownSource
    ? repairIncompleteMarkdown(visibleRenderState.partialMarkdownSource)
    : '',
)

const caretPlacement = $derived(
  resolveTextBlockCaretPlacement({
    blockStreaming: block.streaming,
    committedSegmentCount: visibleRenderState.committedSegments.length,
    hasPartialMarkdown: partialMarkdown.length > 0,
    hasVisibleLiveTail: visibleRenderState.visibleLiveTail.length > 0,
    messageStatus,
    shouldAnimate,
  }),
)
</script>

<div class="relative" aria-live={messageStatus === 'streaming' ? 'polite' : 'off'}>
  {#each visibleRenderState.committedSegments as segment, index (segment.id)}
    <MarkdownHtml
      appendCaret={caretPlacement === 'committed_tail' && index === visibleRenderState.committedSegments.length - 1}
      highlight={true}
      source={segment.source}
    />
  {/each}

  {#if partialMarkdown}
    <StructuralMarkdown
      appendCaret={caretPlacement === 'partial_markdown'}
      highlight={false}
      source={partialMarkdown}
    />
  {/if}

  {#if visibleRenderState.visibleLiveTail}
    <div>
      <StructuralMarkdown
        appendCaret={caretPlacement === 'live_tail'}
        highlight={false}
        source={repairIncompleteMarkdown(visibleRenderState.visibleLiveTail)}
      />
    </div>
  {/if}

  {#if caretPlacement === 'standalone'}
    <span class="caret-blink" aria-hidden="true"></span>
  {/if}
</div>
