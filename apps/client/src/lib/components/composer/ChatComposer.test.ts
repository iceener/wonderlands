// @vitest-environment jsdom
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createMountTarget, dispatchPaste, installDomPolyfills } from '../../../test/dom'

const mocks = vi.hoisted(() => {
  const chatStore = {
    activeAgentId: null,
    activeAgentName: null,
    availableReasoningModes: [{ id: 'default', label: 'Default' }],
    beginMessageEdit: vi.fn(),
    canCancel: false,
    canReplyToPendingWait: false,
    cancel: vi.fn(async () => undefined),
    cancelMessageEdit: vi.fn(),
    chatModel: 'default',
    chatReasoningMode: 'default',
    clearError: vi.fn(),
    defaultTarget: { kind: 'assistant' },
    defaultTargetAgentName: null,
    error: null,
    isCancelling: false,
    isLoading: false,
    isReconnecting: false,
    isStreaming: false,
    isWaiting: false,
    messageEditDraft: null,
    messages: [],
    pendingToolConfirmation: null,
    sessionId: null,
    setTargetAgent: vi.fn(),
    setTargetMode: vi.fn(),
    submit: vi.fn(async () => true),
    targetMode: 'assistant',
  }

  return {
    appCommands: {
      canCycleModel: () => false,
      canCycleReasoning: () => false,
      canStartNewConversation: () => true,
      cycleModel: vi.fn(),
      cycleReasoning: vi.fn(),
      cycleTypewriter: vi.fn(),
      newConversation: vi.fn(async () => true),
      registerComposerBridge: vi.fn(() => () => undefined),
    },
    chatStore,
    messageNavigator: {
      active: false,
      activate: vi.fn(),
      copyHighlighted: vi.fn(async () => false),
      deactivate: vi.fn(),
      moveDown: vi.fn(),
      moveUp: vi.fn(),
    },
    paletteStore: {
      close: vi.fn(),
      executeSelected: vi.fn(),
      isOpen: false,
      moveSelection: vi.fn(),
      openWith: vi.fn(),
      setQuery: vi.fn(),
    },
  }
})

vi.mock('svelte', async () => {
  // @ts-expect-error Vitest otherwise resolves Svelte's SSR entry in JSDOM.
  return await import('../../../../../../node_modules/svelte/src/index-client.js')
})
vi.mock('../../stores/chat-store.svelte', () => ({ chatStore: mocks.chatStore }))
vi.mock('../../commands/app-commands', () => ({
  getAppCommandsContext: () => mocks.appCommands,
}))
vi.mock('../../command-palette/palette-store.svelte', () => ({
  getPaletteStoreContext: () => mocks.paletteStore,
}))
vi.mock('../../stores/message-navigator.svelte', () => ({
  getMessageNavigatorContext: () => mocks.messageNavigator,
}))

import ChatComposer from './ChatComposer.svelte'

installDomPolyfills()

const mounted: Array<{ instance: Record<string, unknown>; target: HTMLElement }> = []

beforeEach(() => {
  mocks.chatStore.isLoading = false
  mocks.chatStore.isWaiting = false
  mocks.chatStore.isStreaming = false
  mocks.chatStore.isCancelling = false
  mocks.chatStore.canCancel = false
  mocks.chatStore.canReplyToPendingWait = false
  mocks.chatStore.error = null
  mocks.chatStore.submit.mockClear()
})

afterEach(async () => {
  for (const { instance, target } of mounted.splice(0)) {
    await unmount(instance)
    target.remove()
  }
})

const renderComposer = () => {
  const target = createMountTarget()
  const instance = mount(ChatComposer, { target })
  mounted.push({ instance, target })
  return target
}

const pastePrompt = async (target: HTMLElement, text: string) => {
  await tick()
  const editor = target.querySelector<HTMLElement>('[contenteditable="true"]')
  expect(editor).not.toBeNull()
  dispatchPaste(editor!, { 'text/plain': text })
  await tick()
}

describe('ChatComposer mounted interactions', () => {
  test('submits markdown from the real prompt editor', async () => {
    const target = renderComposer()
    await pastePrompt(target, 'Hello **world**')

    const send = target.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')
    expect(send?.disabled).toBe(false)
    send?.click()
    await tick()
    await Promise.resolve()

    expect(mocks.chatStore.submit).toHaveBeenCalledWith('Hello **world**', [], [], undefined)
  })

  test('does not submit a composed reply while a non-replyable wait is active', async () => {
    mocks.chatStore.isWaiting = true
    mocks.chatStore.canReplyToPendingWait = false
    const target = renderComposer()
    await pastePrompt(target, 'Do not send yet')

    const send = target.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')
    expect(send?.type).toBe('button')
    send?.click()
    expect(mocks.chatStore.submit).not.toHaveBeenCalled()
  })
})
