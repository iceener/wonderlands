import {
  BACKEND_DEFAULT_MODEL,
  type BackendThread,
  type ChatModel,
  type ChatReasoningMode,
} from '@wonderlands/contracts/chat'
import { getContext, setContext } from 'svelte'
import type { Theme } from '../stores/theme.svelte'
import type { TypewriterSpeed } from '../stores/typewriter.svelte'

const APP_COMMANDS_CONTEXT = Symbol('app-commands')
export const THEME_CYCLE: Theme[] = ['light', 'dark', 'system']
export const TYPEWRITER_CYCLE: TypewriterSpeed[] = ['off', 'fast', 'normal', 'slow']
const THREAD_NAVIGATION_LIMIT = 50

interface ChatStoreLike {
  readonly availableModels?: readonly ChatModel[]
  readonly availableReasoningModes?: readonly { id: ChatReasoningMode }[]
  readonly chatModel: ChatModel
  readonly currentThreadTitle?: string | null
  readonly chatReasoningMode?: ChatReasoningMode
  readonly isCancelling: boolean
  readonly isLoading: boolean
  readonly isStreaming: boolean
  readonly threadId: string | null
  readonly title: string
  readonly isWaiting?: boolean
  deleteCurrentThread?: () => Promise<void>
  renameCurrentThread?: (title: string) => Promise<void>
  reset: () => Promise<void>
  setChatModel: (model: ChatModel) => void
  setChatReasoningMode?: (mode: ChatReasoningMode) => void
  switchToThread?: (thread: BackendThread) => Promise<void>
}

interface TypewriterStoreLike {
  speed: TypewriterSpeed
}

