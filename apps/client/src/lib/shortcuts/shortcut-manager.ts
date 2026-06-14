import { getContext, setContext } from 'svelte'
import type { ShortcutLayerStack } from '../ui/layer-stack'
import { normalizeKeyboardEvent, normalizeShortcutKey } from './normalize'
import type {
  RegisteredShortcutDefinition,
  ShortcutContext,
  ShortcutDefinition,
  ShortcutListenerTarget,
} from './types'

const SHORTCUT_MANAGER_CONTEXT = Symbol('shortcut-manager')

const isEditableElement = (target: EventTarget | null): boolean => {
  if (typeof Element === 'undefined') {
    return false
  }

  if (!(target instanceof Element)) {
    return false
  }

  return (
    target.closest(
      'input, textarea, select, .ProseMirror, [contenteditable=""], [contenteditable="true"]',
    ) != null
  )
}

export interface ShortcutManager {
  getShortcuts: () => ShortcutDefinition[]
  handleKeydown: (event: KeyboardEvent) => boolean
  registerShortcuts: (definitions: ShortcutDefinition[]) => () => void
  start: () => () => void
}

export interface CreateShortcutManagerOptions {
  isEditableTarget?: (target: EventTarget | null) => boolean
  layerStack: ShortcutLayerStack
  target?: ShortcutListenerTarget | null
}

export const createShortcutManager = ({
  isEditableTarget = isEditableElement,
  layerStack,
  target = typeof window === 'undefined' ? null : window,
}: CreateShortcutManagerOptions): ShortcutManager => {
  const registeredShortcuts: RegisteredShortcutDefinition[] = []
  let stopListening: (() => void) | null = null

  const handleKeydown = (event: KeyboardEvent): boolean => {
    if (event.defaultPrevented || event.isComposing) {
      return false
    }

    const normalizedKey = normalizeKeyboardEvent(event)
    if (!normalizedKey) {
      return false
    }

    const activeScope = layerStack.getActiveScope()
    const targetIsEditable = isEditableTarget(event.target)

    for (let index = registeredShortcuts.length - 1; index >= 0; index -= 1) {
      const shortcut = registeredShortcuts[index]

      if (shortcut.scope !== activeScope) {
        continue
      }

      if (!shortcut.normalizedKeys.includes(normalizedKey)) {
        continue
      }

      if (event.repeat && !shortcut.allowRepeat) {
        continue
      }

      if (targetIsEditable && !shortcut.allowInEditable) {
        continue
      }

      const context: ShortcutContext = {
        activeScope,
        normalizedKey,
        originalEvent: event,
        targetIsEditable,
      }

      if (shortcut.when && !shortcut.when(context)) {
        continue
      }

      if (shortcut.preventDefault !== false) {
        event.preventDefault()
      }

      if (shortcut.stopPropagation) {
        event.stopPropagation()
      }

      void shortcut.run(context)
      return true
    }

    return false
  }

  return {
    getShortcuts() {
      return registeredShortcuts.map(({ normalizedKeys: _normalizedKeys, ...shortcut }) => ({
        ...shortcut,
      }))
    },

    handleKeydown,

    registerShortcuts(definitions) {
      const nextDefinitions = definitions.map<RegisteredShortcutDefinition>((definition) => ({
        ...definition,
        normalizedKeys: definition.keys.map((key) => normalizeShortcutKey(key)),
      }))

      registeredShortcuts.push(...nextDefinitions)

      return () => {
        for (const definition of nextDefinitions) {
          const index = registeredShortcuts.indexOf(definition)
          if (index >= 0) {
            registeredShortcuts.splice(index, 1)
          }
        }
      }
    },

    start() {
      if (!target) {
        return () => undefined
      }

      if (stopListening) {
        return stopListening
      }

      const listener = (event: KeyboardEvent) => {
        handleKeydown(event)
      }

      target.addEventListener('keydown', listener)

      stopListening = () => {
        target.removeEventListener('keydown', listener)
        stopListening = null
      }

      return stopListening
    },
  }
}

export const setShortcutManagerContext = (shortcutManager: ShortcutManager): ShortcutManager => {
  setContext(SHORTCUT_MANAGER_CONTEXT, shortcutManager)
  return shortcutManager
}

export const getShortcutManagerContext = (): ShortcutManager =>
  getContext<ShortcutManager>(SHORTCUT_MANAGER_CONTEXT)
