import type { PreviewItem } from './types'

export interface PreviewController {
  readonly isOpen: boolean
  readonly items: readonly PreviewItem[]
  readonly index: number
  readonly currentItem: PreviewItem | null
  openItem: (item: PreviewItem) => void
  openGallery: (items: readonly PreviewItem[], startIndex?: number) => void
  close: () => void
  next: () => void
  prev: () => void
  goTo: (index: number) => void
}

const clampIndex = (index: number, length: number): number => {
  if (length <= 0) {
    return 0
  }
  return Math.max(0, Math.min(length - 1, index))
}

export const createPreviewController = (): PreviewController => {
  const state = $state<{
    open: boolean
    items: PreviewItem[]
    index: number
  }>({
    open: false,
    items: [],
    index: 0,
  })

  return {
    get isOpen() {
      return state.open
    },

    get items() {
      return state.items
    },

    get index() {
      return state.index
    },

    get currentItem() {
      return state.items[state.index] ?? null
    },

    openItem(item) {
      state.items = [item]
      state.index = 0
      state.open = true
    },

    openGallery(items: readonly PreviewItem[], startIndex = 0) {
      const list = [...items]
      if (list.length === 0) {
        state.open = false
        state.items = []
        state.index = 0
        return
      }

      state.items = list
      state.index = clampIndex(startIndex, list.length)
      state.open = true
    },

    close() {
      state.open = false
      state.items = []
      state.index = 0
    },

    next() {
      if (state.items.length <= 1) {
        return
      }
      state.index = (state.index + 1) % state.items.length
    },

    prev() {
      if (state.items.length <= 1) {
        return
      }
      state.index = (state.index - 1 + state.items.length) % state.items.length
    },

    goTo(index: number) {
      state.index = clampIndex(index, state.items.length)
    },
  }
}
