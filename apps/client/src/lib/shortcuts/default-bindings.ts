import type { ShortcutBindings } from '@wonderlands/contracts/chat'

export const DEFAULT_SHORTCUT_BINDINGS: Record<string, string | null> = {
  'account.sign-out': null,
  'agents.manage': 'Mod+Alt+A',
  'agents.new': null,
  'chat.delete-conversation': null,
  'chat.new-conversation': 'Mod+Alt+N',
  'chat.next-conversation': 'Mod+]',
  'chat.previous-conversation': 'Mod+[',
  'chat.rename-conversation': 'Mod+Alt+R',
  'chat.switch-conversation': 'Mod+Alt+O',
  'chat.upload-attachment': 'Mod+Alt+U',
  'garden.manage': null,
  'garden.new': null,
  'mcp.connect': null,
  'mcp.manage': null,
  'mcp.tool-profiles': null,
  'palette.toggle': 'Mod+K',
  'settings.cycle-model': 'Mod+Alt+M',
  'settings.cycle-reasoning': 'Mod+Alt+E',
  'settings.cycle-theme': 'Mod+Alt+L',
  'settings.keyboard-shortcuts': null,
  'settings.cycle-typewriter': 'Mod+Alt+T',
  'workspace.switch': null,
}

export type ResolvedShortcutBindings = Record<string, string | null>

export const resolveShortcutBindings = (overrides: ShortcutBindings): ResolvedShortcutBindings => {
  const resolved = { ...DEFAULT_SHORTCUT_BINDINGS }

  for (const [actionId, value] of Object.entries(overrides)) {
    if (actionId in resolved) {
      resolved[actionId] = value
    }
  }

  return resolved
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent)

export const formatShortcutHint = (keys: string): string => {
  if (isMac) {
    return keys.replace(/Mod/g, '⌘').replace(/Alt/g, '⌥').replace(/Shift/g, '⇧').replace(/\+/g, '')
  }

  return keys.replace(/Mod/g, 'Ctrl')
}
