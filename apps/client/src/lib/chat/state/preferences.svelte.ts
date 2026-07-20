import type {
  BackendAccountPreferences,
  BackendModelsCatalog,
  ChatModel,
  ChatReasoningMode,
} from '@wonderlands/contracts/chat'
import type { ChatReasoningModeOption, ConversationTargetMode } from '../types'

interface PreferencesStateDependencies<Lease> {
  defaultModelValue: ChatModel
  deriveAvailableModels: (catalog: BackendModelsCatalog) => ChatModel[]
  deriveAvailableReasoningModes: (
    catalog: BackendModelsCatalog | null,
    model: ChatModel,
  ) => ChatReasoningModeOption[]
  getAccountPreferences?: (() => Promise<BackendAccountPreferences>) | null
  getAgentName: (agentId: string) => Promise<string | null>
  getSupportedModels?: (() => Promise<BackendModelsCatalog>) | null
  initialModel: ChatModel
  initialReasoningMode: ChatReasoningMode
  isViewLeaseCurrent: (lease: Lease) => boolean
  pickPreferredModel: (
    availableModels: readonly ChatModel[],
    catalog: BackendModelsCatalog | null,
  ) => ChatModel
  pickPreferredReasoningMode: (
    availableReasoningModes: readonly ChatReasoningModeOption[],
  ) => ChatReasoningMode
}

export const createChatPreferencesState = <Lease>({
  defaultModelValue,
  deriveAvailableModels,
  deriveAvailableReasoningModes,
  getAccountPreferences,
  getAgentName,
  getSupportedModels,
  initialModel,
  initialReasoningMode,
  isViewLeaseCurrent,
  pickPreferredModel,
  pickPreferredReasoningMode,
}: PreferencesStateDependencies<Lease>) => {
  let activeAgentId: string | null = $state(null)
  let activeAgentName: string | null = $state(null)
  let defaultTarget: BackendAccountPreferences['defaultTarget'] | null = $state.raw(null)
  let defaultTargetAgentName: string | null = $state(null)
  let targetMode: ConversationTargetMode = $state('default')
  let chatModel: ChatModel = $state(initialModel)
  let chatReasoningMode: ChatReasoningMode = $state(initialReasoningMode)
  let availableModels: ChatModel[] = $state.raw([initialModel])
  let modelsCatalog: BackendModelsCatalog | null = $state.raw(null)

  const availableReasoningModes = $derived(deriveAvailableReasoningModes(modelsCatalog, chatModel))

  const contextWindow = $derived.by(() => {
    if (!modelsCatalog) {
      return null
    }

    const selectedModel = chatModel === defaultModelValue ? modelsCatalog.defaultModel : chatModel
    return (
      modelsCatalog.aliases.find((alias) => alias.model === selectedModel)?.contextWindow ?? null
    )
  })

  const exposedAvailableModels = $derived([...availableModels] as readonly ChatModel[])

  const clearDefaultTargetState = () => {
    defaultTarget = null
    defaultTargetAgentName = null
  }

  const clearTargetSelectionState = () => {
    activeAgentId = null
    activeAgentName = null
    targetMode = 'default'
  }

  const reconcileReasoningMode = () => {
    const nextAvailableReasoningModes = deriveAvailableReasoningModes(modelsCatalog, chatModel)

    if (nextAvailableReasoningModes.some((mode) => mode.id === chatReasoningMode)) {
      return
    }

    chatReasoningMode = pickPreferredReasoningMode(nextAvailableReasoningModes)
  }

  const refreshAccountPreferences = async (viewLease: Lease): Promise<void> => {
    if (!getAccountPreferences) {
      if (isViewLeaseCurrent(viewLease)) {
        clearDefaultTargetState()
      }
      return
    }

    const preferences = await getAccountPreferences()
    if (!isViewLeaseCurrent(viewLease)) {
      return
    }

    defaultTarget = preferences.defaultTarget
    if (preferences.defaultTarget.kind !== 'agent') {
      defaultTargetAgentName = null
      return
    }

    try {
      const agentName = await getAgentName(preferences.defaultTarget.agentId)
      if (!isViewLeaseCurrent(viewLease)) {
        return
      }

      defaultTargetAgentName = agentName
    } catch {
      if (isViewLeaseCurrent(viewLease)) {
        defaultTargetAgentName = null
      }
    }
  }

  const refreshAvailableModels = async (viewLease: Lease) => {
    if (!getSupportedModels) {
      return
    }

    const catalog = await getSupportedModels()
    if (!isViewLeaseCurrent(viewLease)) {
      return
    }

    const nextAvailableModels = deriveAvailableModels(catalog)
    modelsCatalog = catalog
    availableModels = nextAvailableModels

    if (!nextAvailableModels.includes(chatModel)) {
      chatModel = pickPreferredModel(nextAvailableModels, catalog)
    }

    reconcileReasoningMode()
  }

  return {
    clearDefaultTargetState,
    clearTargetSelectionState,
    get activeAgentId() {
      return activeAgentId
    },
    get activeAgentName() {
      return activeAgentName
    },
    get availableModels(): readonly ChatModel[] {
      return exposedAvailableModels
    },
    get availableReasoningModes(): readonly ChatReasoningModeOption[] {
      return availableReasoningModes
    },
    get chatModel(): ChatModel {
      return chatModel
    },
    get chatReasoningMode(): ChatReasoningMode {
      return chatReasoningMode
    },
    get contextWindow(): number | null {
      return contextWindow
    },
    get defaultTarget(): BackendAccountPreferences['defaultTarget'] | null {
      return defaultTarget
    },
    get defaultTargetAgentName(): string | null {
      return defaultTargetAgentName
    },
    get modelsCatalog(): BackendModelsCatalog | null {
      return modelsCatalog
    },
    get targetMode(): ConversationTargetMode {
      return targetMode
    },
    reconcileReasoningMode,
    refreshAccountPreferences,
    refreshAvailableModels,
    setChatModel(model: ChatModel) {
      chatModel = model
      reconcileReasoningMode()
    },
    setChatReasoningMode(mode: ChatReasoningMode) {
      chatReasoningMode = mode
    },
    setResolvedConversationTarget(input: {
      nextActiveAgentId: string | null
      nextActiveAgentName: string | null
      nextTargetMode: ConversationTargetMode
    }) {
      activeAgentId = input.nextActiveAgentId
      activeAgentName = input.nextActiveAgentName
      targetMode = input.nextTargetMode
    },
    setTargetAgent(input: { agentId: string; agentName?: string | null }) {
      activeAgentId = input.agentId.trim() || null
      activeAgentName = input.agentName?.trim() || null
      targetMode = 'agent'
    },
    setTargetMode(mode: ConversationTargetMode) {
      targetMode = mode
    },
  }
}
