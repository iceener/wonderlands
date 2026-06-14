import { randomUUID } from 'node:crypto'
import type { ResponseIncludesEnum, ResponsesRequest } from '@openrouter/sdk/models'
import type { CreateResponsesRequest } from '@openrouter/sdk/models/operations'

import type {
  AiResponseFormat,
  AiToolChoice,
  AiToolDefinition,
  ResolvedAiInteractionRequest,
} from '../../../domain/ai/types'
import { DomainErrorException } from '../../../shared/errors'

export interface OpenRouterRequestConfig {
  appCategories: string | null
  appTitle: string | null
  httpReferer: string | null
  maxRetries: number
  timeoutMs: number
}

type OpenRouterInputItem = Exclude<NonNullable<ResponsesRequest['input']>, string>[number]

const openRouterResponseIncludableValues = ['reasoning.encrypted_content'] as const

const openRouterRequiredReasoningInclude = ['reasoning.encrypted_content'] as const

const openRouterUnsupportedStoreError = (): never => {
  throw new DomainErrorException({
    message: 'OpenRouter Responses requests do not support store=true through this adapter',
    type: 'validation',
  })
}

const isOpenRouterResponseIncludable = (value: string): value is ResponseIncludesEnum =>
  openRouterResponseIncludableValues.some((candidate) => candidate === value)

const ensureOpenRouterCompatibleRequest = (request: ResolvedAiInteractionRequest): void => {
  if (request.executionMode === 'background') {
    throw new DomainErrorException({
      message: 'OpenRouter Responses background execution is not supported in this adapter',
      type: 'validation',
    })
  }

  if (request.stopSequences && request.stopSequences.length > 0) {
    throw new DomainErrorException({
      message: 'OpenRouter Responses requests do not expose stop sequences through this adapter',
      type: 'validation',
    })
  }

  if (request.vendorOptions?.google?.cachedContent) {
    throw new DomainErrorException({
      message: 'Google cachedContent vendor options are not supported by the OpenRouter adapter',
      type: 'validation',
    })
  }

  if (request.vendorOptions?.openai?.conversationId) {
    throw new DomainErrorException({
      message: 'OpenRouter Responses requests do not support OpenAI conversation IDs',
      type: 'validation',
    })
  }

  if (request.vendorOptions?.openai?.promptCacheRetention) {
    throw new DomainErrorException({
      message:
        'OpenRouter Responses requests do not support prompt cache retention in this adapter',
      type: 'validation',
    })
  }

  if (request.vendorOptions?.openai?.store === true) {
    openRouterUnsupportedStoreError()
  }

  if (request.vendorOptions?.openrouter?.provider) {
    throw new DomainErrorException({
      message: 'OpenRouter Responses provider routing controls are not supported in this adapter',
      type: 'validation',
    })
  }

  if (
    Array.isArray(request.vendorOptions?.openrouter?.plugins) &&
    request.vendorOptions.openrouter.plugins.length > 0
  ) {
    throw new DomainErrorException({
      message: 'OpenRouter Responses plugin controls are not supported in this adapter',
      type: 'validation',
    })
  }
}

const toReasoningSummary = (summary: unknown): Array<{ text: string; type: 'summary_text' }> => {
  if (!Array.isArray(summary)) {
    return []
  }

  return summary.flatMap((part) => {
    if (
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      part.type === 'summary_text' &&
      'text' in part &&
      typeof part.text === 'string'
    ) {
      return [{ text: part.text, type: 'summary_text' as const }]
    }

    return []
  })
}

const toOpenRouterInputText = (text: string): { text: string; type: 'input_text' } => ({
  text,
  type: 'input_text',
})

const toOpenRouterMessageContent = (
  message: ResolvedAiInteractionRequest['messages'][number],
): Array<
  | { detail: 'auto' | 'high' | 'low'; imageUrl?: string | null; type: 'input_image' }
  | {
      fileData?: string
      fileId?: string | null
      fileUrl?: string
      filename?: string
      type: 'input_file'
    }
  | { text: string; type: 'input_text' }
> => {
  const content: Array<
    | { detail: 'auto' | 'high' | 'low'; imageUrl?: string | null; type: 'input_image' }
    | {
        fileData?: string
        fileId?: string | null
        fileUrl?: string
        filename?: string
        type: 'input_file'
      }
    | { text: string; type: 'input_text' }
  > = []

  for (const part of message.content) {
    switch (part.type) {
      case 'text':
        content.push(toOpenRouterInputText(part.text))
        break
      case 'image_url':
        content.push({
          detail: part.detail === 'original' ? 'auto' : (part.detail ?? 'auto'),
          imageUrl: part.url,
          type: 'input_image',
        })
        break
      case 'image_file':
        content.push({
          fileId: part.fileId,
          type: 'input_file',
        })
        break
      case 'file_url':
        content.push({
          fileUrl: part.url,
          filename: part.filename,
          type: 'input_file',
        })
        break
      case 'file_id':
        content.push({
          fileId: part.fileId,
          filename: part.filename,
          type: 'input_file',
        })
        break
      case 'function_call':
      case 'function_result':
      case 'reasoning':
        break
    }
  }

  return content
}

