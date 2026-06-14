import type { CommandItem, PaletteProvider, ScoredCommandItem } from './types'

export interface ConfirmProviderOptions {
  title: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export const createConfirmProvider = ({
  title,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmProviderOptions): PaletteProvider => {
  const items: CommandItem[] = [
    {
      id: 'confirm.yes',
      label: `${confirmLabel}: ${title}`,
      group: 'Confirm',
      keywords: ['yes', 'confirm', 'ok', 'accept'],
      enabled: () => true,
      run: () => onConfirm(),
    },
    {
      id: 'confirm.no',
      label: cancelLabel,
      group: 'Confirm',
      keywords: ['no', 'cancel', 'back', 'dismiss'],
      enabled: () => true,
      run: () => onCancel(),
    },
  ]

  const results: ScoredCommandItem[] = items.map((item, index) => ({
    item,
    matchRanges: [],
    score: 100 - index,
  }))

  return {
    id: 'confirm',
    mode: 'command',
    getItems: () => results,
    onSelect: (item) => {
      item.run()
    },
    onDismiss: () => {
      onCancel()
    },
  }
}
