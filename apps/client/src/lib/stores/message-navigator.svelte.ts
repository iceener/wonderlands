import { getContext, setContext } from 'svelte'
import type { UiMessage } from '../chat/types'
import { copyTextToClipboard } from '../services/clipboard'

const MESSAGE_NAVIGATOR_CONTEXT = Symbol('message-navigator')

export interface MessageNavigator {
  readonly active: boolean
  readonly highlightedMessageId: string | null
  readonly copiedMessageId: string | null
  activate(messages: readonly UiMessage[]): void
  deactivate(): void
  moveUp(messages: readonly UiMessage[]): void
  moveDown(messages: readonly UiMessage[]): void
  copyHighlighted(messages: readonly UiMessage[]): Promise<boolean>
  dispose(): void
}

export const createMessageNavigator = (): MessageNavigator => {
  let _active = $state(false)
  let _highlightedMessageId = $state<string | null>(null)
  let _copiedMessageId = $state<string | null>(null)
  let _copiedTimer: number | null = null

  const clearCopiedTimer = () => {
    if (_copiedTimer != null) {
      window.clearTimeout(_copiedTimer)
      _copiedTimer = null
    }
  }

  const findIndex = (messages: readonly UiMessage[], id: string | null): number => {
    if (id == null) return -1
    return messages.findIndex((m) => m.id === id)
  }

  return {
    get active() {
      return _active
    },
    get highlightedMessageId() {
      return _highlightedMessageId
    },
    get copiedMessageId() {
      return _copiedMessageId
    },

    activate(messages) {
      if (messages.length === 0) return
      _highlightedMessageId = messages[messages.length - 1].id
      _active = true
      clearCopiedTimer()
      _copiedMessageId = null
    },

    deactivate() {
      _active = false
      _highlightedMessageId = null
      clearCopiedTimer()
      _copiedMessageId = null
    },

    moveUp(messages) {
      if (!_active || !_highlightedMessageId) return
      const idx = findIndex(messages, _highlightedMessageId)
      if (idx > 0) {
        _highlightedMessageId = messages[idx - 1].id
      }
    },

    moveDown(messages) {
      if (!_active || !_highlightedMessageId) return
      const idx = findIndex(messages, _highlightedMessageId)
      if (idx >= 0 && idx < messages.length - 1) {
        _highlightedMessageId = messages[idx + 1].id
      } else {
        _active = false
        _highlightedMessageId = null
      }
    },

    async copyHighlighted(messages) {
      if (!_active || !_highlightedMessageId) return false
      const msg = messages.find((m) => m.id === _highlightedMessageId)
      if (!msg?.text.trim()) return false
      try {
        await copyTextToClipboard(msg.text)
        clearCopiedTimer()
        _copiedMessageId = _highlightedMessageId
        _copiedTimer = window.setTimeout(() => {
          _copiedMessageId = null
          _copiedTimer = null
        }, 1200)
        return true
      } catch {
        return false
      }
    },

    dispose() {
      clearCopiedTimer()
    },
  }
}

export const setMessageNavigatorContext = (nav: MessageNavigator): MessageNavigator => {
  setContext(MESSAGE_NAVIGATOR_CONTEXT, nav)
  return nav
}

export const getMessageNavigatorContext = (): MessageNavigator =>
  getContext<MessageNavigator>(MESSAGE_NAVIGATOR_CONTEXT)
