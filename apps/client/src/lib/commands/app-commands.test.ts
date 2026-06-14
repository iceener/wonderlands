import {
  asSessionId,
  asThreadId,
  BACKEND_DEFAULT_MODEL,
  BACKEND_DEFAULT_REASONING,
  type BackendThread,
  type ChatModel,
  type ChatReasoningMode,
} from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'

import { createAppCommands } from './app-commands'

interface ChatStoreStub {
  availableModels: readonly ChatModel[]
  availableReasoningModes: ReadonlyArray<{ id: ChatReasoningMode; label: string }>
  chatModel: ChatModel
  chatReasoningMode: ChatReasoningMode
  currentThreadTitle?: string | null
  isCancelling: boolean
  isLoading: boolean
  isStreaming: boolean
  isWaiting?: boolean
  threadId: string | null
  title: string
  deleteCurrentThread: () => Promise<void>
  renameCurrentThread: (title: string) => Promise<void>
  reset: () => Promise<void>
  setChatModel: (model: ChatModel) => void
  setChatReasoningMode: (mode: ChatReasoningMode) => void
  switchToThread: (thread: BackendThread) => Promise<void>
}

interface ThemeStoreStub {
  theme: 'light' | 'dark' | 'system'
  setTheme: (theme: 'light' | 'dark' | 'system') => void
}

const createChatStoreStub = (): ChatStoreStub => ({
  availableModels: [BACKEND_DEFAULT_MODEL, 'gpt-4.1', 'gpt-5.4'],
  availableReasoningModes: [
    { id: BACKEND_DEFAULT_REASONING, label: 'Backend default' },
    { id: 'none', label: 'No reasoning' },
    { id: 'high', label: 'High' },
  ],
  chatModel: BACKEND_DEFAULT_MODEL,
  chatReasoningMode: BACKEND_DEFAULT_REASONING,
  currentThreadTitle: 'Current thread',
  isCancelling: false,
  isLoading: false,
  isStreaming: false,
  isWaiting: false,
  threadId: 'thr_1',
  title: 'Current thread',
  async deleteCurrentThread() {
    return undefined
  },
  async renameCurrentThread(title) {
    this.currentThreadTitle = title
    this.title = title
  },
  async reset() {
    return undefined
  },
  setChatModel(model) {
    this.chatModel = model
  },
  setChatReasoningMode(mode) {
    this.chatReasoningMode = mode
  },
  async switchToThread(thread) {
    this.threadId = thread.id
    this.currentThreadTitle = thread.title
    this.title = thread.title
  },
})

const createThemeStoreStub = (): ThemeStoreStub => ({
  theme: 'system',
  setTheme(theme) {
    this.theme = theme
  },
})

const createThread = (id: string, title: string, updatedAt: string): BackendThread => ({
  createdAt: '2026-03-29T12:00:00.000Z',
  createdByAccountId: 'acc_adam_overment',
  id: asThreadId(id),
  parentThreadId: null,
  sessionId: asSessionId(`ses_${id}`),
  status: 'active',
  tenantId: 'ten_overment',
  title,
  updatedAt,
})

