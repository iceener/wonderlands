<script lang="ts">
import { onDestroy, onMount, tick } from 'svelte'
import { uploadAttachment } from '../services/attachment-api'
import { copyImageToClipboard, downloadImage, resolveDownloadFileName } from '../services/clipboard'
import { getShortcutManagerContext } from '../shortcuts/shortcut-manager'
import { chatStore } from '../stores/chat-store.svelte'
import { getShortcutLayerStackContext } from '../ui/layer-stack'
import ImagePreview from './ImagePreview.svelte'
import { getPreviewContext } from './preview-context'
import TextPreview from './TextPreview.svelte'
import { isImagePreviewItem, isTextPreviewItem, type TextPreviewItem } from './types'

const preview = getPreviewContext()
const layerStack = getShortcutLayerStackContext()
const shortcutManager = getShortcutManagerContext()

let panel: HTMLDivElement | null = $state(null)
let lastFocus: HTMLElement | null = null

let copyLabel = $state('Copy')
let downloadLabel = $state('Download')
let actionTimer: number | null = null

const currentImageItem = $derived(
  preview.currentItem && isImagePreviewItem(preview.currentItem) ? preview.currentItem : null,
)

$effect(() => {
  if (!preview.isOpen) {
    return
  }

  const release = layerStack.pushLayer('lightbox', 'app-preview-host')
  return () => {
    release()
  }
})

