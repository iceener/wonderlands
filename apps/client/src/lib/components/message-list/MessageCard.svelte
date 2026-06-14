<script lang="ts">
import type { MessageAttachment } from '@wonderlands/contracts/chat'
import { onMount } from 'svelte'
import { filterInlineRenderedImageAttachments } from '../../attachments/model-visible'
import {
  ATTACHMENT_GRID_GAP,
  ATTACHMENT_IMAGE_MIN_WIDTH,
  getAttachmentImageGridMetrics,
  partitionAttachments,
  USER_MESSAGE_BUBBLE_HORIZONTAL_PADDING,
  USER_MESSAGE_BUBBLE_MAX_WIDTH_RATIO,
} from '../../attachments/presentation'
import type { UiMessage } from '../../chat/types'
import {
  imageAttachmentsToPreviewItems,
  resolveTextPreviewItem,
} from '../../preview/preview-adapters'
import { tryGetPreviewContext } from '../../preview/preview-context'
import { logChatDebug } from '../../runtime/chat-debug'
import {
  findTightBubbleWidth,
  prepareTextLayout,
  supportsTightUserBubble,
} from '../../runtime/message-height-estimator'
import { openAssetInNewTab } from '../../services/authenticated-asset'
import { copyTextToClipboard } from '../../services/clipboard'
import { chatStore } from '../../stores/chat-store.svelte'
import { getMessageNavigatorContext } from '../../stores/message-navigator.svelte'
import BlockRenderer from '../blocks/BlockRenderer.svelte'
import { getWaitingFooterState } from '../blocks/delegation-state'
import ImageTile from '../ImageTile.svelte'
import MarkdownHtml from '../MarkdownHtml.svelte'

let { message, isLatest = false }: { message: Readonly<UiMessage>; isLatest?: boolean } = $props()
const preview = tryGetPreviewContext()
const messageNavigator = getMessageNavigatorContext()

const isHighlighted = $derived(messageNavigator.highlightedMessageId === message.id)
const showCopiedFeedback = $derived(messageNavigator.copiedMessageId === message.id)

let fontGeneration = $state(0)
let userMessageWidth = $state(0)
let isHovered = $state(false)
let hoverCopyLabel = $state('Copy')
let hoverCopyTimer: number | null = null
let previousDebugSignature = $state('')

const handleCopy = async () => {
  if (!hasText) return
  if (isHighlighted) {
    void messageNavigator.copyHighlighted(chatStore.messages)
    return
  }
  try {
    await copyTextToClipboard(message.text)
    hoverCopyLabel = 'Copied!'
  } catch {
    hoverCopyLabel = 'Failed'
  }
  if (hoverCopyTimer != null) window.clearTimeout(hoverCopyTimer)
  hoverCopyTimer = window.setTimeout(() => {
    hoverCopyLabel = 'Copy'
    hoverCopyTimer = null
  }, 1200)
}

const copyButtonLabel = $derived(
  isHighlighted ? (showCopiedFeedback ? 'Copied!' : 'Copy') : hoverCopyLabel,
)