interface ThemeStoreLike {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export interface ComposerCommandBridge {
  focusPrompt: () => Promise<void> | void
  pickAttachments: () => void
  resetComposer: () => void
}

export interface AppCommands {
  canPickAttachments: () => boolean
  canOpenAgentPanel: () => boolean
  canOpenConnectMcp: () => boolean
  canOpenConversationPicker: () => boolean
  canGoToPreviousConversation: () => boolean
  canGoToNextConversation: () => boolean
  canOpenWorkspacePicker: () => boolean
  canRenameConversation: () => boolean
  canDeleteConversation: () => boolean
  canOpenManageMcp: () => boolean
  canOpenManageGardens: () => boolean
  canOpenManageToolProfiles: () => boolean
  canOpenManageAgentTasks: () => boolean
  canCycleModel: () => boolean
  canCycleReasoning: () => boolean
  canCycleTheme: () => boolean
  canOpenKeyboardShortcuts: () => boolean
  canSignOut: () => boolean
  canStartNewConversation: () => boolean
  openKeyboardShortcuts: () => boolean
  openAgentPanel: () => boolean
  openNewAgent: () => boolean
  openConnectMcp: () => boolean
  openConversationPicker: () => boolean
  goToPreviousConversation: () => Promise<boolean>
  goToNextConversation: () => Promise<boolean>
  openWorkspacePicker: () => boolean
  renameConversation: () => Promise<boolean>
  deleteConversation: () => Promise<boolean>
  openManageMcp: () => boolean
  openManageGardens: () => boolean
  openNewGarden: () => boolean
  openManageToolProfiles: () => boolean
  openManageAgentTasks: () => boolean
  openNewAgentTask: () => boolean
  cycleModel: () => boolean
  cycleReasoning: () => boolean
  cycleTheme: () => boolean
  cycleTypewriter: () => boolean
  signOut: () => Promise<boolean>
  newConversation: () => Promise<boolean>
  pickAttachments: () => boolean
  registerComposerBridge: (bridge: ComposerCommandBridge) => () => void
}

export interface CreateAppCommandsOptions {
  canOpenAgentPanel?: () => boolean
  canOpenManageGardens?: () => boolean
  canOpenConversationPicker?: () => boolean
  canSignOut?: () => boolean
  canOpenWorkspacePicker?: () => boolean
  canUseChatContext?: () => boolean
  chatStore: ChatStoreLike
  listThreads?: (options?: { limit?: number; query?: string }) => Promise<BackendThread[]>
  openAgentPanel?: () => void
  openNewAgent?: () => void
  openConnectMcp?: () => void
  openConversationPicker?: () => void
  openWorkspacePicker?: () => void
  openKeyboardShortcuts?: () => void
  openManageMcp?: () => void
  openManageGardens?: () => void
  openNewGarden?: () => void
  openManageToolProfiles?: () => void
  canOpenManageAgentTasks?: () => boolean
  openManageAgentTasks?: () => void
  openNewAgentTask?: () => void
  requestDeleteConversationConfirmation?: (input: {
    currentTitle: string
  }) => boolean | Promise<boolean>
  requestRenameConversationTitle?: (input: {
    currentTitle: string
  }) => string | null | Promise<string | null>
  requestPinToBottom?: () => void
  signOut?: () => Promise<void> | void
  theme: ThemeStoreLike
  typewriter: TypewriterStoreLike
}

const nextInCycle = <TValue>(values: readonly TValue[], current: TValue): TValue => {
  const index = values.indexOf(current)
  return values[(index + 1 + values.length) % values.length] ?? values[0]
}

export const modelSupportsReasoning = (model: ChatModel): boolean => /^(o\d|gpt-5)/iu.test(model)
export const createAppCommands = ({
  canOpenAgentPanel,
  canOpenManageGardens,
  canOpenConversationPicker,
  canSignOut,
  canOpenWorkspacePicker,
  canUseChatContext,
  chatStore,
  listThreads,
  openAgentPanel,
  openNewAgent,
  openConnectMcp,
  openConversationPicker,
  openKeyboardShortcuts,
  openWorkspacePicker,
  openManageMcp,
  openManageGardens,
  openNewGarden,
  openManageToolProfiles,
  canOpenManageAgentTasks,
  openManageAgentTasks,
  openNewAgentTask,
  requestDeleteConversationConfirmation,
  requestRenameConversationTitle,
  requestPinToBottom,
  signOut: performSignOut,
  theme,
  typewriter,
}: CreateAppCommandsOptions): AppCommands => {
  let composerBridge: ComposerCommandBridge | null = null

  const chatContextAvailable = (): boolean => canUseChatContext?.() ?? true
  const controlsBusy = (): boolean =>
    chatStore.isLoading ||
    chatStore.isStreaming ||
    chatStore.isCancelling ||
    chatStore.isWaiting === true
  const modelChoices = (): readonly ChatModel[] =>
    chatStore.availableModels && chatStore.availableModels.length > 0
      ? chatStore.availableModels
      : [BACKEND_DEFAULT_MODEL]
  const reasoningChoices = (): readonly ChatReasoningMode[] =>
    chatStore.availableReasoningModes && chatStore.availableReasoningModes.length > 0
      ? chatStore.availableReasoningModes.map((mode) => mode.id)
      : []
  const canOpenConversationPickerCommand = (): boolean =>
    typeof openConversationPicker === 'function' && (canOpenConversationPicker?.() ?? true)
  const canNavigateConversationCommand = (): boolean =>
    Boolean(chatStore.threadId) &&
    Boolean(chatStore.switchToThread) &&
    typeof listThreads === 'function'
  const canOpenAgentPanelCommand = (): boolean =>
    typeof openAgentPanel === 'function' && (canOpenAgentPanel?.() ?? true)
  const canOpenWorkspacePickerCommand = (): boolean =>
    typeof openWorkspacePicker === 'function' && (canOpenWorkspacePicker?.() ?? true)
  const canOpenManageGardensCommand = (): boolean =>
    typeof openManageGardens === 'function' && (canOpenManageGardens?.() ?? true)
  const canOpenManageAgentTasksCommand = (): boolean =>
    typeof openManageAgentTasks === 'function' && (canOpenManageAgentTasks?.() ?? true)
  const canSignOutCommand = (): boolean =>
    typeof performSignOut === 'function' && (canSignOut?.() ?? true)
  const canRenameConversationCommand = (): boolean =>
    chatContextAvailable() &&
    !controlsBusy() &&
    Boolean(chatStore.threadId) &&
    Boolean(chatStore.renameCurrentThread)
  const canDeleteConversationCommand = (): boolean =>
    chatContextAvailable() &&
    !controlsBusy() &&
    Boolean(chatStore.threadId) &&
    Boolean(chatStore.deleteCurrentThread)
  const currentConversationTitle = (): string => chatStore.currentThreadTitle?.trim() ?? ''
  const requestRenameConversationTitleImpl = async (
    currentTitle: string,
  ): Promise<string | null> => {
    if (requestRenameConversationTitle) {
      return await requestRenameConversationTitle({ currentTitle })
    }

    if (typeof window === 'undefined') {
      return null
    }

    return window.prompt('Rename conversation', currentTitle)
  }
  const requestDeleteConversationConfirmationImpl = async (
    currentTitle: string,
  ): Promise<boolean> => {
    if (requestDeleteConversationConfirmation) {
      return await requestDeleteConversationConfirmation({ currentTitle })
    }

    if (typeof window === 'undefined') {
      return false
    }

    return window.confirm('Permanently delete this conversation? This cannot be undone.')
  }
  const goToAdjacentConversation = async (offset: -1 | 1): Promise<boolean> => {
    const currentThreadId = chatStore.threadId

    if (
      !canNavigateConversationCommand() ||
      !listThreads ||
      !chatStore.switchToThread ||
      !currentThreadId
    ) {
      return false
    }

    const threads = await listThreads({ limit: THREAD_NAVIGATION_LIMIT })
    const currentIndex = threads.findIndex((thread) => thread.id === currentThreadId)

    if (currentIndex < 0) {
      return false
    }

    const nextThread = threads[currentIndex + offset]
    if (!nextThread) {
      return false
    }

    await chatStore.switchToThread(nextThread)
    return true
  }

  return {
    canPickAttachments() {
      return chatContextAvailable() && !controlsBusy() && Boolean(composerBridge?.pickAttachments)
    },

    canOpenConnectMcp() {
      return typeof openConnectMcp === 'function'
    },

    canOpenKeyboardShortcuts() {
      return typeof openKeyboardShortcuts === 'function'
    },

    openKeyboardShortcuts() {
      if (!openKeyboardShortcuts) {
        return false
      }

      openKeyboardShortcuts()
      return true
    },

    canOpenAgentPanel() {
      return canOpenAgentPanelCommand()
    },

    canOpenConversationPicker() {
      return canOpenConversationPickerCommand()
    },

    canGoToPreviousConversation() {
      return canNavigateConversationCommand()
    },

    canGoToNextConversation() {
      return canNavigateConversationCommand()
    },

    canOpenWorkspacePicker() {
      return canOpenWorkspacePickerCommand()
    },

    canRenameConversation() {
      return canRenameConversationCommand()
    },

    canDeleteConversation() {
      return canDeleteConversationCommand()
    },

    canOpenManageMcp() {
      return typeof openManageMcp === 'function'
    },

    canOpenManageGardens() {
      return canOpenManageGardensCommand()
    },

    canOpenManageToolProfiles() {
      return typeof openManageToolProfiles === 'function'
    },

    canOpenManageAgentTasks() {
      return canOpenManageAgentTasksCommand()
    },

    canCycleModel() {
      return !controlsBusy() && modelChoices().length > 1
    },

    canCycleReasoning() {
      return (
        !controlsBusy() &&
        Boolean(chatStore.setChatReasoningMode) &&
        Boolean(chatStore.chatReasoningMode) &&
        reasoningChoices().length > 1
      )
    },

    canCycleTheme() {
      return true
    },

    canSignOut() {
      return canSignOutCommand()
    },

    canStartNewConversation() {
      return true
    },

    openConnectMcp() {
      if (!openConnectMcp) {
        return false
      }

      openConnectMcp()
      return true
    },

    openAgentPanel() {
      if (!canOpenAgentPanelCommand() || !openAgentPanel) {
        return false
      }

      openAgentPanel()
      return true
    },

    openNewAgent() {
      if (!canOpenAgentPanelCommand() || !openNewAgent) {
        return false
      }

      openNewAgent()
      return true
    },

    openConversationPicker() {
      if (!canOpenConversationPickerCommand() || !openConversationPicker) {
        return false
      }

      openConversationPicker()
      return true
    },

    async goToPreviousConversation() {
      return await goToAdjacentConversation(1)
    },

    async goToNextConversation() {
      return await goToAdjacentConversation(-1)
    },

    openWorkspacePicker() {
      if (!canOpenWorkspacePickerCommand() || !openWorkspacePicker) {
        return false
      }

      openWorkspacePicker()
      return true
    },

    async renameConversation() {
      if (!canRenameConversationCommand() || !chatStore.renameCurrentThread) {
        return false
      }

      const currentTitle = currentConversationTitle()
      const nextTitle = await requestRenameConversationTitleImpl(currentTitle)
      const trimmedTitle = nextTitle?.trim()

      if (!trimmedTitle || trimmedTitle === currentTitle) {
        return false
      }

      await chatStore.renameCurrentThread(trimmedTitle)
      return true
    },

    async deleteConversation() {
      if (!canDeleteConversationCommand() || !chatStore.deleteCurrentThread) {
        return false
      }

      const confirmed = await requestDeleteConversationConfirmationImpl(currentConversationTitle())
      if (!confirmed) {
        return false
      }

      composerBridge?.resetComposer()
      await chatStore.deleteCurrentThread()
      if (!chatStore.threadId) {
        requestPinToBottom?.()
        await composerBridge?.focusPrompt()
      }
      return true
    },

    openManageMcp() {
      if (!openManageMcp) {
        return false
      }

      openManageMcp()
      return true
    },

    openManageGardens() {
      if (!canOpenManageGardensCommand() || !openManageGardens) {
        return false
      }

      openManageGardens()
      return true
    },

    openNewGarden() {
      if (!canOpenManageGardensCommand() || !openNewGarden) {
        return false
      }

      openNewGarden()
      return true
    },

    openManageToolProfiles() {
      if (!openManageToolProfiles) {
        return false
      }

      openManageToolProfiles()
      return true
    },

    openManageAgentTasks() {
      if (!canOpenManageAgentTasksCommand() || !openManageAgentTasks) {
        return false
      }

      openManageAgentTasks()
      return true
    },

    openNewAgentTask() {
      if (!canOpenManageAgentTasksCommand() || !openNewAgentTask) {
        return false
      }

      openNewAgentTask()
      return true
    },

    cycleModel() {
      const availableModels = modelChoices()

      if (controlsBusy() || availableModels.length < 2) {
        return false
      }

      const nextModel = nextInCycle(availableModels, chatStore.chatModel)
      chatStore.setChatModel(nextModel)

      return true
    },

    cycleReasoning() {
      const availableReasoningModes = reasoningChoices()

      if (
        controlsBusy() ||
        !chatStore.setChatReasoningMode ||
        !chatStore.chatReasoningMode ||
        availableReasoningModes.length < 2
      ) {
        return false
      }

      const nextMode = nextInCycle(availableReasoningModes, chatStore.chatReasoningMode)
      chatStore.setChatReasoningMode(nextMode)

      return true
    },

    cycleTheme() {
      theme.setTheme(nextInCycle(THEME_CYCLE, theme.theme))
      return true
    },

    cycleTypewriter() {
      typewriter.speed = nextInCycle(TYPEWRITER_CYCLE, typewriter.speed)
      return true
    },

    async signOut() {
      if (!canSignOutCommand() || !performSignOut) {
        return false
      }

      await performSignOut()
      return true
    },

    async newConversation() {
      composerBridge?.resetComposer()
      await chatStore.reset()
      requestPinToBottom?.()
      await composerBridge?.focusPrompt()
      return true
    },

    pickAttachments() {
      if (controlsBusy() || !composerBridge?.pickAttachments) {
        return false
      }

      composerBridge.pickAttachments()
      return true
    },

    registerComposerBridge(bridge) {
      composerBridge = bridge

      return () => {
        if (composerBridge === bridge) {
          composerBridge = null
        }
      }
    },
  }
}

export const setAppCommandsContext = (appCommands: AppCommands): AppCommands => {
  setContext(APP_COMMANDS_CONTEXT, appCommands)
  return appCommands
}

export const getAppCommandsContext = (): AppCommands =>
  getContext<AppCommands>(APP_COMMANDS_CONTEXT)
