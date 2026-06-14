<script lang="ts">
import { onDestroy, untrack } from 'svelte'
import {
  isAuthenticatedAssetUrl,
  peekCachedDisplayUrl,
  resolveImageDisplayUrl,
} from '../services/authenticated-asset'
import { copyImageToClipboard, downloadImage, resolveDownloadFileName } from '../services/clipboard'

interface Props {
  alt: string
  disabled?: boolean
  /** Fixed frame (message bubble); must match attachment grid metrics for stable virtualized height. */
  frameHeight?: number
  frameWidth?: number
  href?: string | null
  /** Image fit within the frame. 'cover' fills and crops (default), 'contain' fits inside with letterboxing. */
  objectFit?: 'cover' | 'contain'
  onRemove?: (() => void) | null
  onOpenPreview?: (() => void) | null
  src: string
  statusLabel?: string | null
  variant?: 'message' | 'tray'
}

let {
  alt,
  disabled = false,
  frameHeight,
  frameWidth,
  href = null,
  objectFit = 'cover',
  onRemove = null,
  onOpenPreview = null,
  src,
  statusLabel = null,
  variant = 'message',
}: Props = $props()

const imgFitClass = $derived(objectFit === 'contain' ? 'object-contain' : 'object-cover')

const hasFixedMessageFrame = $derived(
  variant === 'message' &&
    frameWidth != null &&
    frameHeight != null &&
    Number.isFinite(frameWidth) &&
    Number.isFinite(frameHeight),
)

const frameClass = $derived(
  variant === 'tray'
    ? 'h-16 w-16 shrink-0'
    : hasFixedMessageFrame
      ? 'shrink-0'
      : 'h-[280px] w-full max-w-[320px]',
)

const expectsAuthResolution = $derived(isAuthenticatedAssetUrl(src))
const imageActionSource = $derived((href?.trim() || src.trim()).trim())
const imageActionName = $derived(resolveDownloadFileName(imageActionSource, alt))
const showMessageImageActions = $derived(variant === 'message' && imageActionSource.length > 0)

let resolvedSrc = $state('')
let resolvedHref = $state<string | null>(null)
let loadFailed = $state(false)
let copyLabel = $state('Copy')
let downloadLabel = $state('Download')
let actionTimer: number | null = null

$effect(() => {
  let cancelled = false
  const controller = new AbortController()
  let disposeResolved: (() => void) | null = null

  const shouldResolveSource = isAuthenticatedAssetUrl(src)
  const shouldResolveHref = href != null && isAuthenticatedAssetUrl(href)

  if (!shouldResolveSource) {
    resolvedSrc = src
    resolvedHref = shouldResolveHref ? null : href
    loadFailed = false
  } else {
    // Read resolvedSrc without tracking to prevent a re-run cycle:
    // the async run() writes resolvedSrc, which would re-trigger this
    // effect (cleanup → revoke blob URL → blank frame).
    const current = untrack(() => resolvedSrc)
    resolvedSrc = peekCachedDisplayUrl(src) || current || ''
    resolvedHref = null
    loadFailed = false
  }

  const fail = () => {
    if (!cancelled) {
      loadFailed = true
      resolvedSrc = ''
      resolvedHref = null
    }
  }

  const run = async () => {
    if (shouldResolveSource) {
      try {
        const res = await resolveImageDisplayUrl(src, controller.signal)
        if (cancelled) {
          res.dispose()
          return
        }

        disposeResolved = res.dispose
        resolvedSrc = res.displayUrl
        resolvedHref = shouldResolveHref ? res.displayUrl : href
      } catch {
        fail()
      }

      return
    }

    if (shouldResolveHref && href) {
      try {
        const res = await resolveImageDisplayUrl(href, controller.signal)
        if (cancelled) {
          res.dispose()
          return
        }

        disposeResolved = res.dispose
        resolvedHref = res.displayUrl
      } catch {
        fail()
      }
    }
  }

  void run()

  return () => {
    cancelled = true
    controller.abort()
    disposeResolved?.()
    disposeResolved = null
  }
})

const setActionLabel = (type: 'copy' | 'download', value: string) => {
  if (type === 'copy') {
    copyLabel = value
  } else {
    downloadLabel = value
  }

  if (actionTimer != null) {
    window.clearTimeout(actionTimer)
  }

  actionTimer = window.setTimeout(() => {
    copyLabel = 'Copy'
    downloadLabel = 'Download'
    actionTimer = null
  }, 1200)
}