const formatTime = (value: string): string =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const visibleAttachments = $derived(
  message.role === 'user'
    ? filterInlineRenderedImageAttachments(message.attachments, message.text)
    : message.attachments,
)
const attachmentGroups = $derived(partitionAttachments(visibleAttachments))
const imageAttachments = $derived(attachmentGroups.images)
const fileAttachments = $derived(attachmentGroups.files)
const hasText = $derived(message.text.trim().length > 0)
const canBranch = $derived(
  message.role === 'assistant' &&
    message.sequence !== null &&
    message.status === 'complete' &&
    !chatStore.isLoading &&
    !chatStore.isStreaming &&
    !chatStore.isCancelling &&
    !chatStore.isWaiting,
)
const canEdit = $derived(
  message.role === 'user' &&
    !chatStore.isLoading &&
    !chatStore.isStreaming &&
    !chatStore.isCancelling &&
    !chatStore.isWaiting,
)
const isEditing = $derived(chatStore.messageEditDraft?.messageId === message.id)
const hasUserActions = $derived(message.role === 'user' && (hasText || canEdit || isEditing))
const hasAssistantActions = $derived(message.role === 'assistant' && (hasText || canBranch))
const isStreamingThis = $derived(isLatest && chatStore.isStreaming && message.role === 'assistant')
const showActionBar = $derived(
  !isStreamingThis &&
    (isHighlighted ||
      (isHovered && (message.role === 'assistant' ? hasAssistantActions : hasUserActions))),
)
const waitingFooterState = $derived.by(() =>
  message.finishReason === 'waiting' && message.status !== 'complete'
    ? getWaitingFooterState(message.blocks)
    : null,
)
const assistantStatusDotClass = $derived.by(() => {
  if (message.role !== 'assistant') {
    return null
  }

  if (message.status === 'error') {
    return 'message-status-dot failed'
  }

  if (message.status === 'waiting') {
    return 'message-status-dot waiting'
  }

  if (message.status === 'streaming') {
    return 'message-status-dot streaming'
  }

  return null
})
/** `px-3` must stay aligned with USER_MESSAGE_BUBBLE_HORIZONTAL_PADDING for estimator width. */
const bubblePaddingClass = 'px-3 py-2'
const singleImage = $derived(imageAttachments.length === 1 && fileAttachments.length === 0)

const preparedUserText = $derived.by(() => {
  if (!fontGeneration) return null // defer until web fonts are ready
  return message.role === 'user' &&
    visibleAttachments.length === 0 &&
    supportsTightUserBubble(message.text)
    ? prepareTextLayout(message.text || ' ', 15)
    : null
})

onMount(() => {
  logChatDebug('message-card', 'mount', {
    id: message.id,
    role: message.role,
    runId: message.runId,
    status: message.status,
    uiKey: message.uiKey ?? message.id,
  })
  void document.fonts.ready.then(() => {
    fontGeneration += 1
  })

  return () => {
    logChatDebug('message-card', 'destroy', {
      id: message.id,
      role: message.role,
      runId: message.runId,
      status: message.status,
      uiKey: message.uiKey ?? message.id,
    })
  }
})

$effect(() => {
  const signature = [
    message.id,
    message.uiKey ?? message.id,
    message.status,
    message.runId ?? '',
    message.blocks.length,
  ].join(':')

  if (signature === previousDebugSignature) {
    return
  }

  previousDebugSignature = signature
  logChatDebug('message-card', 'update', {
    blockTypes: message.blocks.map((block) => block.type),
    id: message.id,
    role: message.role,
    runId: message.runId,
    status: message.status,
    uiKey: message.uiKey ?? message.id,
  })
})

const openAttachmentPreview = (attachmentId: string) => {
  if (!preview) {
    return
  }

  const items = imageAttachmentsToPreviewItems(imageAttachments)
  const index = imageAttachments.findIndex((attachment) => attachment.id === attachmentId)
  preview.openGallery(items, Math.max(0, index))
}

const openFilePreview = async (attachment: MessageAttachment) => {
  if (preview) {
    const item = await resolveTextPreviewItem(attachment, {
      editable: true,
      messageId: message.id,
    })

    if (item) {
      preview.openItem(item)
      return
    }
  }

  if (attachment.url) {
    await openAssetInNewTab(attachment.url)
  }
}

