<script lang="ts">
import { onMount, tick } from 'svelte'
import { getPaletteStoreContext } from '../command-palette/palette-store.svelte'
import { getShortcutManagerContext } from '../shortcuts/shortcut-manager'
import type { MatchRange } from './types'

interface Props {
  onClose?: (() => void) | null
}

let { onClose = null }: Props = $props()

const palette = getPaletteStoreContext()
const shortcutManager = getShortcutManagerContext()

let inputEl: HTMLInputElement | null = $state(null)
let listEl: HTMLDivElement | null = $state(null)
let popoverEl: HTMLDivElement | null = $state(null)
let wasOpen = $state(false)
let triggerElement: Element | null = null

const showsSearchInput = $derived(
  palette.mode === 'command' ||
    palette.mode === 'conversation' ||
    palette.mode === 'workspace' ||
    palette.activeProvider?.id === 'agents',
)
const autoFocusSearchInput = $derived(
  palette.mode === 'command' || palette.mode === 'conversation' || palette.mode === 'workspace',
)
const searchPlaceholder = $derived.by(() => {
  if (palette.activeProvider?.id === 'agents') {
    return 'Search agents...'
  }

  if (palette.mode === 'conversation') {
    return 'Search conversations...'
  }

  if (palette.mode === 'workspace') {
    return 'Search workspaces...'
  }

  return 'Search commands...'
})
const inputAction = $derived(palette.activeProvider?.inputAction ?? null)

const scrollSelectedIntoView = () => {
  if (!listEl) return
  const active = listEl.querySelector('[data-active="true"]')
  active?.scrollIntoView({ block: 'nearest' })
}

$effect(() => {
  if (palette.isOpen) {
    // Capture the element that had focus before the palette opened
    if (!wasOpen) {
      triggerElement = document.activeElement as Element | null
    }
    wasOpen = true
    if (showsSearchInput && autoFocusSearchInput) {
      void tick().then(() => {
        inputEl?.focus()
      })
    }
  } else if (wasOpen) {
    wasOpen = false
    const elementToRestore = triggerElement
    triggerElement = null
    void tick().then(() => {
      // Restore focus to the element that triggered the palette
      if (elementToRestore && typeof (elementToRestore as HTMLElement).focus === 'function') {
        ;(elementToRestore as HTMLElement).focus()
      }
      onClose?.()
    })
  }
})

$effect(() => {
  void palette.selectedIndex
  void tick().then(scrollSelectedIntoView)
})

// Close when clicking outside the popover
const handleDocumentPointerDown = (event: PointerEvent) => {
  if (!palette.isOpen || !popoverEl) return
  if (!popoverEl.contains(event.target as Node)) {
    palette.close()
  }
}

$effect(() => {
  if (!palette.isOpen) return

  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  return () => {
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
  }
})

const handleInputKeydown = (event: KeyboardEvent) => {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      palette.moveSelection(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      palette.moveSelection(-1)
      break
    case 'Enter':
      event.preventDefault()
      palette.executeSelected()
      break
    case 'Escape':
      event.preventDefault()
      palette.close()
      break
  }
}

const handleItemPointerDown = (index: number) => {
  const result = palette.results[index]
  if (!result) return
  // Ensure the clicked item is selected, then execute without triggering onDismiss
  palette.selectIndex(index)
  palette.executeSelected()
}

const highlightLabel = (
  label: string,
  ranges: MatchRange[],
): Array<{ text: string; highlight: boolean }> => {
  if (ranges.length === 0) {
    return [{ text: label, highlight: false }]
  }

  const parts: Array<{ text: string; highlight: boolean }> = []
  let cursor = 0

  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push({ text: label.slice(cursor, range.start), highlight: false })
    }
    parts.push({ text: label.slice(range.start, range.end), highlight: true })
    cursor = range.end
  }

  if (cursor < label.length) {
    parts.push({ text: label.slice(cursor), highlight: false })
  }

  return parts
}

const navigationIndicator = (navigationType: string | undefined): string => {
  if (navigationType === 'form') {
    return '->'
  }

  if (navigationType === 'browser') {
    return '...'
  }

  return ''
}

onMount(() => {
  return shortcutManager.registerShortcuts([
    {
      id: 'palette.close',
      description: 'Close palette',
      keys: ['Escape'],
      scope: 'popover',
      allowInEditable: true,
      run: () => {
        palette.close()
      },
    },
    {
      id: 'palette.move-down',
      description: 'Next item',
      keys: ['ArrowDown'],
      scope: 'popover',
      allowInEditable: true,
      allowRepeat: true,
      run: () => {
        palette.moveSelection(1)
      },
    },
    {
      id: 'palette.move-up',
      description: 'Previous item',
      keys: ['ArrowUp'],
      scope: 'popover',
      allowInEditable: true,
      allowRepeat: true,
      run: () => {
        palette.moveSelection(-1)
      },
    },
    {
      id: 'palette.execute',
      description: 'Execute selected item',
      keys: ['Enter'],
      scope: 'popover',
      allowInEditable: true,
      run: () => {
        palette.executeSelected()
      },
    },
  ])
})
</script>