$effect(() => {
  if (!preview.isOpen) {
    copyLabel = 'Copy'
    downloadLabel = 'Download'

    if (actionTimer != null) {
      window.clearTimeout(actionTimer)
      actionTimer = null
    }
    return
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

const handleCopyCurrentImage = async () => {
  if (!currentImageItem) {
    return
  }

  try {
    await copyImageToClipboard(currentImageItem.sourceUrl)
    setActionLabel('copy', 'Copied')
  } catch {
    setActionLabel('copy', 'Failed')
  }
}

const handleDownloadCurrentImage = async () => {
  if (!currentImageItem) {
    return
  }

  try {
    await downloadImage(
      currentImageItem.sourceUrl,
      resolveDownloadFileName(
        currentImageItem.sourceUrl,
        currentImageItem.caption ?? currentImageItem.alt,
      ),
    )
    setActionLabel('download', 'Saved')
  } catch {
    setActionLabel('download', 'Failed')
  }
}

const handleTextSave = async (content: string) => {
  const item = preview.currentItem
  if (!item || !isTextPreviewItem(item)) return

  if (item.saveHandler) {
    await item.saveHandler(content)
    return
  }

  if (!item.attachmentId || !item.messageId) return

  try {
    const file = new File([content], item.name, { type: item.mime })
    const newAttachment = await uploadAttachment(
      file,
      chatStore.sessionId
        ? {
            accessScope: 'session_local',
            sessionId: chatStore.sessionId,
          }
        : {
            accessScope: 'account_library',
          },
    )

    const replaced = chatStore.replaceMessageAttachment(
      item.messageId,
      item.attachmentId,
      newAttachment,
    )
    if (replaced) {
      item.attachmentId = newAttachment.id
      item.attachmentUrl = newAttachment.url
      item.content = content
    }
  } catch {
    // Upload failed — user stays in edit mode
  }
}

$effect(() => {
  if (!preview.isOpen) {
    queueMicrotask(() => {
      if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
        lastFocus.focus()
      }
      lastFocus = null
    })
    return
  }

  lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  void tick().then(() => {
    panel?.focus()
  })
})

const handleBackdropPointerDown = (event: PointerEvent) => {
  if (event.target === event.currentTarget) {
    preview.close()
  }
}

const trapFocus = (event: KeyboardEvent) => {
  if (event.key !== 'Tab' || !panel || !preview.isOpen) {
    return
  }

  const selectors =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  const focusables = [...panel.querySelectorAll<HTMLElement>(selectors)].filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  )

  if (focusables.length === 0) {
    return
  }

  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement

  if (!event.shiftKey && active === last) {
    event.preventDefault()
    first?.focus()
  } else if (event.shiftKey && (active === first || active === panel)) {
    event.preventDefault()
    last?.focus()
  }
}

const headerLabel = $derived.by(() => {
  const item = preview.currentItem
  if (!item) return 'Preview'
  if (isImagePreviewItem(item)) return item.caption?.trim() || item.alt
  return item.name
})

onMount(() => {
  const multi = () => preview.items.length > 1

  return shortcutManager.registerShortcuts([
    {
      id: 'preview.close',
      description: 'Close preview',
      keys: ['Escape'],
      scope: 'lightbox',
      allowInEditable: true,
      run: () => {
        preview.close()
      },
    },
    {
      id: 'preview.prev',
      description: 'Previous item',
      keys: ['ArrowLeft'],
      scope: 'lightbox',
      allowInEditable: true,
      when: () => multi(),
      run: () => {
        preview.prev()
      },
    },
    {
      id: 'preview.next',
      description: 'Next item',
      keys: ['ArrowRight'],
      scope: 'lightbox',
      allowInEditable: true,
      when: () => multi(),
      run: () => {
        preview.next()
      },
    },
  ])
})

onDestroy(() => {
  if (actionTimer != null) {
    window.clearTimeout(actionTimer)
  }
})
</script>

{#if preview.isOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-bg/85 p-4 app-frosted"
    role="presentation"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      bind:this={panel}
      class="relative flex h-[min(92dvh,920px)] w-[min(92vw,860px)] flex-col overflow-hidden rounded-xl border border-border bg-surface-0 shadow-lg outline-none"
      role="dialog"
      aria-modal="true"
      aria-label="Preview"
      tabindex="-1"
      onkeydown={trapFocus}
    >
        <div class="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <p class="min-w-0 truncate text-[13px] text-text-secondary">
            {headerLabel}
          </p>
          <div class="flex shrink-0 items-center gap-1">
            {#if preview.items.length > 1}
              <span class="pr-2 text-[12px] tabular-nums text-text-tertiary">
                {preview.index + 1} / {preview.items.length}
              </span>
              <button
                type="button"
                class="rounded border border-border bg-surface-1 px-2 py-1 text-[12px] text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
                aria-label="Previous item"
                onclick={() => { preview.prev() }}
              >
                Prev
              </button>
              <button
                type="button"
                class="rounded border border-border bg-surface-1 px-2 py-1 text-[12px] text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
                aria-label="Next item"
                onclick={() => { preview.next() }}
              >
                Next
              </button>
            {/if}
            {#if currentImageItem}
              <button
                type="button"
                class="ml-1 rounded border border-border bg-surface-1 px-2 py-1 text-[12px] text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
                aria-label="Copy image to clipboard"
                onclick={() => { void handleCopyCurrentImage() }}
              >
                {copyLabel}
              </button>
              <button
                type="button"
                class="rounded border border-border bg-surface-1 px-2 py-1 text-[12px] text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
                aria-label="Download image"
                onclick={() => { void handleDownloadCurrentImage() }}
              >
                {downloadLabel}
              </button>
            {/if}
            <button
              type="button"
              class="ml-1 rounded border border-border bg-surface-1 px-2 py-1 text-[12px] text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
              aria-label="Close preview"
              onclick={() => { preview.close() }}
            >
              Close
            </button>
          </div>
        </div>

        {#if preview.currentItem && isImagePreviewItem(preview.currentItem)}
          <div class="flex min-h-0 flex-1 items-center justify-center bg-surface-1 p-3">
            <ImagePreview item={preview.currentItem} />
          </div>
        {:else if preview.currentItem && isTextPreviewItem(preview.currentItem)}
          <TextPreview
            item={preview.currentItem}
            onSave={(content) => { void handleTextSave(content) }}
          />
        {/if}
    </div>
  </div>
{/if}
