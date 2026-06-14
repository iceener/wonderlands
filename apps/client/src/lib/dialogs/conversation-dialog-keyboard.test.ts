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
  test('maps escape to close', () => {
    expect(getConversationDialogKeyAction(keyboardEvent({ key: 'Escape' }))).toBe('close')
  })

  test('maps plain enter and mod+enter to submit', () => {
    expect(getConversationDialogKeyAction(keyboardEvent({ key: 'Enter' }))).toBe('submit')
    expect(getConversationDialogKeyAction(keyboardEvent({ ctrlKey: true, key: 'Enter' }))).toBe(
      'submit',
    )
    expect(getConversationDialogKeyAction(keyboardEvent({ key: 'Enter', metaKey: true }))).toBe(
      'submit',
    )
  })

  test('ignores composing, prevented, and shifted enter events', () => {
    expect(
      getConversationDialogKeyAction(keyboardEvent({ isComposing: true, key: 'Escape' })),
    ).toBeNull()
    expect(
      getConversationDialogKeyAction(keyboardEvent({ defaultPrevented: true, key: 'Enter' })),
    ).toBeNull()
    expect(
      getConversationDialogKeyAction(keyboardEvent({ key: 'Enter', shiftKey: true })),
    ).toBeNull()
    expect(getConversationDialogKeyAction(keyboardEvent({ altKey: true, key: 'Enter' }))).toBeNull()
  })

  test('detects modified submit keys', () => {
    expect(isModifiedPrimarySubmit(keyboardEvent({ ctrlKey: true }))).toBe(true)
    expect(isModifiedPrimarySubmit(keyboardEvent({ metaKey: true }))).toBe(true)
    expect(isModifiedPrimarySubmit(keyboardEvent())).toBe(false)
  })
})
