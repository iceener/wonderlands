export type ConversationDialogKeyAction = 'close' | 'submit'

export interface ConversationDialogKeyboardEventLike {
  altKey: boolean
  ctrlKey: boolean
  defaultPrevented: boolean
  isComposing: boolean
  key: string
  metaKey: boolean
  shiftKey: boolean
}

export const getConversationDialogKeyAction = (
  event: ConversationDialogKeyboardEventLike,
): ConversationDialogKeyAction | null => {
  if (event.defaultPrevented || event.isComposing) {
    return null
  }

  if (event.key === 'Escape') {
    return 'close'
  }

  if (event.key !== 'Enter') {
    return null
  }

  if (event.shiftKey || event.altKey) {
    return null
  }

  return 'submit'
}

export const isModifiedPrimarySubmit = (
  event: Pick<ConversationDialogKeyboardEventLike, 'ctrlKey' | 'metaKey'>,
): boolean => event.metaKey || event.ctrlKey