const toOpenRouterAssistantMessage = (
  message: ResolvedAiInteractionRequest['messages'][number],
): OpenRouterInputItem | null => {
  if (message.role !== 'assistant') {
    return null
  }

  const content: Array<
    { text: string; type: 'output_text' } | { refusal: string; type: 'refusal' }
  > = []

  for (const part of message.content) {
    switch (part.type) {
      case 'text':
        content.push({
          text: part.text,
          type: 'output_text',
        })
        break
      case 'function_call':
      case 'function_result':
      case 'reasoning':
        break
      case 'file_id':
      case 'file_url':
      case 'image_file':
      case 'image_url':
        throw new DomainErrorException({
          message: `OpenRouter assistant replay does not support ${part.type} content yet`,
          type: 'validation',
        })
    }
  }

  if (content.length === 0) {
    return null
  }

  return {
    content,
    id: message.providerMessageId ?? `msg_${randomUUID().replace(/-/g, '')}`,
    phase: message.phase ?? null,
    role: 'assistant',
    status: 'completed',
    type: 'message',
  }
}

const toOpenRouterInput = (request: ResolvedAiInteractionRequest): Array<OpenRouterInputItem> => {
  const items: Array<OpenRouterInputItem> = []

  for (const message of request.messages) {
    if (message.role === 'assistant') {
      const assistantMessage = toOpenRouterAssistantMessage(message)

      if (assistantMessage) {
        items.push(assistantMessage)
      }
    } else {
      const messageContent = toOpenRouterMessageContent(message)

      if (messageContent.length > 0) {
        if (message.role === 'tool') {
          throw new DomainErrorException({
            message: 'Tool messages must only contain function results for the OpenRouter adapter',
            type: 'validation',
          })
        }

        items.push({
          content: messageContent,
          role: message.role,
          type: 'message',
        })
      }
    }

    for (const part of message.content) {
      if (part.type === 'function_call') {
        if (message.role !== 'assistant') {
          throw new DomainErrorException({
            message: 'Function calls must be emitted by assistant messages',
            type: 'validation',
          })
        }

        items.push({
          arguments: part.argumentsJson,
          callId: part.callId,
          id: part.callId,
          name: part.name,
          status: 'completed',
          type: 'function_call',
        })
        continue
      }

      if (part.type === 'function_result') {
        items.push({
          callId: part.callId,
          output: part.outputJson,
          status: 'completed',
          type: 'function_call_output',
        })
        continue
      }

      if (part.type === 'reasoning') {
        const reasoningItem: OpenRouterInputItem = {
          id: part.id,
          summary: toReasoningSummary(part.summary),
          ...(part.encryptedContent ? { encryptedContent: part.encryptedContent } : {}),
          ...(typeof part.text === 'string' && part.text.trim().length > 0
            ? {
                content: [
                  {
                    text: part.text,
                    type: 'reasoning_text' as const,
                  },
                ],
              }
            : {}),
          ...(part.encryptedContent ? { format: 'openai-responses-v1' as const } : {}),
          status: 'completed',
          type: 'reasoning',
        }

        items.push(reasoningItem)
      }
    }
  }

  return items
}

const toOpenRouterFunctionTools = (
  tools: AiToolDefinition[] | undefined,
): Array<{
  description?: string | null
  name: string
  parameters: Record<string, unknown> | null
  strict?: boolean | null
  type: 'function'
}> =>
  (tools ?? []).map((tool) => ({
    description: tool.description,
    name: tool.name,
    parameters: tool.parameters,
    strict: tool.strict ?? true,
    type: 'function',
  }))

const toOpenRouterNativeTools = (
  request: Pick<ResolvedAiInteractionRequest, 'nativeTools'>,
): Array<{
  maxResults?: number
  searchContextSize?: 'high' | 'low' | 'medium'
  type: 'web_search_2025_08_26'
}> => {
  if (!request.nativeTools?.includes('web_search')) {
    return []
  }

  return [
    {
      searchContextSize: 'medium',
      type: 'web_search_2025_08_26',
    },
  ]
}

