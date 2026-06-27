<script lang="ts">
import type { BackendFilePickerResult } from '@wonderlands/contracts/chat'
import { onMount, tick } from 'svelte'
import { toApiUrl } from '../../services/backend'
import PickerThumbnail from './PickerThumbnail.svelte'

const isPreviewableImage = (result: BackendFilePickerResult): boolean =>
  result.fileId !== null && (result.mimeType?.startsWith('image/') ?? false)

type IconType = 'code' | 'config' | 'doc' | 'image' | 'data' | 'file'

const extToIcon = (ext: string | null): IconType => {
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'svelte':
    case 'vue':
    case 'py':
    case 'rs':
    case 'go':
    case 'rb':
    case 'java':
    case 'kt':
    case 'css':
    case 'scss':
    case 'less':
    case 'html':
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'c':
    case 'cpp':
    case 'h':
    case 'swift':
    case 'php':
      return 'code'
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'xml':
    case 'env':
    case 'ini':
    case 'lock':
      return 'config'
    case 'md':
    case 'mdx':
    case 'txt':
    case 'log':
    case 'pdf':
    case 'doc':
    case 'docx':
    case 'rtf':
      return 'doc'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
    case 'bmp':
      return 'image'
    case 'sql':
    case 'csv':
    case 'tsv':
    case 'db':
    case 'sqlite':
    case 'parquet':
      return 'data'
    default:
      return 'file'
  }
}

interface Props {
  error?: string | null
  isOpen: boolean
  loading?: boolean
  onClose?: (() => void) | null
  onHighlight?: ((index: number) => void) | null
  onSelect: (result: BackendFilePickerResult) => void
  query?: string
  results: BackendFilePickerResult[]
  selectedIndex: number
}

let {
  error = null,
  isOpen,
  loading = false,
  onClose = null,
  onHighlight = null,
  onSelect,
  query = '',
  results,
  selectedIndex,
}: Props = $props()

const isEmptyQuery = $derived(!query.trim())

let listEl: HTMLDivElement | null = $state(null)
let popoverEl: HTMLDivElement | null = $state(null)

const groupedResults = $derived.by(() => {
  // Vault (`workspace`) and filesystem-MCP (`mcp`) files share one merged group,
  // preserving the server's ranking order across both sources.
  const files = results.filter((result) => result.source === 'workspace' || result.source === 'mcp')
  const attachments = results.filter((result) => result.source === 'attachment')

  return [
    ...(files.length > 0 ? [{ items: files, label: isEmptyQuery ? 'Recent' : 'Files' }] : []),
    ...(attachments.length > 0 ? [{ items: attachments, label: 'Attachments' }] : []),
  ]
})

const flatIndexOf = (groupIndex: number, itemIndex: number): number => {
  let offset = 0

  for (let index = 0; index < groupIndex; index += 1) {
    offset += groupedResults[index]?.items.length ?? 0
  }

  return offset + itemIndex
}

const highlightParts = (
  value: string,
  indices: number[],
): Array<{ highlight: boolean; text: string }> => {
  if (indices.length === 0) {
    return [{ highlight: false, text: value }]
  }

  const matched = new Set(indices)
  const parts: Array<{ highlight: boolean; text: string }> = []
  let current = ''
  let currentMode = matched.has(0)

  for (let index = 0; index < value.length; index += 1) {
    const nextMode = matched.has(index)

    if (index === 0) {
      currentMode = nextMode
      current = value[index] ?? ''
      continue
    }

    if (nextMode === currentMode) {
      current += value[index] ?? ''
      continue
    }

    parts.push({
      highlight: currentMode,
      text: current,
    })
    current = value[index] ?? ''
    currentMode = nextMode
  }

  if (current) {
    parts.push({
      highlight: currentMode,
      text: current,
    })
  }

  return parts
}

const scrollSelectedIntoView = () => {
  if (!listEl) return

  const active = listEl.querySelector('[data-active="true"]')
  active?.scrollIntoView({ block: 'nearest' })
}

$effect(() => {
  void selectedIndex
  void tick().then(scrollSelectedIntoView)
})

const handleDocumentPointerDown = (event: PointerEvent) => {
  if (!isOpen || !popoverEl) return
  if (!popoverEl.contains(event.target as Node)) {
    onClose?.()
  }
}

$effect(() => {
  if (!isOpen) return

  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  return () => {
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
  }
})

