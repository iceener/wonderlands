const MODIFIER_ALIASES = new Map<string, 'Mod' | 'Alt' | 'Shift'>([
  ['alt', 'Alt'],
  ['cmd', 'Mod'],
  ['command', 'Mod'],
  ['control', 'Mod'],
  ['ctrl', 'Mod'],
  ['meta', 'Mod'],
  ['mod', 'Mod'],
  ['option', 'Alt'],
  ['shift', 'Shift'],
])

const EVENT_KEY_ALIASES = new Map<string, string>([
  [' ', 'Space'],
  ['arrowdown', 'ArrowDown'],
  ['arrowleft', 'ArrowLeft'],
  ['arrowright', 'ArrowRight'],
  ['arrowup', 'ArrowUp'],
  ['backspace', 'Backspace'],
  ['delete', 'Delete'],
  ['del', 'Delete'],
  ['enter', 'Enter'],
  ['esc', 'Escape'],
  ['escape', 'Escape'],
  ['space', 'Space'],
  ['tab', 'Tab'],
])

const isModifierAlias = (token: string): boolean => MODIFIER_ALIASES.has(token.toLowerCase())

const normalizeBaseKey = (token: string): string | null => {
  const trimmed = token.trim()
  if (!trimmed) {
    return null
  }

  const normalizedAlias = EVENT_KEY_ALIASES.get(trimmed.toLowerCase())
  if (normalizedAlias) {
    return normalizedAlias
  }

  if (/^Key[A-Z]$/u.test(trimmed)) {
    return trimmed.slice(3)
  }

  if (/^Digit[0-9]$/u.test(trimmed)) {
    return trimmed.slice(5)
  }

  if (trimmed.length === 1) {
    return trimmed.toUpperCase()
  }

  return trimmed
}

const formatShortcut = (
  modifiers: ReadonlySet<'Mod' | 'Alt' | 'Shift'>,
  baseKey: string,
): string => {
  const ordered: string[] = []

  if (modifiers.has('Mod')) {
    ordered.push('Mod')
  }

  if (modifiers.has('Alt')) {
    ordered.push('Alt')
  }

  if (modifiers.has('Shift')) {
    ordered.push('Shift')
  }

  ordered.push(baseKey)

  return ordered.join('+')
}

export const normalizeShortcutKey = (shortcut: string): string => {
  const tokens = shortcut
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

  const modifiers = new Set<'Mod' | 'Alt' | 'Shift'>()
  let baseKey: string | null = null

  for (const token of tokens) {
    const normalizedModifier = MODIFIER_ALIASES.get(token.toLowerCase())
    if (normalizedModifier) {
      modifiers.add(normalizedModifier)
      continue
    }

    if (baseKey != null) {
      throw new Error(`Shortcut "${shortcut}" declares more than one non-modifier key.`)
    }

    baseKey = normalizeBaseKey(token)
  }

  if (!baseKey || isModifierAlias(baseKey)) {
    throw new Error(`Shortcut "${shortcut}" must include a non-modifier key.`)
  }

  return formatShortcut(modifiers, baseKey)
}

const deriveBaseKeyFromEvent = (event: Pick<KeyboardEvent, 'code' | 'key'>): string | null => {
  if (/^Key[A-Z]$/u.test(event.code)) {
    return event.code.slice(3)
  }

  if (/^Digit[0-9]$/u.test(event.code)) {
    return event.code.slice(5)
  }

  if (event.key === 'Dead') {
    return null
  }

  const normalized = normalizeBaseKey(event.key)
  if (!normalized || isModifierAlias(normalized)) {
    return null
  }

  return normalized
}

export const normalizeKeyboardEvent = (
  event: Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
): string | null => {
  const baseKey = deriveBaseKeyFromEvent(event)
  if (!baseKey) {
    return null
  }

  const modifiers = new Set<'Mod' | 'Alt' | 'Shift'>()

  if (event.metaKey || event.ctrlKey) {
    modifiers.add('Mod')
  }

  if (event.altKey) {
    modifiers.add('Alt')
  }

  if (event.shiftKey) {
    modifiers.add('Shift')
  }

  return formatShortcut(modifiers, baseKey)
}
