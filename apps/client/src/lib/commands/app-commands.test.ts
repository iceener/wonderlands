import {
  asSessionId,
  asThreadId,
  BACKEND_DEFAULT_MODEL,
  BACKEND_DEFAULT_REASONING,
  type BackendThread,
  type ChatModel,
  type ChatReasoningMode,
} from '@wonderlands/contracts/chat'
import { describe, expect, test, vi } from 'vitest'

import { type CreateAppCommandsOptions, createAppCommands } from './app-commands'

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
  deleteCurrentThread?: () => Promise<void>
  renameCurrentThread?: (title: string) => Promise<void>
  reset: () => Promise<void>
  setChatModel: (model: ChatModel) => void
  setChatReasoningMode: (mode: ChatReasoningMode) => void
  switchToThread?: (thread: BackendThread) => Promise<void>
}

const createChatStoreStub = (): ChatStoreStub => ({
  availableModels: [BACKEND_DEFAULT_MODEL, 'gpt-4.1', 'gpt-5.4'],
  availableReasoningModes: [
    { id: BACKEND_DEFAULT_REASONING, label: 'Default' },
    { id: 'none', label: 'None' },
    { id: 'high', label: 'High' },
  ],
  chatModel: BACKEND_DEFAULT_MODEL,
  chatReasoningMode: BACKEND_DEFAULT_REASONING,
  currentThreadTitle: 'Current',
  isCancelling: false,
  isLoading: false,
  isStreaming: false,
  isWaiting: false,
  threadId: 'thr_current',
  title: 'Current',
  async deleteCurrentThread() {
    this.currentThreadTitle = null
    this.threadId = null
  },
  async renameCurrentThread(title) {
    this.currentThreadTitle = title
    this.title = title
  },
  async reset() {},
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

const createThread = (id: string): BackendThread => ({
  createdAt: '2026-03-29T12:00:00.000Z',
  createdByAccountId: 'acc_test',
  id: asThreadId(id),
  parentThreadId: null,
  sessionId: asSessionId(`ses_${id}`),
  status: 'active',
  tenantId: 'ten_test',
  title: id,
  updatedAt: '2026-03-30T12:00:00.000Z',
})

const createOptions = (chatStore = createChatStoreStub()): CreateAppCommandsOptions => ({
  chatStore,
  theme: {
    theme: 'system',
    setTheme(theme) {
      this.theme = theme
    },
  },
  typewriter: { speed: 'fast' },
})

const call = async (commands: object, method: string): Promise<unknown> => {
  const command = (commands as Record<string, () => unknown>)[method]
  return await command?.()
}

describe('createAppCommands', () => {
  test('keeps callback-backed command availability and delegation boundaries', async () => {
    const scenarios = [
      ['openAgentPanel', 'canOpenAgentPanel', 'openAgentPanel', 'canOpenAgentPanel'],
      ['openConnectMcp', undefined, 'openConnectMcp', 'canOpenConnectMcp'],
      ['openKeyboardShortcuts', undefined, 'openKeyboardShortcuts', 'canOpenKeyboardShortcuts'],
      [
        'openConversationPicker',
        'canOpenConversationPicker',
        'openConversationPicker',
        'canOpenConversationPicker',
      ],
      [
        'openWorkspacePicker',
        'canOpenWorkspacePicker',
        'openWorkspacePicker',
        'canOpenWorkspacePicker',
      ],
      ['openManageMcp', undefined, 'openManageMcp', 'canOpenManageMcp'],
      ['openManageGardens', 'canOpenManageGardens', 'openManageGardens', 'canOpenManageGardens'],
      ['openManageToolProfiles', undefined, 'openManageToolProfiles', 'canOpenManageToolProfiles'],
      [
        'openManageAgentTasks',
        'canOpenManageAgentTasks',
        'openManageAgentTasks',
        'canOpenManageAgentTasks',
      ],
      ['signOut', 'canSignOut', 'signOut', 'canSignOut'],
    ] as const

    for (const [option, guardOption, runMethod, canMethod] of scenarios) {
      const unavailable = createAppCommands(createOptions())
      expect(await call(unavailable, canMethod), `${canMethod} without callback`).toBe(false)
      expect(await call(unavailable, runMethod), `${runMethod} without callback`).toBe(false)

      const callback = vi.fn()
      if (guardOption) {
        const guardedOptions = {
          ...createOptions(),
          [option]: callback,
          [guardOption]: () => false,
        } as CreateAppCommandsOptions
        const guarded = createAppCommands(guardedOptions)
        expect(await call(guarded, canMethod), `${canMethod} denied`).toBe(false)
        expect(await call(guarded, runMethod), `${runMethod} denied`).toBe(false)
      }

      const available = createAppCommands({
        ...createOptions(),
        [option]: callback,
      } as CreateAppCommandsOptions)
      expect(await call(available, canMethod), `${canMethod} available`).toBe(true)
      expect(await call(available, runMethod), `${runMethod} delegated`).toBe(true)
      expect(callback, option).toHaveBeenCalledOnce()
    }
  })

  test('navigates adjacent conversations in backend order without wrapping', async () => {
    const chatStore = createChatStoreStub()
    const listThreads = vi.fn(async () => [
      createThread('thr_newer'),
      createThread('thr_current'),
      createThread('thr_older'),
    ])
    const commands = createAppCommands({ ...createOptions(chatStore), listThreads })

    expect(commands.canGoToPreviousConversation()).toBe(true)
    await expect(commands.goToPreviousConversation()).resolves.toBe(true)
    expect(chatStore.threadId).toBe('thr_older')

    chatStore.threadId = 'thr_current'
    await expect(commands.goToNextConversation()).resolves.toBe(true)
    expect(chatStore.threadId).toBe('thr_newer')
    await expect(commands.goToNextConversation()).resolves.toBe(false)
    expect(listThreads).toHaveBeenCalledWith({ limit: 50 })
  })

  test('cycles model, reasoning, theme, and typewriter choices and guards short lists', () => {
    const chatStore = createChatStoreStub()
    const options = createOptions(chatStore)
    options.typewriter.speed = 'off'
    const commands = createAppCommands(options)

    const modelSequence: ChatModel[] = []
    const reasoningSequence: ChatReasoningMode[] = []
    const themeSequence: string[] = []
    for (let index = 0; index < 3; index += 1) {
      expect(commands.cycleModel()).toBe(true)
      expect(commands.cycleReasoning()).toBe(true)
      expect(commands.cycleTheme()).toBe(true)
      modelSequence.push(chatStore.chatModel)
      reasoningSequence.push(chatStore.chatReasoningMode)
      themeSequence.push(options.theme.theme)
    }
    expect(modelSequence).toEqual(['gpt-4.1', 'gpt-5.4', BACKEND_DEFAULT_MODEL])
    expect(reasoningSequence).toEqual(['none', 'high', BACKEND_DEFAULT_REASONING])
    expect(themeSequence).toEqual(['light', 'dark', 'system'])

    expect(commands.cycleTypewriter()).toBe(true)
    expect(options.typewriter.speed).toBe('fast')

    chatStore.availableModels = [BACKEND_DEFAULT_MODEL]
    expect(commands.canCycleModel()).toBe(false)
    expect(commands.cycleModel()).toBe(false)
  })

  test('submits only a changed, non-empty rename title', async () => {
    const chatStore = createChatStoreStub()
    const requestTitle = vi
      .fn<(input: { currentTitle: string }) => Promise<string | null>>()
      .mockResolvedValueOnce('  Renamed  ')
      .mockResolvedValueOnce('Renamed')
      .mockResolvedValueOnce('   ')
    const commands = createAppCommands({
      ...createOptions(chatStore),
      requestRenameConversationTitle: requestTitle,
    })

    await expect(commands.renameConversation()).resolves.toBe(true)
    expect(chatStore.title).toBe('Renamed')
    await expect(commands.renameConversation()).resolves.toBe(false)
    await expect(commands.renameConversation()).resolves.toBe(false)
    expect(requestTitle).toHaveBeenNthCalledWith(1, { currentTitle: 'Current' })
  })

  test('runs new and confirmed-delete conversation workflows in action order', async () => {
    const runScenario = async (kind: 'new' | 'delete'): Promise<string[]> => {
      const calls: string[] = []
      const chatStore = createChatStoreStub()
      chatStore.reset = async () => {
        calls.push('store')
      }
      chatStore.deleteCurrentThread = async () => {
        calls.push('store')
        chatStore.threadId = null
      }
      const commands = createAppCommands({
        ...createOptions(chatStore),
        requestDeleteConversationConfirmation: async () => true,
        requestPinToBottom: () => calls.push('pin'),
      })
      commands.registerComposerBridge({
        focusPrompt: () => calls.push('focus'),
        pickAttachments: () => undefined,
        resetComposer: () => calls.push('composer'),
      })

      if (kind === 'new') await commands.newConversation()
      else await commands.deleteConversation()
      return calls
    }

    expect(await runScenario('new')).toEqual(['composer', 'store', 'pin', 'focus'])
    expect(await runScenario('delete')).toEqual(['composer', 'store', 'pin', 'focus'])
  })

  test('tracks attachment bridge registration and busy availability', () => {
    const chatStore = createChatStoreStub()
    const picks = vi.fn()
    const commands = createAppCommands(createOptions(chatStore))

    expect([commands.canPickAttachments(), commands.pickAttachments()]).toEqual([false, false])
    const unregister = commands.registerComposerBridge({
      focusPrompt: () => undefined,
      pickAttachments: picks,
      resetComposer: () => undefined,
    })
    expect([commands.canPickAttachments(), commands.pickAttachments()]).toEqual([true, true])
    expect(picks).toHaveBeenCalledOnce()

    chatStore.isLoading = true
    expect([commands.canPickAttachments(), commands.pickAttachments()]).toEqual([false, false])
    chatStore.isLoading = false
    unregister()
    expect(commands.canPickAttachments()).toBe(false)
  })

  test('guards thread mutations when context, state, or store capabilities are unavailable', () => {
    const chatStore = createChatStoreStub()
    const contextAvailable = vi.fn(() => false)
    const commands = createAppCommands({
      ...createOptions(chatStore),
      canUseChatContext: contextAvailable,
    })

    expect([commands.canRenameConversation(), commands.canDeleteConversation()]).toEqual([
      false,
      false,
    ])

    contextAvailable.mockReturnValue(true)
    chatStore.isStreaming = true
    expect([commands.canRenameConversation(), commands.canDeleteConversation()]).toEqual([
      false,
      false,
    ])

    chatStore.isStreaming = false
    chatStore.threadId = null
    expect([commands.canRenameConversation(), commands.canDeleteConversation()]).toEqual([
      false,
      false,
    ])
  })
})
