<script lang="ts">
import { formatAttachmentSize, getAttachmentExtension } from '../attachments/presentation'
import { isAuthenticatedAssetUrl, openAssetInNewTab } from '../services/authenticated-asset'
import { fileKindIcon } from './icons'

interface FileChipAttachment {
  mime: string
  name: string
  size: number
  url?: string
}

interface Props {
  attachment: FileChipAttachment
  disabled?: boolean
  href?: string | null
  onOpenPreview?: (() => void) | null
  onRemove?: (() => void) | null
  statusLabel?: string | null
  variant?: 'message' | 'tray'
}

let {
  attachment,
  disabled = false,
  href = null,
  onOpenPreview = null,
  onRemove = null,
  statusLabel = null,
  variant = 'message',
}: Props = $props()

const extension = $derived(getAttachmentExtension(attachment.name))
const Icon = $derived(fileKindIcon(attachment.mime, extension))
const sizeLabel = $derived(formatAttachmentSize(attachment.size))
const resolvedHref = $derived(href ?? attachment.url ?? null)
const isTrayVariant = $derived(variant === 'tray')
const trayBadgeLabel = $derived((extension ?? 'file').slice(0, 4))
const titleText = $derived(`${attachment.name} • ${sizeLabel}`)
const messageRootClass = $derived(
  'group relative flex min-h-[72px] w-full max-w-[320px] items-center gap-3 rounded-xl border border-border bg-surface-0/92 px-3 py-2.5 shadow-[0_1px_0_rgba(0,0,0,0.02)]',
)
const removable = $derived(onRemove != null)

const openResolvedHref = async (event?: MouseEvent) => {
  if (!resolvedHref) {
    return
  }

  if (!isAuthenticatedAssetUrl(resolvedHref)) {
    return
  }

  event?.preventDefault()
  await openAssetInNewTab(resolvedHref)
}
</script>

{#if isTrayVariant}
  <div
    class="group relative h-16 w-16 overflow-hidden rounded border border-border bg-surface-1"
    title={titleText}
    aria-label={titleText}
  >
    {#if onOpenPreview}
      <button
        type="button"
        class="flex h-full w-full items-center justify-center text-text-tertiary transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
        aria-label={titleText}
        onclick={() => { onOpenPreview?.() }}
      >
        <svg
          class="h-7 w-7"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M8 3.5h6.5L19.5 8v11A1.5 1.5 0 0 1 18 20.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5Z" />
          <path d="M14.5 3.5V8h5" />
        </svg>
      </button>
    {:else if resolvedHref}
      <a
        href={resolvedHref}
        target="_blank"
        rel="noreferrer"
        class="flex h-full w-full items-center justify-center text-text-tertiary transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
        aria-label={titleText}
        onclick={(event) => { void openResolvedHref(event) }}
      >
        <svg
          class="h-7 w-7"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M8 3.5h6.5L19.5 8v11A1.5 1.5 0 0 1 18 20.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5Z" />
          <path d="M14.5 3.5V8h5" />
        </svg>
      </a>
    {:else}
      <div class="flex h-full w-full items-center justify-center text-text-tertiary">
        <svg
          class="h-7 w-7"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M8 3.5h6.5L19.5 8v11A1.5 1.5 0 0 1 18 20.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5Z" />
          <path d="M14.5 3.5V8h5" />
        </svg>
      </div>
    {/if}

    {#if statusLabel}
      <div class="absolute inset-x-0 bottom-0 bg-bg/70 px-1.5 py-0.5 text-center text-[10px] font-medium text-text-secondary app-frosted">
        {statusLabel}
      </div>
    {:else}
      <div class="absolute bottom-1 left-1 rounded bg-bg/70 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-text-secondary app-frosted">
        {trayBadgeLabel}
      </div>
    {/if}

    {#if onRemove}
      <button
        type="button"
        class="absolute right-1 top-1 z-1 flex h-5 w-5 items-center justify-center rounded bg-bg/70 text-text-secondary opacity-0 transition-opacity app-frosted group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={`Remove ${attachment.name}`}
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
{:else}
  <div
    class={`${messageRootClass} ${removable ? 'pr-11' : ''} ${onOpenPreview ? 'cursor-pointer hover:bg-surface-1/60' : ''}`}
  >
    {#if onOpenPreview}
      <button
        type="button"
        class="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
        aria-label={titleText}
        onclick={() => {
          onOpenPreview?.()
        }}
      ></button>
    {/if}

    <div class={`flex min-w-0 flex-1 items-center gap-3 ${onOpenPreview ? 'pointer-events-none' : ''}`}>
      <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-1 text-text-secondary">
        <Icon class="h-5 w-5" />
      </div>

      <div class="min-w-0 flex-1">
        {#if !onOpenPreview && resolvedHref}
          <a
            href={resolvedHref}
            target="_blank"
            rel="noreferrer"
            class="block truncate text-[13px] font-medium text-text-primary transition-colors hover:text-accent-text focus-visible:outline-none focus-visible:text-accent-text"
            onclick={(event) => { void openResolvedHref(event) }}
          >
            {attachment.name}
          </a>
        {:else}
          <div class="truncate text-[13px] font-medium text-text-primary">{attachment.name}</div>
        {/if}

        <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-text-tertiary">
          {#if extension}
            <span class="rounded-full bg-surface-1 px-2 py-0.5 font-medium uppercase tracking-[0.08em] text-text-secondary">
              {extension}
            </span>
          {/if}
          <span>{sizeLabel}</span>
          {#if statusLabel}
            <span class="truncate">{statusLabel}</span>
          {/if}
        </div>
      </div>
    </div>

    {#if onRemove}
      <button
        type="button"
        class="absolute right-1.5 top-1.5 z-1 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-bg text-text-secondary opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={`Remove ${attachment.name}`}
        disabled={disabled}
        onclick={(e) => {
          e.stopPropagation()
          onRemove?.()
        }}
      >
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
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
{/if}
