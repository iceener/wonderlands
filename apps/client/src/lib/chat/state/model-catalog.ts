import type {
  BackendModelsCatalog,
  ChatModel,
  ChatReasoningMode,
  ReasoningEffort,
} from '@wonderlands/contracts/chat'
import { BACKEND_DEFAULT_MODEL, BACKEND_DEFAULT_REASONING } from '@wonderlands/contracts/chat'
import type { ChatReasoningModeOption } from '../types'

const PREFERRED_DEFAULT_MODEL = 'gpt-5.4' as const
const PREFERRED_DEFAULT_REASONING = 'medium' as const

export const deriveAvailableModels = (catalog: BackendModelsCatalog): ChatModel[] => {
  const availableModels: ChatModel[] = [BACKEND_DEFAULT_MODEL]
  const seenModels = new Set<string>([BACKEND_DEFAULT_MODEL])

  for (const alias of catalog.aliases) {
    if (!alias.configured || seenModels.has(alias.model)) {
      continue
    }

    seenModels.add(alias.model)
    availableModels.push(alias.model as ChatModel)
  }

  return availableModels
}

export const pickPreferredModel = (
  availableModels: readonly ChatModel[],
  catalog: BackendModelsCatalog | null,
): ChatModel => {
  if (availableModels.includes(PREFERRED_DEFAULT_MODEL as ChatModel)) {
    return PREFERRED_DEFAULT_MODEL as ChatModel
  }

  const catalogDefaultModel = catalog?.defaultModel as ChatModel | undefined
  if (catalogDefaultModel && availableModels.includes(catalogDefaultModel)) {
    return catalogDefaultModel
  }

  return (
    availableModels.find((model) => model !== BACKEND_DEFAULT_MODEL) ??
    (BACKEND_DEFAULT_MODEL as ChatModel)
  )
}

export const getSelectedModelAliases = (catalog: BackendModelsCatalog | null, model: ChatModel) => {
  if (!catalog) {
    return []
  }

  if (model === BACKEND_DEFAULT_MODEL) {
    return catalog.aliases.filter((alias) => alias.isDefault)
  }

  return catalog.aliases.filter((alias) => alias.configured && alias.model === model)
}

export const deriveAvailableReasoningModes = (
  catalog: BackendModelsCatalog | null,
  model: ChatModel,
): ChatReasoningModeOption[] => {
  const reasoningModes = new Set<ReasoningEffort>()

  for (const alias of getSelectedModelAliases(catalog, model)) {
    for (const effort of alias.reasoningModes) {
      reasoningModes.add(effort)
    }
  }

  const options: ChatReasoningModeOption[] = [
    {
      id: BACKEND_DEFAULT_REASONING,
      label: 'default',
    },
  ]

  if (!catalog) {
    return options
  }

  for (const mode of catalog.reasoningModes) {
    if (reasoningModes.has(mode.effort)) {
      options.push({
        id: mode.effort,
        label: mode.label,
      })
    }
  }

  return options
}

export const pickPreferredReasoningMode = (
  availableReasoningModes: readonly ChatReasoningModeOption[],
): ChatReasoningMode => {
  const explicitModes = availableReasoningModes.filter(
    (mode) => mode.id !== BACKEND_DEFAULT_REASONING,
  )

  if (explicitModes.length === 1 && explicitModes[0]?.id === 'none') {
    return BACKEND_DEFAULT_REASONING as ChatReasoningMode
  }

  return (availableReasoningModes.find((mode) => mode.id === PREFERRED_DEFAULT_REASONING)?.id ??
    explicitModes[0]?.id ??
    BACKEND_DEFAULT_REASONING) as ChatReasoningMode
}
