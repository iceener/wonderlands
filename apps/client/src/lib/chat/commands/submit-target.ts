import type {
  BackendModelsCatalog,
  ChatModel,
  ChatReasoningMode,
  ConversationTargetInput,
  ProviderName,
  ReasoningEffort,
} from '@wonderlands/contracts/chat'

type ConversationTargetMode = 'default' | 'assistant' | 'agent'

export interface SubmitAgentSelection {
  agentId: string
  agentName?: string | null
}

export interface SubmitConversationTargetResolution {
  nextActiveAgentId: string | null
  nextActiveAgentName: string | null
  nextTargetMode: ConversationTargetMode
  target?: ConversationTargetInput
}

const getSelectedModelAliases = (
  catalog: BackendModelsCatalog | null,
  model: ChatModel,
  defaultModelValue: ChatModel,
) => {
  if (!catalog) {
    return []
  }

  if (model === defaultModelValue) {
    return catalog.aliases.filter((alias) => alias.isDefault)
  }

  return catalog.aliases.filter((alias) => alias.configured && alias.model === model)
}

export const resolveSubmitConversationTarget = (input: {
  activeAgentId: string | null
  activeAgentName: string | null
  agentSelection?: SubmitAgentSelection
  targetMode: ConversationTargetMode
}):
  | {
      ok: true
      value: SubmitConversationTargetResolution
    }
  | { error: string; ok: false } => {
  const submittedAgentId = input.agentSelection?.agentId?.trim() || null
  const submittedAgentName = input.agentSelection?.agentName?.trim() || null

  if (submittedAgentId) {
    return {
      ok: true,
      value: {
        nextActiveAgentId: submittedAgentId,
        nextActiveAgentName: submittedAgentName,
        nextTargetMode: 'agent',
        target: {
          agentId: submittedAgentId,
          kind: 'agent',
        },
      },
    }
  }

  if (input.targetMode === 'assistant') {
    return {
      ok: true,
      value: {
        nextActiveAgentId: input.activeAgentId,
        nextActiveAgentName: input.activeAgentName,
        nextTargetMode: 'assistant',
        target: {
          kind: 'assistant',
        },
      },
    }
  }

  if (input.targetMode === 'agent') {
    const activeAgentId = input.activeAgentId?.trim() || null

    if (!activeAgentId) {
      return {
        error: 'Choose an agent or switch to Assistant/Default before sending.',
        ok: false,
      }
    }

    return {
      ok: true,
      value: {
        nextActiveAgentId: activeAgentId,
        nextActiveAgentName: input.activeAgentName,
        nextTargetMode: 'agent',
        target: {
          agentId: activeAgentId,
          kind: 'agent',
        },
      },
    }
  }

  return {
    ok: true,
    value: {
      nextActiveAgentId: input.activeAgentId,
      nextActiveAgentName: input.activeAgentName,
      nextTargetMode: 'default',
    },
  }
}

export const buildSubmitInteractionOptions = (input: {
  chatModel: ChatModel
  chatReasoningMode: ChatReasoningMode
  defaultModelValue: ChatModel
  defaultReasoningValue: ChatReasoningMode
  modelsCatalog: BackendModelsCatalog | null
  target?: ConversationTargetInput
}): {
  model?: string
  provider?: ProviderName
  reasoning?: {
    effort: ReasoningEffort
  }
  target?: ConversationTargetInput
} => {
  const model = input.chatModel === input.defaultModelValue ? undefined : input.chatModel
  const provider =
    model == null
      ? undefined
      : getSelectedModelAliases(input.modelsCatalog, input.chatModel, input.defaultModelValue)[0]
          ?.provider
  const reasoning =
    input.chatReasoningMode === input.defaultReasoningValue
      ? undefined
      : {
          effort: input.chatReasoningMode as ReasoningEffort,
        }

  return {
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(input.target ? { target: input.target } : {}),
  }
}
