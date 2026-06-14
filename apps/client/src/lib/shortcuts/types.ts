export type ShortcutScope = 'global' | 'popover' | 'modal' | 'lightbox'

export interface ShortcutContext {
  activeScope: ShortcutScope
  normalizedKey: string
  originalEvent: KeyboardEvent
  targetIsEditable: boolean
}

export interface ShortcutDefinition {
  id: string
  description: string
  keys: string[]
  scope: ShortcutScope
  allowInEditable?: boolean
  allowRepeat?: boolean
  preventDefault?: boolean
  stopPropagation?: boolean
  when?: (context: ShortcutContext) => boolean
  run: (context: ShortcutContext) => void | Promise<void>
}

export interface RegisteredShortcutDefinition extends ShortcutDefinition {
  normalizedKeys: string[]
}

export interface ShortcutListenerTarget {
  addEventListener: (type: 'keydown', listener: (event: KeyboardEvent) => void) => void
  removeEventListener: (type: 'keydown', listener: (event: KeyboardEvent) => void) => void
}
