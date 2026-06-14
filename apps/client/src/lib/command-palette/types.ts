import type { ThreadActivityState } from '@wonderlands/contracts/chat'

export type PaletteMode = 'command' | 'conversation' | 'mention' | 'workspace'
export type CommandSurface = 'palette' | 'slash'
export type CommandNavigationType = 'instant' | 'form' | 'browser' | 'dialog'

export interface CommandItemActivity {
  state: ThreadActivityState
  label: string
}

export interface CommandItem {
  id: string
  label: string
  group: string
  activity?: CommandItemActivity
  navigationType?: CommandNavigationType
  shortcutHint?: string
  keywords?: string[]
  surfaces?: readonly CommandSurface[]
  enabled: () => boolean
  run: () => void | Promise<void>
}

export interface MatchRange {
  start: number
  end: number
}

export interface ScoredCommandItem {
  item: CommandItem
  score: number
  matchRanges: MatchRange[]
}

export interface PaletteInputAction {
  label: () => string
  disabled?: () => boolean
  run: () => void | Promise<void>
}

export interface PaletteProvider {
  id: string
  mode: PaletteMode
  getItems: (query: string) => ScoredCommandItem[]
  inputAction?: PaletteInputAction
  onQueryChange?: (query: string) => void | Promise<void>
  onOpen?: () => void | Promise<void>
  onSelect: (item: CommandItem) => void
  onDismiss?: () => void
}
