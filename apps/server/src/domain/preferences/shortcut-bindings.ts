import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'

export type ShortcutBindingValue = string | null
export type ShortcutBindingOverrides = Record<string, ShortcutBindingValue>

export const DEFAULT_SHORTCUT_BINDINGS = {
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
  'mcp.connect': null,
  'mcp.manage': null,
  'mcp.tool-profiles': null,
  'palette.toggle': 'Mod+K',
  'settings.cycle-model': 'Mod+Alt+M',
  'settings.cycle-reasoning': 'Mod+Alt+E',
  'settings.cycle-theme': 'Mod+Alt+L',
  'settings.cycle-typewriter': 'Mod+Alt+T',
  'workspace.switch': null,
} as const satisfies Record<string, ShortcutBindingValue>

export type RebindableShortcutActionId = keyof typeof DEFAULT_SHORTCUT_BINDINGS

const REBINDABLE_SHORTCUT_ACTION_IDS = Object.keys(
  DEFAULT_SHORTCUT_BINDINGS,
) as RebindableShortcutActionId[]
const REBINDABLE_SHORTCUT_ACTION_ID_SET = new Set<string>(REBINDABLE_SHORTCUT_ACTION_IDS)
const MODIFIER_ALIASES = new Map<string, 'Alt' | 'Mod' | 'Shift'>([
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
  modifiers: ReadonlySet<'Alt' | 'Mod' | 'Shift'>,
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

  const modifiers = new Set<'Alt' | 'Mod' | 'Shift'>()
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

const hasOwn = (value: object, key: string): boolean => Object.hasOwn(value, key)

const toValidationError = (message: string): Result<never, DomainError> =>
  err({
    message,
    type: 'validation',
  })

const normalizeShortcutBindingValue = (
  actionId: string,
  value: ShortcutBindingValue,
): Result<ShortcutBindingValue, DomainError> => {
  if (value === null) {
    return ok(null)
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return ok(null)
  }

  try {
    return ok(normalizeShortcutKey(trimmed))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid shortcut syntax.'
    return toValidationError(`Shortcut binding for ${actionId} is invalid: ${message}`)
  }
}

const validateKnownActionId = (
  actionId: string,
): Result<RebindableShortcutActionId, DomainError> => {
  if (!REBINDABLE_SHORTCUT_ACTION_ID_SET.has(actionId)) {
    return toValidationError(`Shortcut action "${actionId}" is not rebindable.`)
  }

  return ok(actionId as RebindableShortcutActionId)
}

export const resolveShortcutBindings = (
  overrides: ShortcutBindingOverrides,
): Record<RebindableShortcutActionId, ShortcutBindingValue> => {
  const resolved: Record<RebindableShortcutActionId, ShortcutBindingValue> = {
    ...DEFAULT_SHORTCUT_BINDINGS,
  }

  for (const actionId of REBINDABLE_SHORTCUT_ACTION_IDS) {
    if (hasOwn(overrides, actionId)) {
      resolved[actionId] = overrides[actionId] ?? null
    }
  }

  return resolved
}

const validateNoShortcutConflicts = (
  resolved: Record<RebindableShortcutActionId, ShortcutBindingValue>,
  changedActionIds?: ReadonlySet<string>,
): Result<void, DomainError> => {
  const assignedActions = new Map<string, RebindableShortcutActionId>()

  for (const actionId of REBINDABLE_SHORTCUT_ACTION_IDS) {
    const keys = resolved[actionId]
    if (keys == null) {
      continue
    }

    const existingActionId = assignedActions.get(keys)
    if (existingActionId) {
      const existingChanged = changedActionIds?.has(existingActionId) ?? false
      const currentChanged = changedActionIds?.has(actionId) ?? false
      const conflictingActionId =
        existingChanged && !currentChanged
          ? actionId
          : !existingChanged && currentChanged
            ? existingActionId
            : existingActionId

      return toValidationError(`Shortcut ${keys} is already assigned to ${conflictingActionId}`)
    }

    assignedActions.set(keys, actionId)
  }

  return ok(undefined)
}

const canonicalizeShortcutBindingOverridesInternal = (
  bindings: ShortcutBindingOverrides,
  changedActionIds?: readonly string[],
): Result<ShortcutBindingOverrides, DomainError> => {
  const normalized: ShortcutBindingOverrides = {}

  for (const [actionId, value] of Object.entries(bindings)) {
    const knownAction = validateKnownActionId(actionId)
    if (!knownAction.ok) {
      return knownAction
    }

    const normalizedValue = normalizeShortcutBindingValue(knownAction.value, value)
    if (!normalizedValue.ok) {
      return normalizedValue
    }

    if (normalizedValue.value !== DEFAULT_SHORTCUT_BINDINGS[knownAction.value]) {
      normalized[knownAction.value] = normalizedValue.value
    }
  }

  const resolved = resolveShortcutBindings(normalized)
  const noConflicts = validateNoShortcutConflicts(
    resolved,
    changedActionIds ? new Set(changedActionIds) : undefined,
  )
  if (!noConflicts.ok) {
    return noConflicts
  }

  return ok(normalized)
}

export const canonicalizeShortcutBindingOverrides = (
  bindings: ShortcutBindingOverrides,
): Result<ShortcutBindingOverrides, DomainError> =>
  canonicalizeShortcutBindingOverridesInternal(bindings)

export const mergeShortcutBindingOverrides = (
  current: ShortcutBindingOverrides,
  patch: ShortcutBindingOverrides,
): Result<ShortcutBindingOverrides, DomainError> =>
  canonicalizeShortcutBindingOverridesInternal(
    {
      ...current,
      ...patch,
    },
    Object.keys(patch),
  )

export const resetShortcutBindingOverrides = (
  current: ShortcutBindingOverrides,
  actionIds?: readonly string[],
): Result<ShortcutBindingOverrides, DomainError> => {
  if (!actionIds || actionIds.length === 0) {
    return ok({})
  }

  const next = { ...current }

  for (const actionId of actionIds) {
    const knownAction = validateKnownActionId(actionId)
    if (!knownAction.ok) {
      return knownAction
    }

    delete next[knownAction.value]
  }

  return canonicalizeShortcutBindingOverrides(next)
}

export const parseStoredShortcutBindings = (
  storedValue: string | null,
): Result<ShortcutBindingOverrides, DomainError> => {
  if (storedValue == null || storedValue.trim().length === 0) {
    return ok({})
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(storedValue)
  } catch {
    return err({
      message: 'Stored shortcut bindings are not valid JSON.',
      type: 'conflict',
    })
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return err({
      message: 'Stored shortcut bindings must be a JSON object.',
      type: 'conflict',
    })
  }

  const rawBindings: ShortcutBindingOverrides = {}

  for (const [actionId, value] of Object.entries(parsed)) {
    if (typeof value !== 'string' && value !== null) {
      return err({
        message: `Stored shortcut binding for ${actionId} must be a string or null.`,
        type: 'conflict',
      })
    }

    rawBindings[actionId] = value
  }

  const normalized = canonicalizeShortcutBindingOverrides(rawBindings)
  if (!normalized.ok) {
    return err({
      message: `Stored shortcut bindings are invalid: ${normalized.error.message}`,
      type: 'conflict',
    })
  }

  return normalized
}

export const serializeShortcutBindingOverrides = (
  overrides: ShortcutBindingOverrides,
): string | null => {
  const orderedEntries: Array<[string, ShortcutBindingValue]> = []

  for (const actionId of REBINDABLE_SHORTCUT_ACTION_IDS) {
    if (hasOwn(overrides, actionId)) {
      orderedEntries.push([actionId, overrides[actionId] ?? null])
    }
  }

  if (orderedEntries.length === 0) {
    return null
  }

  return JSON.stringify(Object.fromEntries(orderedEntries))
}
