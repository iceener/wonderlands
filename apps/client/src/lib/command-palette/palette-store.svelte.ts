import { getContext, setContext } from 'svelte'
import type { ShortcutLayerStack } from '../ui/layer-stack'
import type { CommandItem, PaletteMode, PaletteProvider, ScoredCommandItem } from './types'

const PALETTE_STORE_CONTEXT = Symbol('palette-store')

export interface PaletteStore {
  readonly isOpen: boolean
  readonly mode: PaletteMode
  readonly activeProvider: PaletteProvider | null
  readonly query: string
  readonly selectedIndex: number
  readonly selectedItem: CommandItem | null
  readonly results: ScoredCommandItem[]
  openWith: (provider: PaletteProvider) => void
  close: () => void
  setQuery: (query: string) => void
  moveSelection: (delta: number) => void
  selectIndex: (index: number) => void
  executeSelected: () => void
}

export interface CreatePaletteStoreOptions {
  layerStack: ShortcutLayerStack
}

export const createPaletteStore = ({ layerStack }: CreatePaletteStoreOptions): PaletteStore => {
  let isOpen = $state(false)
  let activeProvider = $state<PaletteProvider | null>(null)
  let query = $state('')
  let selectedIndex = $state(0)
  let selectedId = $state<string | null>(null)
  let removeLayer: (() => void) | null = null

  const results = $derived(activeProvider ? activeProvider.getItems(query) : [])

  // Reconcile selectedIndex when results change but selectedId is still present.
  $effect(() => {
    const count = results.length
    if (count === 0) return
    if (!selectedId) {
      // No tracked ID yet — just clamp index
      if (selectedIndex >= count) {
        selectedIndex = count - 1
      }
      return
    }
    const idx = results.findIndex((r) => r.item.id === selectedId)
    if (idx >= 0 && idx !== selectedIndex) {
      selectedIndex = idx
    } else if (idx < 0) {
      const clamped = Math.min(selectedIndex, count - 1)
      selectedIndex = clamped
      selectedId = results[clamped]?.item.id ?? null
    }
  })

  const openWith = (provider: PaletteProvider): void => {
    if (isOpen && activeProvider?.id === provider.id) {
      close()
      return
    }

    if (isOpen) {
      removeLayer?.()
      removeLayer = null
      activeProvider?.onDismiss?.()
    }

    activeProvider = provider
    query = ''
    selectedIndex = 0
    selectedId = null
    isOpen = true
    removeLayer = layerStack.pushLayer('popover', `palette:${provider.id}`)
    void provider.onQueryChange?.(query)
    void provider.onOpen?.()
  }

  const teardown = (): PaletteProvider | null => {
    if (!isOpen) return null
    const provider = activeProvider
    isOpen = false
    query = ''
    selectedIndex = 0
    selectedId = null
    activeProvider = null
    removeLayer?.()
    removeLayer = null
    return provider
  }

  const close = (): void => {
    const provider = teardown()
    provider?.onDismiss?.()
  }

  const setQuery = (nextQuery: string): void => {
    query = nextQuery
    selectedIndex = 0
    selectedId = null
    void activeProvider?.onQueryChange?.(nextQuery)
  }

  const selectedItem = $derived(results[selectedIndex]?.item ?? null)

  const moveSelection = (delta: number): void => {
    const count = results.length
    if (count === 0) return
    const _prev = selectedIndex
    selectedIndex = (selectedIndex + delta + count) % count
    selectedId = results[selectedIndex]?.item.id ?? null
  }

  const selectIndex = (index: number): void => {
    const count = results.length
    if (count === 0) return
    selectedIndex = Math.max(0, Math.min(index, count - 1))
    selectedId = results[selectedIndex]?.item.id ?? null
  }

  const executeSelected = (): void => {
    const item = selectedItem
    if (!item || !activeProvider) return
    const provider = activeProvider
    // Use teardown instead of close to avoid calling onDismiss before onSelect.
    // onDismiss is for cancellation (Escape, click-outside), not for item selection.
    teardown()
    provider.onSelect(item)
  }

  return {
    get isOpen() {
      return isOpen
    },
    get mode() {
      return activeProvider?.mode ?? 'command'
    },
    get activeProvider() {
      return activeProvider
    },
    get query() {
      return query
    },
    get selectedIndex() {
      return selectedIndex
    },
    get selectedItem() {
      return selectedItem
    },
    get results() {
      return results
    },
    openWith,
    close,
    setQuery,
    moveSelection,
    selectIndex,
    executeSelected,
  }
}

export const setPaletteStoreContext = (store: PaletteStore): PaletteStore => {
  setContext(PALETTE_STORE_CONTEXT, store)
  return store
}

export const getPaletteStoreContext = (): PaletteStore =>
  getContext<PaletteStore>(PALETTE_STORE_CONTEXT)