const tightBubbleWidth = $derived.by(() => {
  if (message.role !== 'user' || !preparedUserText || userMessageWidth <= 0) {
    return null
  }

  const maxOuterWidth = Math.max(
    1,
    Math.floor(userMessageWidth * USER_MESSAGE_BUBBLE_MAX_WIDTH_RATIO),
  )
  const maxContentWidth = Math.max(1, maxOuterWidth - USER_MESSAGE_BUBBLE_HORIZONTAL_PADDING)
  const tightContentWidth = findTightBubbleWidth(preparedUserText, maxContentWidth)
  // Canvas measureText does not account for CSS letter-spacing (0.006em on .user-bubble-markdown).
  // Add a small buffer so the bubble never wraps text that the estimator thought would fit.
  const letterSpacingBuffer =
    Math.ceil(preparedUserText.text.length * 0.006 * preparedUserText.fontSize) + 1

  return Math.min(
    maxOuterWidth,
    tightContentWidth + letterSpacingBuffer + USER_MESSAGE_BUBBLE_HORIZONTAL_PADDING,
  )
})

const attachmentGridAvailableWidth = $derived.by(() => {
  if (message.role !== 'user' || imageAttachments.length === 0) {
    return 0
  }

  if (tightBubbleWidth != null) {
    return Math.max(
      ATTACHMENT_IMAGE_MIN_WIDTH,
      tightBubbleWidth - USER_MESSAGE_BUBBLE_HORIZONTAL_PADDING,
    )
  }

  if (userMessageWidth <= 0) {
    return ATTACHMENT_IMAGE_MIN_WIDTH
  }

  const maxOuterWidth = Math.max(
    1,
    Math.floor(userMessageWidth * USER_MESSAGE_BUBBLE_MAX_WIDTH_RATIO),
  )
  return Math.max(
    ATTACHMENT_IMAGE_MIN_WIDTH,
    maxOuterWidth - USER_MESSAGE_BUBBLE_HORIZONTAL_PADDING,
  )
})

const attachmentGridMetrics = $derived(
  message.role === 'user' && imageAttachments.length > 0
    ? getAttachmentImageGridMetrics(imageAttachments.length, attachmentGridAvailableWidth)
    : null,
)
</script>