onMount(() => {
  if (isOpen) {
    void tick().then(scrollSelectedIntoView)
  }
})
</script>

{#if isOpen}
  <div
    bind:this={popoverEl}
    class="absolute bottom-full left-0 right-0 z-40 mb-2 flex flex-col overflow-hidden rounded-lg border border-border bg-surface-0 shadow-xl"
    role="listbox"
    aria-label="File picker"
    style="animation: popover-enter 120ms cubic-bezier(0.16, 1, 0.3, 1)"
  >
    <div
      bind:this={listEl}
      class="max-h-[min(40dvh,20rem)] overflow-y-auto overscroll-contain px-2 py-2"
    >
      {#if error}
        <div class="px-3 py-3 text-center text-sm text-danger-text">
          {error}
        </div>
      {:else if loading && results.length === 0}
        <div class="px-3 py-3 text-center text-sm text-text-tertiary">
          Searching files…
        </div>
      {:else if results.length === 0}
        <div class="px-3 py-3 text-center text-sm text-text-tertiary">
          {isEmptyQuery ? 'No files in workspace' : 'No files found'}
        </div>
      {:else}
        {#each groupedResults as group, groupIndex}
          <div class="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary first:pt-0">
            {group.label}
          </div>

          {#each group.items as result, itemIndex}
            {@const flatIndex = flatIndexOf(groupIndex, itemIndex)}
            {@const isSelected = flatIndex === selectedIndex}
            {@const parts = highlightParts(result.relativePath, result.matchIndices)}

            <button
              type="button"
              class="flex w-full items-start gap-3 rounded px-2.5 py-2 text-left text-[13px] transition-colors {isSelected ? 'bg-accent/10 text-accent-text' : 'text-text-primary hover:bg-surface-1'}"
              role="option"
              aria-selected={isSelected}
              data-active={isSelected || undefined}
              onpointerenter={() => { onHighlight?.(flatIndex) }}
              onpointerdown={(event) => {
                event.preventDefault()
                onSelect(result)
              }}
            >
              {#if isPreviewableImage(result)}
                <PickerThumbnail src={toApiUrl(`/files/${result.fileId}/content`)} />
              {:else}
                {@const icon = extToIcon(result.extension)}
                <svg class="mt-0.5 shrink-0 text-text-tertiary" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                  {#if icon === 'code'}
                    <path d="M10 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V5L10 2Z" />
                    <polyline points="10 2 10 5 13 5" />
                    <polyline points="6 8.5 5 10 6 11.5" />
                    <polyline points="10 8.5 11 10 10 11.5" />
                  {:else if icon === 'config'}
                    <path d="M10 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V5L10 2Z" />
                    <polyline points="10 2 10 5 13 5" />
                    <circle cx="8" cy="10" r="1.5" />
                    <path d="M8 7v1.5" />
                    <path d="M8 11.5V13" />
                  {:else if icon === 'doc'}
                    <path d="M10 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V5L10 2Z" />
                    <polyline points="10 2 10 5 13 5" />
                    <line x1="6" y1="8" x2="10" y2="8" />
                    <line x1="6" y1="10.5" x2="9" y2="10.5" />
                  {:else if icon === 'image'}
                    <rect x="3" y="3" width="10" height="10" rx="1.5" />
                    <circle cx="6" cy="6.5" r="1" />
                    <path d="M13 10l-2.5-3L8 10l-2-1.5L3 12" />
                  {:else if icon === 'data'}
                    <ellipse cx="8" cy="4.5" rx="4.5" ry="1.5" />
                    <path d="M3.5 4.5v7c0 .83 2 1.5 4.5 1.5s4.5-.67 4.5-1.5v-7" />
                    <path d="M3.5 8c0 .83 2 1.5 4.5 1.5s4.5-.67 4.5-1.5" />
                  {:else}
                    <path d="M10 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V5L10 2Z" />
                    <polyline points="10 2 10 5 13 5" />
                  {/if}
                </svg>
              {/if}

              <span class="min-w-0 flex-1 truncate">
                {#each parts as part}
                  {#if part.highlight}
                    <mark class="bg-accent/20 rounded-sm font-semibold text-text-primary">{part.text}</mark>
                  {:else}
                    {part.text}
                  {/if}
                {/each}
              </span>
            </button>
          {/each}
        {/each}
      {/if}
    </div>
  </div>
{/if}
