import { toChildRunReplayOutput } from '../../domain/agents/agent-types'
import type {
  AiMessage,
  AiMessageContent,
  AiProviderName,
  AiReasoningOptions,
} from '../../domain/ai/types'
import type { ItemContentPart, ItemRecord } from '../../domain/runtime/item-repository'
import type { SessionMessageRecord } from '../../domain/sessions/session-message-repository'
import type { VisibleFileContextEntry } from '../files/file-context'
import {
  buildModelVisibleMessageContent,
  groupInlineImageFilesByMessageId,
} from './model-visible-user-content'

export interface RunInteractionOverrides {
  maxOutputTokens?: number
  model?: string
  modelAlias?: string
  provider?: AiProviderName
  reasoning?: AiReasoningOptions
  temperature?: number
}

export const toTextContent = (text: string): Extract<AiMessageContent, { type: 'text' }> => ({
  text,
  type: 'text',
})

const toItemTextContent = (part: ItemContentPart): Extract<AiMessageContent, { type: 'text' }> => ({
  ...(part.thought === true ? { thought: true } : {}),
  ...(typeof part.thoughtSignature === 'string' && part.thoughtSignature.length > 0
    ? { thoughtSignature: part.thoughtSignature }
    : {}),
  text: part.text,
  type: 'text',
})

const toGoogleReasoningText = (summary: unknown): string | undefined => {
  if (!Array.isArray(summary)) {
    return undefined
  }

  const text = summary
    .flatMap((part) => {
      if (
        typeof part === 'object' &&
        part !== null &&
        'text' in part &&
        typeof part.text === 'string'
      ) {
        return [part.text]
      }

      return []
    })
    .join('')
    .trim()

  return text.length > 0 ? text : undefined
}

interface ToItemMessagesOptions {
  provider?: AiProviderName | null
}

const toMappedFunctionOutputJson = (toolName: string, outputJson: string): string => {
  if (toolName !== 'delegate_to_agent' && toolName !== 'resume_delegated_run') {
    return outputJson
  }

  try {
    const mapped = toChildRunReplayOutput(JSON.parse(outputJson))
    return mapped ? JSON.stringify(mapped) : outputJson
  } catch {
    return outputJson
  }
}

const toAssistantProviderMessageId = (item: ItemRecord): string | undefined => {
  if (item.role !== 'assistant') {
    return undefined
  }

  const providerPayload = item.providerPayload as {
    sessionMessageId?: string | null
    providerMessageId?: string | null
  } | null

  return providerPayload?.providerMessageId ?? providerPayload?.sessionMessageId ?? undefined
}

const toReasoningProviderItemId = (item: ItemRecord): string | undefined => {
  if (item.type !== 'reasoning') {
    return undefined
  }

  const providerPayload = item.providerPayload as {
    providerItemId?: string | null
  } | null

  return typeof providerPayload?.providerItemId === 'string' &&
    providerPayload.providerItemId.length > 0
    ? providerPayload.providerItemId
    : undefined
}

export const toVisibleMessages = (
  visibleMessages: SessionMessageRecord[],
  visibleFiles: VisibleFileContextEntry[] = [],
): AiMessage[] => {
  const messages: AiMessage[] = []
  const imageFilesByMessageId = groupInlineImageFilesByMessageId(visibleFiles)

  for (const message of visibleMessages) {
    if (!message.content || message.content.length === 0) {
      continue
    }

    const content = buildModelVisibleMessageContent(
      message.content,
      imageFilesByMessageId.get(message.id),
    )

    if (content.length === 0) {
      continue
    }

    messages.push({
      content,
      role: message.authorKind,
    })
  }

  return messages
}

export const toItemMessages = (
  items: ItemRecord[],
  options: ToItemMessagesOptions = {},
): AiMessage[] => {
  const messages: AiMessage[] = []
  const functionCallNames = new Map<string, string>()
  const functionCallSignatures = new Map<string, string>()

  for (const item of items) {
    if (item.type === 'function_call' && item.callId && item.name) {
      functionCallNames.set(item.callId, item.name)

      const providerPayload = item.providerPayload as {
        providerSignature?: string | null
        thoughtSignature?: string | null
      } | null
      const providerSignature =
        providerPayload?.providerSignature ?? providerPayload?.thoughtSignature ?? null

      if (typeof providerSignature === 'string' && providerSignature.length > 0) {
        functionCallSignatures.set(item.callId, providerSignature)
      }
    }
  }

  for (const item of items) {
    if (item.type === 'message' && item.role && item.content && item.content.length > 0) {
      const providerMessageId = toAssistantProviderMessageId(item)
      const content =
        item.role === 'user'
          ? buildModelVisibleMessageContent(item.content)
          : item.content.map((part) => toItemTextContent(part))

      messages.push({
        content,
        ...(providerMessageId ? { providerMessageId } : {}),
        role: item.role === 'developer' ? 'developer' : item.role,
      })
      continue
    }

    if (item.type === 'function_call' && item.callId && item.name && item.arguments) {
      messages.push({
        content: [
          {
            argumentsJson: item.arguments,
            callId: item.callId,
            name: item.name,
            ...((item.providerPayload as { providerSignature?: string | null } | null)
              ?.providerSignature
              ? {
                  providerSignature: (item.providerPayload as { providerSignature?: string })
                    .providerSignature,
                }
              : {}),
            ...((item.providerPayload as { thoughtSignature?: string | null } | null)
              ?.thoughtSignature
              ? {
                  thoughtSignature: (item.providerPayload as { thoughtSignature?: string })
                    .thoughtSignature,
                }
              : {}),
            type: 'function_call',
          },
        ],
        role: 'assistant',
      })
      continue
    }

    if (item.type === 'function_call_output' && item.callId && item.output) {
      const providerPayload = item.providerPayload as {
        isError?: boolean
        name?: string
      } | null
      const resolvedName = providerPayload?.name ?? functionCallNames.get(item.callId)
      const providerSignature = functionCallSignatures.get(item.callId)

      if (!resolvedName) {
        continue
      }

      messages.push({
        content: [
          {
            callId: item.callId,
            isError: providerPayload?.isError,
            name: resolvedName,
            outputJson: toMappedFunctionOutputJson(resolvedName, item.output),
            ...(providerSignature ? { providerSignature } : {}),
            type: 'function_result',
          },
        ],
        role: 'tool',
      })
      continue
    }

    if (item.type === 'reasoning' && item.summary) {
      const providerPayload = item.providerPayload as {
        encryptedContent?: string | null
        provider?: string | null
      } | null
      const providerItemId = toReasoningProviderItemId(item)

      if (!providerItemId) {
        continue
      }

      if (options.provider === 'google' && providerPayload?.provider !== 'google') {
        continue
      }

      messages.push({
        content: [
          {
            id: providerItemId,
            summary: item.summary,
            ...(options.provider === 'google'
              ? {
                  text: toGoogleReasoningText(item.summary),
                  thought: true,
                }
              : {
                  encryptedContent: providerPayload?.encryptedContent ?? null,
                }),
            type: 'reasoning',
          },
        ],
        role: 'assistant',
      })
    }
  }

  return messages
}