{#if message.role === 'user'}
  <div
    bind:clientWidth={userMessageWidth}
    class={`py-2.5 pr-3 rounded-lg transition-colors duration-150 ${isHighlighted ? 'msg-highlighted' : ''}`}
    role="article"
    aria-label={`User message at ${formatTime(message.createdAt)}`}
    data-message-id={message.id}
    onmouseenter={() => { isHovered = true }}
    onmouseleave={() => { isHovered = false }}
  >
    <div class="ml-auto flex max-w-[90%] min-w-0 flex-col items-end">
      <div class="mb-1 flex items-center gap-2">
        <time class="text-[11px] text-text-tertiary tabular-nums">{formatTime(message.createdAt)}</time>
      </div>

      {#if hasText || imageAttachments.length > 0 || fileAttachments.length > 0}
        <div
          data-lightbox-gallery
          class={`min-w-0 max-w-full overflow-hidden rounded-lg border border-user-bubble-border bg-user-bubble ${bubblePaddingClass}`}
          style:width={tightBubbleWidth ? `${tightBubbleWidth}px` : undefined}
        >
          {#if imageAttachments.length > 0 && attachmentGridMetrics}
            <div
              class={`flex flex-wrap ${hasText || fileAttachments.length > 0 ? 'mb-2.5' : ''} ${singleImage ? '' : 'justify-end'}`}
              style:gap="{ATTACHMENT_GRID_GAP}px"
              style:width="{attachmentGridMetrics.totalWidth}px"
            >
              {#each imageAttachments as attachment (attachment.id)}
                <ImageTile
                  alt={attachment.name}
                  src={attachment.thumbnailUrl ?? attachment.url}
                  href={attachment.url}
                  variant="message"
                  frameWidth={attachmentGridMetrics.tileWidth}
                  frameHeight={attachmentGridMetrics.tileHeight}
                  onOpenPreview={() => {
                    openAttachmentPreview(attachment.id)
                  }}
                />
              {/each}
            </div>
          {/if}

          {#if hasText}
            <MarkdownHtml source={message.text} className="user-bubble-markdown" />
          {/if}

          {#if fileAttachments.length > 0}
            <div class={`flex flex-wrap gap-1.5 ${hasText || imageAttachments.length > 0 ? 'mt-2' : ''}`}>
              {#each fileAttachments as attachment (attachment.id)}
                <button
                  type="button"
                  class="inline-flex cursor-pointer items-center gap-1 rounded border border-user-bubble-border/50 px-2 py-0.5 text-[12px] text-user-bubble-text/70 transition-colors hover:text-user-bubble-text hover:border-user-bubble-border"
                  title={attachment.name}
                  onclick={() => { void openFilePreview(attachment) }}
                >
                  <svg class="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 7.5l-5.8 5.8a3.2 3.2 0 0 1-4.5-4.5l5.8-5.8a2.1 2.1 0 0 1 3 3L6.2 11.8a1.1 1.1 0 0 1-1.5-1.5L10 5"/></svg>
                  <span class="max-w-[22ch] truncate">{attachment.name}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if hasUserActions}
        <div class={`mt-1.5 flex items-center gap-3 text-[11px] text-text-tertiary transition-opacity duration-150 ${showActionBar ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          {#if isHighlighted}
            <span>
              <kbd class="rounded bg-surface-2 px-1 py-px text-[10px]">↑↓</kbd> navigate
            </span>
            <span>
              <kbd class="rounded bg-surface-2 px-1 py-px text-[10px]">esc</kbd> dismiss
            </span>
          {/if}
          {#if hasText}
            <button
              type="button"
              class="rounded border border-border bg-surface-0 px-2 py-0.5 font-medium text-text-secondary transition-colors hover:text-text-primary"
              onclick={() => { void handleCopy() }}
            >
              {copyButtonLabel}
              {#if isHighlighted}<kbd class="ml-1 rounded bg-surface-2 px-1 py-px text-[10px] text-text-tertiary">c</kbd>{/if}
            </button>
          {/if}
          <button
            type="button"
            class="rounded border border-border bg-surface-0 px-2 py-0.5 font-medium text-text-secondary transition-colors hover:text-text-primary disabled:pointer-events-none disabled:opacity-40"
            disabled={!canEdit || isEditing}
            onclick={() => {
              chatStore.beginMessageEdit(message.id)
            }}
          >
            {isEditing ? 'Editing' : 'Edit'}
          </button>
        </div>
      {/if}
    </div>
  </div>
{:else}
  <div
    class={`py-2.5 px-3 rounded-lg transition-colors duration-150 ${isHighlighted ? 'msg-highlighted' : ''}`}
    role="article"
    aria-label={`Assistant message at ${formatTime(message.createdAt)}`}
    data-message-id={message.id}
    onmouseenter={() => { isHovered = true }}
    onmouseleave={() => { isHovered = false }}
  >
    <div class="flex items-center gap-2 mb-1.5">
      <time class="text-[11px] text-text-tertiary tabular-nums">{formatTime(message.createdAt)}</time>
      {#if assistantStatusDotClass}
        <span class={assistantStatusDotClass} aria-hidden="true"></span>
      {/if}
      {#if message.status === 'error'}
        <span class="flex items-center gap-1.5 text-[11px] text-danger-text">
          failed
        </span>
      {:else if message.status === 'waiting'}
        <span class="flex items-center gap-1.5 text-[11px] text-text-tertiary">
          waiting
        </span>
      {/if}
    </div>
    <div data-lightbox-gallery class="min-w-0">
      <BlockRenderer
        blocks={message.blocks}
        {isLatest}
        messageFinishReason={message.finishReason}
        messageUiKey={message.uiKey ?? message.id}
        messageStatus={message.status}
      />
    </div>
    {#if imageAttachments.length > 0 || fileAttachments.length > 0}
      <div class="mt-3 space-y-2.5">
        <div class="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">Attachments</div>

        {#if imageAttachments.length > 0}
          <div class="flex flex-wrap gap-2">
            {#each imageAttachments as attachment (attachment.id)}
              <div class="max-w-[280px] space-y-1">
                <ImageTile
                  alt={attachment.name}
                  src={attachment.thumbnailUrl ?? attachment.url}
                  href={attachment.url}
                  objectFit="contain"
                  variant="message"
                  onOpenPreview={() => {
                    openAttachmentPreview(attachment.id)
                  }}
                />
                <div class="truncate text-[11px] text-text-secondary" title={attachment.name}>
                  {attachment.name}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        {#if fileAttachments.length > 0}
          <div class="flex flex-wrap gap-1.5">
            {#each fileAttachments as attachment (attachment.id)}
              <button
                type="button"
                class="inline-flex cursor-pointer items-center gap-1 rounded border border-border/50 px-2 py-0.5 text-[12px] text-text-secondary transition-colors hover:text-text-primary hover:border-border"
                title={attachment.name}
                onclick={() => { void openFilePreview(attachment) }}
              >
                <svg class="h-3 w-3 shrink-0 opacity-50" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 7.5l-5.8 5.8a3.2 3.2 0 0 1-4.5-4.5l5.8-5.8a2.1 2.1 0 0 1 3 3L6.2 11.8a1.1 1.1 0 0 1-1.5-1.5L10 5"/></svg>
                <span class="max-w-[22ch] truncate">{attachment.name}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    {#if message.finishReason === 'cancelled'}
      <div class="mt-2.5 flex items-center gap-2 text-[12px] text-text-tertiary">
        <span class="h-px flex-1 max-w-8 bg-border"></span>
        <span>Request cancelled by user.</span>
      </div>
    {:else if message.finishReason === 'waiting'}
      <div class="mt-2.5 flex items-center gap-2 text-[12px] text-text-tertiary">
        <span class="h-px flex-1 max-w-8 bg-border"></span>
        {#if waitingFooterState?.kind === 'reply' || waitingFooterState?.kind === 'suspended'}
          <svg class="h-3.5 w-3.5 shrink-0 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
            <path d="M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
          </svg>
        {:else}
          <span class="caret-blink shrink-0" aria-hidden="true"></span>
        {/if}
        <span>{waitingFooterState?.label}</span>
      </div>
    {/if}
    <div class={`mt-1.5 flex items-center gap-3 text-[11px] text-text-tertiary transition-opacity duration-150 ${showActionBar ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      <button
        type="button"
        class="rounded border border-border bg-surface-0 px-2 py-0.5 font-medium text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none"
        disabled={!hasText}
        onclick={() => { void handleCopy() }}
      >
        {copyButtonLabel}
        {#if isHighlighted}<kbd class="ml-1 rounded bg-surface-2 px-1 py-px text-[10px] text-text-tertiary">c</kbd>{/if}
      </button>
      <button
        type="button"
        class="rounded border border-border bg-surface-0 px-2 py-0.5 font-medium text-text-secondary transition-colors hover:text-text-primary disabled:pointer-events-none disabled:opacity-40"
        disabled={!canBranch}
        onclick={() => {
          void chatStore.branchFromMessage(message.id)
        }}
      >
        Branch
      </button>
      {#if isHighlighted}
        <span>
          <kbd class="rounded bg-surface-2 px-1 py-px text-[10px]">↑↓</kbd> navigate
        </span>
        <span>
          <kbd class="rounded bg-surface-2 px-1 py-px text-[10px]">esc</kbd> dismiss
        </span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .msg-highlighted {
    background: color-mix(in srgb, var(--theme-accent, #60a5fa) 6%, transparent);
    border-radius: 0.5rem;
  }

  .message-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    flex-shrink: 0;
    transition: background var(--motion-card-ms) ease;
  }

  .message-status-dot.streaming {
    background: var(--color-accent);
    animation: message-dot-pulse 1.5s ease-in-out infinite;
  }

  .message-status-dot.waiting {
    background: var(--color-accent);
    animation: message-dot-pulse 1.5s ease-in-out infinite;
  }

  .message-status-dot.failed {
    background: var(--color-danger);
  }

  @keyframes message-dot-pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
</style>
