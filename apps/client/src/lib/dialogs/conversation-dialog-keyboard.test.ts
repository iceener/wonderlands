import { describe, expect, test } from 'vitest'

import {
  getConversationDialogKeyAction,
  isModifiedPrimarySubmit,
} from './conversation-dialog-keyboard'

const keyboardEvent = (
  overrides: Partial<{
    altKey: boolean
    ctrlKey: boolean
    defaultPrevented: boolean
    isComposing: boolean
    key: string
    metaKey: boolean
    shiftKey: boolean
  }> = {},
) => ({
  altKey: false,
  ctrlKey: false,
  defaultPrevented: false,
  isComposing: false,
  key: '',
  metaKey: false,
  shiftKey: false,
  ...overrides,
})

describe('conversation-dialog-keyboard', () => {
  test('maps Escape and supported Enter variants to dialog actions', () => {
    const scenarios = [
      [{ key: 'Escape' }, 'close'],
      [{ key: 'Enter' }, 'submit'],
      [{ ctrlKey: true, key: 'Enter' }, 'submit'],
      [{ key: 'Enter', metaKey: true }, 'submit'],
    ] as const

    for (const [event, action] of scenarios) {
      expect(getConversationDialogKeyAction(keyboardEvent(event))).toBe(action)
    }
    expect(isModifiedPrimarySubmit(keyboardEvent({ ctrlKey: true }))).toBe(true)
    expect(isModifiedPrimarySubmit(keyboardEvent({ metaKey: true }))).toBe(true)
    expect(isModifiedPrimarySubmit(keyboardEvent())).toBe(false)
  })

  test('ignores unrelated, composing, prevented, shifted, and alt-modified keys', () => {
    const ignored = [
      { key: 'ArrowDown' },
      { isComposing: true, key: 'Escape' },
      { defaultPrevented: true, key: 'Enter' },
      { key: 'Enter', shiftKey: true },
      { altKey: true, key: 'Enter' },
    ]

    for (const event of ignored) {
      expect(getConversationDialogKeyAction(keyboardEvent(event))).toBeNull()
    }
  })
})