const handleCopyImage = async () => {
  try {
    await copyImageToClipboard(imageActionSource)
    setActionLabel('copy', 'Copied')
  } catch {
    setActionLabel('copy', 'Failed')
  }
}

const handleDownloadImage = async () => {
  try {
    await downloadImage(imageActionSource, imageActionName)
    setActionLabel('download', 'Saved')
  } catch {
    setActionLabel('download', 'Failed')
  }
}

onDestroy(() => {
  if (actionTimer != null) {
    window.clearTimeout(actionTimer)
  }
})
</script>

<div
  class={`group relative overflow-hidden rounded border border-border bg-surface-1 ${frameClass}`}
  style:width={hasFixedMessageFrame ? `${frameWidth}px` : undefined}
  style:height={hasFixedMessageFrame ? `${frameHeight}px` : undefined}
>
  {#if onOpenPreview}
    <button
      type="button"
      class="block h-full w-full cursor-zoom-in p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong disabled:cursor-not-allowed"
      aria-label={`Open preview of ${alt}`}
      disabled={disabled}
      onclick={() => {
        onOpenPreview?.()
      }}
    >
      {#if resolvedSrc}
        <img src={resolvedSrc} alt={alt} class={`block h-full w-full ${imgFitClass}`} loading="lazy" />
      {:else if expectsAuthResolution && !loadFailed}
        <div
          class="h-full w-full animate-pulse bg-surface-2"
          aria-busy="true"
          aria-label={`Loading preview of ${alt}`}
        ></div>
      {:else if expectsAuthResolution}
        <div class="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-text-tertiary">
          Preview unavailable
        </div>
      {:else}
        <div class="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-text-tertiary">
          Preview unavailable
        </div>
      {/if}
    </button>
  {:else if resolvedHref && resolvedSrc}
    <a
      href={resolvedHref}
      target="_blank"
      rel="noreferrer"
      class="block"
      aria-label={alt}
    >
      <img src={resolvedSrc} alt={alt} class={`block h-full w-full ${imgFitClass}`} loading="lazy" />
    </a>
  {:else if resolvedSrc}
    <img src={resolvedSrc} alt={alt} class={`block h-full w-full ${imgFitClass}`} loading="lazy" />
  {:else if expectsAuthResolution && !loadFailed}
    <div
      class="h-full w-full animate-pulse bg-surface-2"
      aria-busy="true"
      aria-label={`Loading preview of ${alt}`}
    ></div>
  {:else if expectsAuthResolution}
    <div class="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-text-tertiary">
      Preview unavailable
    </div>
  {:else}
    <div class="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-text-tertiary">
      Preview unavailable
    </div>
  {/if}

  {#if statusLabel}
    <div class="absolute inset-x-0 bottom-0 bg-bg/70 px-1.5 py-0.5 text-[10px] font-medium text-text-secondary app-frosted">
      {statusLabel}
    </div>
  {/if}

  {#if showMessageImageActions}
    <div class="absolute left-1 top-1 z-1 flex items-center gap-1 rounded bg-bg/72 p-1 opacity-0 transition-opacity app-frosted group-hover:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        class="rounded border border-border bg-surface-0 px-2 py-0.5 text-[11px] font-medium text-text-secondary transition-colors hover:text-text-primary"
        aria-label={`Copy ${alt} to clipboard`}
        onclick={() => {
          void handleCopyImage()
        }}
      >
        {copyLabel}
      </button>
      <button
        type="button"
        class="rounded border border-border bg-surface-0 px-2 py-0.5 text-[11px] font-medium text-text-secondary transition-colors hover:text-text-primary"
        aria-label={`Download ${alt}`}
        onclick={() => {
          void handleDownloadImage()
        }}
      >
        {downloadLabel}
      </button>
    </div>
  {/if}

  {#if onRemove}
    <button
      type="button"
      class="absolute right-1 top-1 z-1 flex h-5 w-5 items-center justify-center rounded bg-bg/70 text-text-secondary opacity-0 transition-opacity app-frosted group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
      aria-label={`Remove ${alt}`}
      disabled={disabled}
      onclick={() => {
        onRemove?.()
      }}
    >
      <svg
        class="h-3 w-3"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M4 4l8 8" />
        <path d="M12 4 4 12" />
      </svg>
    </button>
  {/if}
</div>