describe('createAppCommands', () => {
  test('opens the agent panel when the callback is provided', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    let opened = 0
    const commands = createAppCommands({
      canOpenAgentPanel: () => true,
      chatStore,
      openAgentPanel: () => {
        opened += 1
      },
      theme,
      typewriter,
    })

    expect(commands.canOpenAgentPanel()).toBe(true)
    expect(commands.openAgentPanel()).toBe(true)
    expect(opened).toBe(1)
  })

  test('opens the MCP lightbox when the callback is provided', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    let opened = 0
    const commands = createAppCommands({
      chatStore,
      openConnectMcp: () => {
        opened += 1
      },
      theme,
      typewriter,
    })

    expect(commands.canOpenConnectMcp()).toBe(true)
    expect(commands.openConnectMcp()).toBe(true)
    expect(opened).toBe(1)
  })

  test('opens the MCP manager when the callback is provided', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    let opened = 0
    const commands = createAppCommands({
      chatStore,
      openManageMcp: () => {
        opened += 1
      },
      theme,
      typewriter,
    })

    expect(commands.canOpenManageMcp()).toBe(true)
    expect(commands.openManageMcp()).toBe(true)
    expect(opened).toBe(1)
  })

  test('opens the conversation picker when the callback and auth guard are provided', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    let opened = 0
    const commands = createAppCommands({
      canOpenConversationPicker: () => true,
      chatStore,
      openConversationPicker: () => {
        opened += 1
      },
      theme,
      typewriter,
    })

    expect(commands.canOpenConversationPicker()).toBe(true)
    expect(commands.openConversationPicker()).toBe(true)
    expect(opened).toBe(1)
  })

  test('opens the workspace picker when the callback and auth guard are provided', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    let opened = 0
    const commands = createAppCommands({
      canOpenWorkspacePicker: () => true,
      chatStore,
      openWorkspacePicker: () => {
        opened += 1
      },
      theme,
      typewriter,
    })

    expect(commands.canOpenWorkspacePicker()).toBe(true)
    expect(commands.openWorkspacePicker()).toBe(true)
    expect(opened).toBe(1)
  })

  test('switches to the previous conversation from the recent-thread list', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    const recentThreads = [
      createThread('thr_2', 'Second thread', '2026-03-30T12:00:00.000Z'),
      createThread('thr_1', 'Current thread', '2026-03-29T12:00:00.000Z'),
      createThread('thr_0', 'Oldest thread', '2026-03-28T12:00:00.000Z'),
    ]
    const commands = createAppCommands({
      chatStore,
      listThreads: async (options) => {
        expect(options?.limit).toBe(50)
        expect(options?.query).toBeUndefined()
        return recentThreads
      },
      theme,
      typewriter,
    })

    expect(commands.canGoToPreviousConversation()).toBe(true)
    await expect(commands.goToPreviousConversation()).resolves.toBe(true)
    expect(chatStore.threadId).toBe('thr_0')
    expect(chatStore.title).toBe('Oldest thread')
  })

  test('switches to the next conversation from the recent-thread list', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    const recentThreads = [
      createThread('thr_2', 'Most recent thread', '2026-03-30T12:00:00.000Z'),
      createThread('thr_1', 'Current thread', '2026-03-29T12:00:00.000Z'),
      createThread('thr_0', 'Oldest thread', '2026-03-28T12:00:00.000Z'),
    ]
    const commands = createAppCommands({
      chatStore,
      listThreads: async () => recentThreads,
      theme,
      typewriter,
    })

    expect(commands.canGoToNextConversation()).toBe(true)
    await expect(commands.goToNextConversation()).resolves.toBe(true)
    expect(chatStore.threadId).toBe('thr_2')
    expect(chatStore.title).toBe('Most recent thread')
  })

  test('does not intercept adjacent conversation navigation when no switch target is available', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    const commands = createAppCommands({
      chatStore,
      listThreads: async () => [
        createThread('thr_1', 'Current thread', '2026-03-29T12:00:00.000Z'),
      ],
      theme,
      typewriter,
    })

    await expect(commands.goToPreviousConversation()).resolves.toBe(false)
    await expect(commands.goToNextConversation()).resolves.toBe(false)
    expect(chatStore.threadId).toBe('thr_1')
  })

  test('reports MCP connect as unavailable when no callback is registered', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    const commands = createAppCommands({ chatStore, theme, typewriter })

    expect(commands.canOpenConnectMcp()).toBe(false)
    expect(commands.openConnectMcp()).toBe(false)
  })

  test('reports MCP manager as unavailable when no callback is registered', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    const commands = createAppCommands({ chatStore, theme, typewriter })

    expect(commands.canOpenManageMcp()).toBe(false)
    expect(commands.openManageMcp()).toBe(false)
  })

  test('reports workspace picker as unavailable when no callback is registered', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    const commands = createAppCommands({ chatStore, theme, typewriter })

    expect(commands.canOpenWorkspacePicker()).toBe(false)
    expect(commands.openWorkspacePicker()).toBe(false)
  })

  test('reports the agent panel as unavailable when no callback is registered', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    const commands = createAppCommands({ chatStore, theme, typewriter })

    expect(commands.canOpenAgentPanel()).toBe(false)
    expect(commands.openAgentPanel()).toBe(false)
  })

  test('cycles through backend default and explicit models', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    const commands = createAppCommands({ chatStore, theme, typewriter })

    expect(commands.cycleModel()).toBe(true)
    expect(chatStore.chatModel).toBe('gpt-4.1')
    expect(commands.cycleModel()).toBe(true)
    expect(chatStore.chatModel).toBe('gpt-5.4')
    expect(commands.cycleModel()).toBe(true)
    expect(chatStore.chatModel).toBe(BACKEND_DEFAULT_MODEL)
  })

  test('does not cycle when the backend exposes only one model choice', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    chatStore.availableModels = [BACKEND_DEFAULT_MODEL]
    const commands = createAppCommands({ chatStore, theme, typewriter })

    expect(commands.canCycleModel()).toBe(false)
    expect(commands.cycleModel()).toBe(false)
    expect(chatStore.chatModel).toBe(BACKEND_DEFAULT_MODEL)
  })

  test('cycles through backend default and explicit reasoning modes', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    const commands = createAppCommands({ chatStore, theme, typewriter })

    expect(commands.cycleReasoning()).toBe(true)
    expect(chatStore.chatReasoningMode).toBe('none')
    expect(commands.cycleReasoning()).toBe(true)
    expect(chatStore.chatReasoningMode).toBe('high')
    expect(commands.cycleReasoning()).toBe(true)
    expect(chatStore.chatReasoningMode).toBe(BACKEND_DEFAULT_REASONING)
  })

  test('cycles the typewriter speed independently of chat transport state', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'off' as const }
    const commands = createAppCommands({ chatStore, theme, typewriter })

    expect(commands.cycleTypewriter()).toBe(true)
    expect(typewriter.speed).toBe('fast')
  })

  test('cycles the theme across system, light, and dark', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    const commands = createAppCommands({ chatStore, theme, typewriter })

    expect(commands.cycleTheme()).toBe(true)
    expect(theme.theme).toBe('light')
    expect(commands.cycleTheme()).toBe(true)
    expect(theme.theme).toBe('dark')
    expect(commands.cycleTheme()).toBe(true)
    expect(theme.theme).toBe('system')
  })

  test('renameConversation prompts for a title and delegates to the chat store', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    const commands = createAppCommands({
      chatStore,
      requestRenameConversationTitle: async ({ currentTitle }) => `${currentTitle} renamed`,
      theme,
      typewriter,
    })

    await expect(commands.renameConversation()).resolves.toBe(true)
    expect(chatStore.title).toBe('Current thread renamed')
  })

  test('deleteConversation confirms, clears the composer, deletes the thread, and refocuses input', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    const calls: string[] = []

    chatStore.deleteCurrentThread = async () => {
      calls.push('delete')
      chatStore.currentThreadTitle = null
      chatStore.threadId = null
    }

    const commands = createAppCommands({
      chatStore,
      requestDeleteConversationConfirmation: async () => true,
      requestPinToBottom: () => {
        calls.push('pin')
      },
      theme,
      typewriter,
    })

    commands.registerComposerBridge({
      focusPrompt: async () => {
        calls.push('focus')
      },
      pickAttachments: () => {
        calls.push('pick')
      },
      resetComposer: () => {
        calls.push('composer-reset')
      },
    })

    await expect(commands.deleteConversation()).resolves.toBe(true)
    expect(calls).toEqual(['composer-reset', 'delete', 'pin', 'focus'])
  })

  test('resets the composer, chat state, scroll pin, and focus through new conversation', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    const calls: string[] = []

    chatStore.reset = async () => {
      calls.push('reset')
    }

    const commands = createAppCommands({
      chatStore,
      requestPinToBottom: () => {
        calls.push('pin')
      },
      theme,
      typewriter,
    })

    const unregisterBridge = commands.registerComposerBridge({
      focusPrompt: async () => {
        calls.push('focus')
      },
      pickAttachments: () => {
        calls.push('pick')
      },
      resetComposer: () => {
        calls.push('composer-reset')
      },
    })

    await expect(commands.newConversation()).resolves.toBe(true)
    expect(calls).toEqual(['composer-reset', 'reset', 'pin', 'focus'])

    unregisterBridge()
  })

  test('opens the attachment picker through the registered composer bridge', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    const calls: string[] = []

    const commands = createAppCommands({
      chatStore,
      theme,
      typewriter,
    })

    expect(commands.canPickAttachments()).toBe(false)
    expect(commands.pickAttachments()).toBe(false)

    commands.registerComposerBridge({
      focusPrompt: () => {
        calls.push('focus')
      },
      pickAttachments: () => {
        calls.push('pick')
      },
      resetComposer: () => {
        calls.push('reset')
      },
    })

    expect(commands.canPickAttachments()).toBe(true)
    expect(commands.pickAttachments()).toBe(true)
    expect(calls).toEqual(['pick'])
  })

  test('delegates sign-out when the callback is available', async () => {
    const chatStore = createChatStoreStub()
    const theme = createThemeStoreStub()
    const typewriter = { speed: 'fast' as const }
    let called = 0
    const commands = createAppCommands({
      canSignOut: () => true,
      chatStore,
      signOut: async () => {
        called += 1
      },
      theme,
      typewriter,
    })

    expect(commands.canSignOut()).toBe(true)
    await expect(commands.signOut()).resolves.toBe(true)
    expect(called).toBe(1)
  })
})