{#if palette.isOpen}
  <div
    bind:this={popoverEl}
    class="fixed bottom-24 left-1/2 z-40 flex w-[min(calc(100vw-2rem),var(--chat-max-w))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border bg-surface-0 shadow-xl"
    role="listbox"
    aria-label="Command palette"
    style="animation: popover-enter 120ms cubic-bezier(0.16, 1, 0.3, 1)"
  >
    <!-- Results list (above input in visual order since popover grows upward) -->
    <div
      bind:this={listEl}
      class="max-h-[min(40dvh,20rem)] overflow-y-auto overscroll-contain px-2 py-2"
    >
      {#if palette.results.length === 0}
        <div class="px-3 py-3 text-center text-sm text-text-tertiary">
          No results found
        </div>
      {:else}
        {#each palette.results as result, flatIndex (result.item.id)}
          {#if flatIndex === 0 || palette.results[flatIndex - 1]?.item.group !== result.item.group}
            <div class="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary first:pt-0">
              {result.item.group}
            </div>
          {/if}

          {@const isSelected = flatIndex === palette.selectedIndex}
          {@const parts = highlightLabel(result.item.label, result.matchRanges)}
          {@const isActionable = result.item.run !== undefined && result.item.run.toString() !== '() => undefined'}
          {@const isPlaceholder = result.item.id.endsWith('.loading') || result.item.id.endsWith('.hint')}
          {@const indicator = navigationIndicator(result.item.navigationType)}

          <button
            type="button"
            class="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[13px] transition-colors {isPlaceholder ? 'cursor-default text-text-tertiary' : isSelected ? 'bg-accent/10 text-accent-text' : 'text-text-primary hover:bg-surface-1'}"
            role="option"
            aria-selected={isSelected}
            aria-disabled={isPlaceholder || undefined}
            data-active={isSelected || undefined}
            onpointerenter={() => { palette.selectIndex(flatIndex) }}
            onpointerdown={(e) => { e.preventDefault(); if (!isPlaceholder) handleItemPointerDown(flatIndex) }}
          >
            <span class="flex-1 truncate">
              {#each parts as part, partIndex (partIndex)}
                {#if part.highlight}
                  <mark class="bg-transparent font-semibold text-accent-text">{part.text}</mark>
                {:else}
                  {part.text}
                {/if}
              {/each}
            </span>

            {#if result.item.activity}
              <span class="palette-activity shrink-0 inline-flex items-center gap-1.5 text-[10px] font-medium" data-activity={result.item.activity.state}>
                <span class="palette-activity-dot"></span>
                {result.item.activity.label}
              </span>
            {/if}

            {#if result.item.shortcutHint}
              <kbd class="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">
                {result.item.shortcutHint}
              </kbd>
            {/if}
            {#if indicator}
              <span class="shrink-0 text-[11px] font-medium text-text-tertiary">
                {indicator}
              </span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>

    <!-- Search input — command mode only -->
    {#if showsSearchInput}
      <div class="flex items-center gap-3 border-t border-border px-4 py-2.5">
        {#if palette.activeProvider?.id === 'rename'}
          <svg class="h-4 w-4 shrink-0 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13 20l7 -7" />
            <path d="M13 20v-6a1 1 0 0 1 1 -1h6v-7a2 2 0 0 0 -2 -2h-12a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7" />
          </svg>
        {:else}
          <svg class="h-4 w-4 shrink-0 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        {/if}
        <input
          bind:this={inputEl}
          type="text"
          class="flex-1 bg-transparent text-sm text-text-primary placeholder-text-tertiary outline-none"
          placeholder={searchPlaceholder}
          value={palette.query}
          oninput={(e) => palette.setQuery(e.currentTarget.value)}
          onkeydown={handleInputKeydown}
          spellcheck="false"
          autocomplete="off"
        />
        {#if inputAction}
          <button
            type="button"
            class="shrink-0 rounded border border-border bg-surface-1 px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong disabled:cursor-not-allowed disabled:opacity-40"
            disabled={inputAction.disabled?.() ?? false}
            onclick={() => {
              void inputAction.run()
            }}
          >
            {inputAction.label()}
          </button>
        {/if}
        <div class="flex shrink-0 items-center gap-1.5 text-[10px] text-text-tertiary">
          <kbd class="rounded border border-border bg-surface-1 px-1 py-px">&#8593;&#8595;</kbd>
          <kbd class="rounded border border-border bg-surface-1 px-1 py-px">&#9166;</kbd>
          <kbd class="rounded border border-border bg-surface-1 px-1 py-px">esc</kbd>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  @keyframes popover-enter {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* ── Activity indicators ── */
  .palette-activity-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    background: currentcolor;
  }

  .palette-activity[data-activity="running"] {
    color: var(--color-accent);
  }
  .palette-activity[data-activity="running"] .palette-activity-dot {
    animation: palette-dot-pulse 1.5s ease-in-out infinite;
  }

  .palette-activity[data-activity="pending"] {
    color: var(--color-text-tertiary);
  }

  .palette-activity[data-activity="waiting"] {
    color: var(--color-warning-text);
  }

  .palette-activity[data-activity="approval"] {
    color: var(--color-warning-text);
  }
  .palette-activity[data-activity="approval"] .palette-activity-dot {
    animation: palette-dot-pulse 1s ease-in-out infinite;
  }

  .palette-activity[data-activity="failed"] {
    color: var(--color-error-text, #ef4444);
  }

  .palette-activity[data-activity="completed"] {
    color: var(--color-success-text);
  }

  @keyframes palette-dot-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
</style>
