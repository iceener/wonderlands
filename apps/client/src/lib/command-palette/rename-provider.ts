import type { CommandItem, PaletteProvider, ScoredCommandItem } from './types'

export interface RenameProviderOptions {
  currentTitle: string
  getCurrentTitle?: () => string
  onRename: (title: string) => void
  onRegenerate?: () => void | Promise<void>
  canRegenerate?: () => boolean
  isRegenerating?: () => boolean
  onCancel: () => void
}

/**
 * Provider that reuses the palette's search input as a rename field.
 * The query IS the new title — Enter confirms it, Escape cancels.
 */
export const createRenameProvider = ({
  currentTitle,
  getCurrentTitle,
  onRename,
  onRegenerate,
  canRegenerate,
  isRegenerating,
  onCancel,
}: RenameProviderOptions): PaletteProvider => {
  let latestQuery = currentTitle
  const resolveCurrentTitle = (): string => getCurrentTitle?.() ?? currentTitle

  const makeItems = (): ScoredCommandItem[] => {
    const trimmed = latestQuery.trim()
    const isDirty = trimmed.length > 0 && trimmed !== resolveCurrentTitle().trim()

    const items: CommandItem[] = isDirty
      ? [
          {
            id: 'rename.confirm',
            label: `Rename to "${trimmed}"`,
            group: 'Rename Conversation',
            keywords: ['rename', 'save', 'confirm'],
            enabled: () => true,
            run: () => onRename(trimmed),
          },
        ]
      : [
          {
            id: 'rename.hint',
            label: 'Type a new title, then press Enter',
            group: 'Rename Conversation',
            keywords: [],
            enabled: () => true,
            run: () => undefined,
          },
        ]

    return items.map((item, index) => ({
      item,
      matchRanges: [],
      score: 100 - index,
    }))
  }

  return {
    id: 'rename',
    mode: 'command',
    inputAction: onRegenerate
      ? {
          label: () => (isRegenerating?.() ? 'Naming…' : 'Auto-rename'),
          disabled: () => {
            if (!canRegenerate) return false
            return !canRegenerate()
          },
          run: () => onRegenerate(),
        }
      : undefined,
    getItems: () => makeItems(),
    onQueryChange(query) {
      latestQuery = query
    },
    onOpen() {
      latestQuery = resolveCurrentTitle()
    },
    onSelect(item) {
      item.run()
    },
    onDismiss() {
      onCancel()
    },
  }
}