const toOpenRouterTools = (
  request: Pick<ResolvedAiInteractionRequest, 'nativeTools' | 'tools'>,
) => {
  const tools = [...toOpenRouterFunctionTools(request.tools), ...toOpenRouterNativeTools(request)]
  return tools.length > 0 ? tools : undefined
}

const toOpenRouterToolChoice = (toolChoice: AiToolChoice | undefined) => {
  if (!toolChoice) {
    return undefined
  }

  if (typeof toolChoice === 'string') {
    return toolChoice
  }

  return {
    name: toolChoice.name,
    type: 'function' as const,
  }
}

const toOpenRouterReasoning = (request: Pick<ResolvedAiInteractionRequest, 'reasoning'>) => {
  if (!request.reasoning) {
    return undefined
  }

  return {
    effort: request.reasoning.effort,
    ...(request.reasoning.summary ? { summary: request.reasoning.summary } : {}),
  }
}

const toOpenRouterInclude = (
  include: string[] | undefined,
  request: Pick<ResolvedAiInteractionRequest, 'reasoning'>,
): ResponseIncludesEnum[] | undefined => {
  const mergedInclude = new Set(include ?? [])

  if (request.reasoning && request.reasoning.effort !== 'none') {
    for (const value of openRouterRequiredReasoningInclude) {
      mergedInclude.add(value)
    }
  }

  if (mergedInclude.size === 0) {
    return undefined
  }

  return [...mergedInclude].map((value) => {
    if (!isOpenRouterResponseIncludable(value)) {
      throw new DomainErrorException({
        message: `OpenRouter include "${value}" is not supported by this adapter`,
        type: 'validation',
      })
    }

    return value
  })
}

const toOpenRouterTextConfig = (responseFormat: AiResponseFormat | undefined) => {
  if (responseFormat?.type === 'json_schema') {
    return {
      format: {
        description: responseFormat.description,
        name: responseFormat.name,
        schema: responseFormat.schema,
        strict: responseFormat.strict,
        type: 'json_schema' as const,
      },
    }
  }

  return {
    format: {
      type: 'text' as const,
    },
  }
}

const buildResponsesRequest = (
  request: ResolvedAiInteractionRequest,
  stream: boolean,
): CreateResponsesRequest['responsesRequest'] => {
  ensureOpenRouterCompatibleRequest(request)

  return {
    background: false,
    include: toOpenRouterInclude(request.include, request),
    input: toOpenRouterInput(request),
    maxOutputTokens: request.maxOutputTokens,
    metadata: request.metadata,
    model: request.model,
    parallelToolCalls: request.allowParallelToolCalls,
    previousResponseId: request.previousResponseId,
    promptCacheKey: request.promptCacheKey,
    reasoning: toOpenRouterReasoning(request),
    safetyIdentifier: request.safetyIdentifier,
    serviceTier: request.serviceTier ?? null,
    store: false,
    stream,
    temperature: request.temperature,
    text: toOpenRouterTextConfig(request.responseFormat),
    toolChoice: toOpenRouterToolChoice(request.toolChoice),
    tools: toOpenRouterTools(request),
    topP: request.topP,
  }
}

type OpenRouterRequestBody<TStream extends boolean> = CreateResponsesRequest & {
  responsesRequest: CreateResponsesRequest['responsesRequest'] & { stream: TStream }
}

export function createRequestBody(
  request: ResolvedAiInteractionRequest,
  config: OpenRouterRequestConfig,
  stream: true,
): OpenRouterRequestBody<true>
export function createRequestBody(
  request: ResolvedAiInteractionRequest,
  config: OpenRouterRequestConfig,
  stream: false,
): OpenRouterRequestBody<false>
export function createRequestBody(
  request: ResolvedAiInteractionRequest,
  config: OpenRouterRequestConfig,
  stream: boolean,
): OpenRouterRequestBody<boolean> {
  return {
    ...(config.appCategories ? { appCategories: config.appCategories } : {}),
    ...(config.appTitle ? { appTitle: config.appTitle } : {}),
    ...(config.httpReferer ? { httpReferer: config.httpReferer } : {}),
    responsesRequest: buildResponsesRequest(
      request,
      stream,
    ) as CreateResponsesRequest['responsesRequest'] & {
      stream: boolean
    },
  }
}

export const createRequestOptions = (
  request: ResolvedAiInteractionRequest,
  config: Pick<OpenRouterRequestConfig, 'maxRetries' | 'timeoutMs'>,
) => ({
  retries:
    (request.maxRetries ?? config.maxRetries) > 0
      ? {
          retryConnectionErrors: true,
          strategy: 'backoff' as const,
        }
      : {
          strategy: 'none' as const,
        },
  signal: request.abortSignal,
  timeoutMs: request.timeoutMs ?? config.timeoutMs,
})
