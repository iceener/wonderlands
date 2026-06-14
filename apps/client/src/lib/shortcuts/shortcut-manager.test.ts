import { describe, expect, test } from 'vitest'
import { createShortcutLayerStack } from '../ui/layer-stack'

import { createShortcutManager } from './shortcut-manager'

const createKeyboardEvent = (
  key: string,
  options: Partial<KeyboardEvent> & { target?: EventTarget | null } = {},
): KeyboardEvent => {
  let defaultPrevented = false
  let propagationStopped = false

  return {
    altKey: false,
    code: '',
    ctrlKey: false,
    isComposing: false,
    key,
    metaKey: false,
    preventDefault() {
      defaultPrevented = true
    },
    repeat: false,
    shiftKey: false,
    stopPropagation() {
      propagationStopped = true
    },
    target: null,
    ...options,
    get defaultPrevented() {
      return defaultPrevented
    },
    get __propagationStopped() {
      return propagationStopped
    },
  } as KeyboardEvent
}

describe('createShortcutManager', () => {
  test('dispatches the matching global shortcut and prevents default by default', async () => {
    const layerStack = createShortcutLayerStack()
    const manager = createShortcutManager({
      layerStack,
      isEditableTarget: () => false,
      target: null,
    })

    const calls: string[] = []

    manager.registerShortcuts([
      {
        id: 'settings.cycle-model',
        description: 'Cycle model',
        keys: ['Mod+Alt+M'],
        scope: 'global',
        run: () => {
          calls.push('model')
        },
      },
    ])

    const event = createKeyboardEvent('m', {
      altKey: true,
      code: 'KeyM',
      ctrlKey: true,
    })

    expect(manager.handleKeydown(event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(calls).toEqual(['model'])
  })

  test('blocks shortcuts inside editable targets unless they explicitly opt in', async () => {
    const layerStack = createShortcutLayerStack()
    const manager = createShortcutManager({
      layerStack,
      isEditableTarget: () => true,
      target: null,
    })

    const calls: string[] = []

    manager.registerShortcuts([
      {
        id: 'blocked',
        description: 'Blocked in editable content',
        keys: ['Mod+Alt+M'],
        scope: 'global',
        run: () => {
          calls.push('blocked')
        },
      },
      {
        id: 'allowed',
        description: 'Allowed in editable content',
        keys: ['Mod+Alt+T'],
        scope: 'global',
        allowInEditable: true,
        run: () => {
          calls.push('allowed')
        },
      },
    ])

    expect(
      manager.handleKeydown(
        createKeyboardEvent('m', {
          altKey: true,
          code: 'KeyM',
          ctrlKey: true,
        }),
      ),
    ).toBe(false)

    expect(
      manager.handleKeydown(
        createKeyboardEvent('t', {
          altKey: true,
          code: 'KeyT',
          ctrlKey: true,
        }),
      ),
    ).toBe(true)

    expect(calls).toEqual(['allowed'])
  })

  test('routes shortcuts to the topmost active layer and suppresses lower scopes', async () => {
    const layerStack = createShortcutLayerStack()
    const manager = createShortcutManager({
      layerStack,
      isEditableTarget: () => false,
      target: null,
    })

    const calls: string[] = []

    manager.registerShortcuts([
      {
        id: 'global.escape',
        description: 'Global escape',
        keys: ['Escape'],
        scope: 'global',
        run: () => {
          calls.push('global')
        },
      },
      {
        id: 'lightbox.close',
        description: 'Close lightbox',
        keys: ['Escape'],
        scope: 'lightbox',
        run: () => {
          calls.push('lightbox')
        },
      },
    ])

    const releaseLayer = layerStack.pushLayer('lightbox')

    expect(
      manager.handleKeydown(
        createKeyboardEvent('Escape', {
          code: 'Escape',
        }),
      ),
    ).toBe(true)
    expect(calls).toEqual(['lightbox'])

    releaseLayer()

    expect(
      manager.handleKeydown(
        createKeyboardEvent('Escape', {
          code: 'Escape',
        }),
      ),
    ).toBe(true)
    expect(calls).toEqual(['lightbox', 'global'])
  })

  test('matches bracket shortcuts for adjacent conversation navigation', async () => {
    const layerStack = createShortcutLayerStack()
    const manager = createShortcutManager({
      layerStack,
      isEditableTarget: () => false,
      target: null,
    })

    const calls: string[] = []

    manager.registerShortcuts([
      {
        id: 'chat.previous-conversation',
        description: 'Previous conversation',
        keys: ['Mod+['],
        scope: 'global',
        run: () => {
          calls.push('previous')
        },
      },
      {
        id: 'chat.next-conversation',
        description: 'Next conversation',
        keys: ['Mod+]'],
        scope: 'global',
        run: () => {
          calls.push('next')
        },
      },
    ])

    expect(
      manager.handleKeydown(
        createKeyboardEvent('[', {
          code: 'BracketLeft',
          ctrlKey: true,
        }),
      ),
    ).toBe(true)

    expect(
      manager.handleKeydown(
        createKeyboardEvent(']', {
          code: 'BracketRight',
          ctrlKey: true,
        }),
      ),
    ).toBe(true)

    expect(calls).toEqual(['previous', 'next'])
  })
})
