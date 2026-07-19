import type { Interactions } from '@google/genai'

import { isRecord, parseRequiredJson } from '../../../domain/ai/json-utils'
import type {
  AiFileUrlContent,
  AiFunctionCallContent,
  AiFunctionResultContent,
  AiImageDetail,
  AiImageUrlContent,
  AiProviderNativeToolName,
  AiReasoningContent,
  AiReasoningEffort,
  AiServiceTier,
  AiTextContent,
  AiToolChoice,
  AiToolDefinition,
  ResolvedAiInteractionRequest,
} from '../../../domain/ai/types'
import { DomainErrorException } from '../../../shared/errors'

interface GoogleRequestConfig {
  defaultHttpTimeoutMs: number
  maxRetries: number
}

type GoogleReplayMessage = ResolvedAiInteractionRequest['messages'][number]
type GoogleReplayPart = GoogleReplayMessage['content'][number]

const resolveProviderSignature = (
  part: AiTextContent | AiFunctionCallContent | AiFunctionResultContent | AiReasoningContent,
): string | undefined => {
  if (typeof part.providerSignature === 'string' && part.providerSignature.trim().length > 0) {
    return part.providerSignature
  }

  if ('thoughtSignature' in part && typeof part.thoughtSignature === 'string') {
    const normalized = part.thoughtSignature.trim()

    return normalized.length > 0 ? normalized : undefined
  }

  if (part.type === 'reasoning') {
    const normalized = part.id.trim()

    return normalized.length > 0 ? normalized : undefined
  }

  return undefined
}

const toJsonSchemaObject = (
  argumentsJson: string,
  label: string,
): Record<string, unknown> | undefined => {
  const parsed = parseRequiredJson(argumentsJson, label)

  if (parsed === null) {
    return undefined
  }

  if (!isRecord(parsed)) {
    throw new DomainErrorException({
      message: `${label} must be a JSON object`,
      type: 'validation',
    })
  }

  return parsed
}

const sanitizeFunctionResultValueForGoogle = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return null
    }

    return value.map((entry) => sanitizeFunctionResultValueForGoogle(entry))
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  const sanitizedEntries = Object.entries(value).map(([key, entry]) => [
    key,
    sanitizeFunctionResultValueForGoogle(entry),
  ])

  return Object.fromEntries(sanitizedEntries)
}

const toFunctionResultValue = (part: AiFunctionResultContent): unknown =>
  sanitizeFunctionResultValueForGoogle(
    parseRequiredJson(part.outputJson, `Function result "${part.name}"`),
  )

const toReasoningSummary = (
  part: Extract<
    ResolvedAiInteractionRequest['messages'][number]['content'][number],
    { type: 'reasoning' }
  >,
): Interactions.ThoughtStep['summary'] | undefined => {
  if (typeof part.text === 'string' && part.text.trim().length > 0) {
    return [
      {
        text: part.text,
        type: 'text',
      },
    ]
  }

  if (!Array.isArray(part.summary)) {
    return undefined
  }

  const summary = part.summary.flatMap((summaryPart) => {
    if (
      typeof summaryPart === 'object' &&
      summaryPart !== null &&
      'text' in summaryPart &&
      typeof summaryPart.text === 'string'
    ) {
      return [
        {
          text: summaryPart.text,
          type: 'text' as const,
        },
      ]
    }

    return []
  })

  return summary.length > 0 ? summary : undefined
}

const toResolution = (
  detail: AiImageDetail | undefined,
): Interactions.ImageContent['resolution'] | undefined => {
  switch (detail) {
    case 'low':
      return 'low'
    case 'high':
      return 'high'
    case 'original':
      return 'ultra_high'
    case 'auto':
    case undefined:
      return undefined
  }
}

const assertGsUri = (url: string, label: string): void => {
  if (!url.startsWith('gs://')) {
    throw new DomainErrorException({
      message: `${label} currently requires a gs:// URI in the Google Interactions adapter`,
      type: 'validation',
    })
  }
}

const toMediaContent = (part: AiFileUrlContent | AiImageUrlContent): Interactions.Content => {
  if (part.type === 'image_url') {
    assertGsUri(part.url, 'Google image input')

    return {
      ...(part.mimeType ? { mime_type: part.mimeType } : {}),
      ...(toResolution(part.detail) ? { resolution: toResolution(part.detail) } : {}),
      type: 'image',
      uri: part.url,
    } as Interactions.Content
  }

  assertGsUri(part.url, 'Google file input')

  const mimeType = part.mimeType?.trim().toLowerCase()
  const filename = part.filename?.toLowerCase() ?? part.url.toLowerCase()

  if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
    return {
      mime_type: 'application/pdf',
      type: 'document',
      uri: part.url,
    } as Interactions.Content
  }

  if (mimeType?.startsWith('audio/')) {
    return {
      mime_type: mimeType,
      type: 'audio',
      uri: part.url,
    } as Interactions.Content
  }

  if (mimeType?.startsWith('video/')) {
    return {
      mime_type: mimeType,
      type: 'video',
      uri: part.url,
    } as Interactions.Content
  }

  throw new DomainErrorException({
    message:
      'Google file inputs in the Interactions adapter currently support PDFs, audio, and video only',
    type: 'validation',
  })
}

const toThoughtStep = (
  part: Extract<GoogleReplayPart, { type: 'reasoning' } | { type: 'text' }>,
): Interactions.ThoughtStep => {
  if (part.type === 'text') {
    return {
      ...(resolveProviderSignature(part) ? { signature: resolveProviderSignature(part) } : {}),
      summary: [
        {
          text: part.text,
          type: 'text',
        },
      ],
      type: 'thought',
    }
  }

  return {
    ...(resolveProviderSignature(part) ? { signature: resolveProviderSignature(part) } : {}),
    ...(toReasoningSummary(part) ? { summary: toReasoningSummary(part) } : {}),
    type: 'thought',
  }
}

const toFunctionCallStep = (part: AiFunctionCallContent): Interactions.FunctionCallStep => ({
  arguments: toJsonSchemaObject(part.argumentsJson, `Function call "${part.name}" arguments`) ?? {},
  id: part.callId,
  name: part.name,
  type: 'function_call',
})

const toFunctionResultStep = (part: AiFunctionResultContent): Interactions.FunctionResultStep => ({
  call_id: part.callId,
  ...(part.isError !== undefined ? { is_error: part.isError } : {}),
  name: part.name,
  result: toFunctionResultValue(part) as Interactions.FunctionResultStep['result'],
  type: 'function_result',
})

const buildSystemInstruction = (
  messages: ResolvedAiInteractionRequest['messages'],
): string | undefined => {
  const parts: string[] = []

  for (const message of messages) {
    if (message.role !== 'system' && message.role !== 'developer') {
      continue
    }

    for (const part of message.content) {
      if (part.type !== 'text') {
        throw new DomainErrorException({
          message: 'Google system and developer messages currently support text only',
          type: 'validation',
        })
      }

      parts.push(part.text)
    }
  }

  const text = parts.join('\n\n').trim()

  return text.length > 0 ? text : undefined
}

const isAssistantReplayPart = (part: GoogleReplayPart): boolean =>
  part.type === 'function_call' ||
  part.type === 'reasoning' ||
  (part.type === 'text' && part.thought === true)

const isToolReplayPart = (part: GoogleReplayPart): part is AiFunctionResultContent =>
  part.type === 'function_result'

const isAssistantReplayMessage = (message: GoogleReplayMessage): boolean =>
  message.role === 'assistant' &&
  message.content.length > 0 &&
  message.content.every((part) => isAssistantReplayPart(part))

const isToolReplayMessage = (message: GoogleReplayMessage): boolean =>
  message.role === 'tool' &&
  message.content.length > 0 &&
  message.content.every((part) => isToolReplayPart(part))

const canMergeReplayMessages = (
  previous: GoogleReplayMessage,
  next: GoogleReplayMessage,
): boolean => {
  if (previous.role === 'assistant' && next.role === 'assistant') {
    return isAssistantReplayMessage(previous) && isAssistantReplayMessage(next)
  }

  if (previous.role === 'tool' && next.role === 'tool') {
    return isToolReplayMessage(previous) && isToolReplayMessage(next)
  }

  return false
}

const mergeReplayMessagesForGoogle = (
  messages: ResolvedAiInteractionRequest['messages'],
): GoogleReplayMessage[] => {
  const merged: GoogleReplayMessage[] = []

  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') {
      continue
    }

    const previous = merged.at(-1)

    if (previous && canMergeReplayMessages(previous, message)) {
      previous.content.push(...message.content)
      continue
    }

    merged.push({
      ...message,
      content: [...message.content],
    })
  }

  return merged
}

export const buildInputForRequest = (
  messages: ResolvedAiInteractionRequest['messages'],
): Interactions.Step[] => {
  const steps: Interactions.Step[] = []

  for (const message of mergeReplayMessagesForGoogle(messages)) {
    const isAssistant = message.role === 'assistant'
    const pendingContent: Interactions.Content[] = []

    const flushPendingContent = (): void => {
      if (pendingContent.length === 0) {
        return
      }

      const content = pendingContent.splice(0, pendingContent.length)

      steps.push(isAssistant ? { content, type: 'model_output' } : { content, type: 'user_input' })
    }

    for (const part of message.content) {
      switch (part.type) {
        case 'text':
          if (isAssistant && part.thought === true) {
            flushPendingContent()
            steps.push(toThoughtStep(part))
            continue
          }

          pendingContent.push({
            text: part.text,
            type: 'text',
          })
          continue
        case 'function_call':
          if (!isAssistant) {
            throw new DomainErrorException({
              message: 'Function calls must be emitted by assistant messages',
              type: 'validation',
            })
          }

          flushPendingContent()
          steps.push(toFunctionCallStep(part))
          continue
        case 'function_result':
          flushPendingContent()
          steps.push(toFunctionResultStep(part))
          continue
        case 'file_url':
        case 'image_url':
          pendingContent.push(toMediaContent(part))
          continue
        case 'file_id':
        case 'image_file':
          throw new DomainErrorException({
            message: `Google Interactions adapter does not support ${part.type} inputs yet`,
            type: 'validation',
          })
        case 'reasoning':
          flushPendingContent()
          steps.push(toThoughtStep(part))
          continue
      }
    }

    flushPendingContent()
  }

  return steps
}

export const buildContentsForRequest = buildInputForRequest

const sanitizeSchemaNode = (node: unknown): unknown => {
  if (Array.isArray(node)) {
    return node.map(sanitizeSchemaNode)
  }

  if (node === null || typeof node !== 'object') {
    return node
  }

  const src = node as Record<string, unknown>

  if (typeof src.$ref === 'string' && typeof src.$defs === 'undefined') {
    return { type: 'object' }
  }

  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(src)) {
    if (
      key === '$ref' ||
      key === '$defs' ||
      key === '$schema' ||
      key === '$id' ||
      key === '$comment' ||
      key === 'oneOf' ||
      key === 'anyOf' ||
      key === 'allOf' ||
      key === 'not' ||
      key === 'if' ||
      key === 'then' ||
      key === 'else' ||
      key === 'dependentSchemas' ||
      key === 'dependentRequired' ||
      key === 'patternProperties' ||
      key === 'unevaluatedProperties' ||
      key === 'unevaluatedItems' ||
      key === 'contentMediaType' ||
      key === 'contentEncoding' ||
      key === 'const' ||
      key === 'examples' ||
      key === 'default'
    ) {
      continue
    }

    out[key] = sanitizeSchemaNode(value)
  }

  return out
}

const sanitizeToolSchema = (
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!schema) {
    return undefined
  }

  const sanitized = sanitizeSchemaNode(schema) as Record<string, unknown>

  if (!sanitized.type) {
    sanitized.type = 'object'
  }

  return sanitized
}

const buildFunctionTools = (tools: AiToolDefinition[] | undefined): Interactions.Tool[] => {
  if (!tools?.length) {
    return []
  }

  return tools.map((tool) => ({
    description: tool.description,
    name: tool.name,
    parameters: sanitizeToolSchema(tool.parameters),
    type: 'function',
  }))
}

const buildNativeTools = (
  nativeTools: AiProviderNativeToolName[] | undefined,
): Interactions.Tool[] => {
  if (!nativeTools?.includes('web_search')) {
    return []
  }

  return [
    {
      search_types: ['web_search'],
      type: 'google_search',
    },
  ]
}

const buildTools = (
  tools: AiToolDefinition[] | undefined,
  nativeTools: AiProviderNativeToolName[] | undefined,
): Interactions.Tool[] | undefined => {
  const resolvedTools = [...buildFunctionTools(tools), ...buildNativeTools(nativeTools)]

  return resolvedTools.length > 0 ? resolvedTools : undefined
}

const buildToolChoice = (
  tools: AiToolDefinition[] | undefined,
  toolChoice: AiToolChoice | undefined,
): Interactions.GenerationConfig['tool_choice'] | undefined => {
  if (!tools?.length || !toolChoice) {
    return undefined
  }

  if (toolChoice === 'auto') {
    return 'auto'
  }

  if (toolChoice === 'none') {
    return 'none'
  }

  if (toolChoice === 'required') {
    return 'any'
  }

  return {
    allowed_tools: {
      mode: 'any',
      tools: [toolChoice.name],
    },
  }
}

const mapServiceTier = (
  serviceTier: AiServiceTier | undefined,
): Interactions.Interaction['service_tier'] | undefined => {
  switch (serviceTier) {
    case 'auto':
      return undefined
    case 'default':
    case 'scale':
      return 'standard'
    case 'flex':
      return 'flex'
    case 'priority':
      return 'priority'
  }
}

const toThinkingLevel = (
  effort: AiReasoningEffort,
): Interactions.GenerationConfig['thinking_level'] | undefined => {
  switch (effort) {
    case 'none':
    case 'minimal':
      return 'minimal'
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
    case 'xhigh':
      return 'high'
    default:
      return undefined
  }
}

export const buildConfig = (
  request: ResolvedAiInteractionRequest,
  _config: GoogleRequestConfig,
): Interactions.GenerationConfig => ({
  max_output_tokens: request.maxOutputTokens,
  stop_sequences: request.stopSequences,
  temperature: request.temperature,
  thinking_level: request.reasoning ? toThinkingLevel(request.reasoning.effort) : undefined,
  thinking_summaries:
    request.reasoning?.effort === 'none' ? 'none' : request.reasoning ? 'auto' : undefined,
  tool_choice: buildToolChoice(request.tools, request.toolChoice),
  top_p: request.topP,
})

export const buildRequestOptions = (
  request: ResolvedAiInteractionRequest,
  config: GoogleRequestConfig,
): {
  maxRetries: number
  signal?: AbortSignal
  timeout: number
} => ({
  // The 2.x SDK request options no longer accept an idempotency key.
  ...(request.abortSignal ? { signal: request.abortSignal } : {}),
  maxRetries: request.maxRetries ?? config.maxRetries,
  timeout: request.timeoutMs ?? config.defaultHttpTimeoutMs,
})

export const buildCreateInteractionParams = (
  request: ResolvedAiInteractionRequest,
  config: GoogleRequestConfig,
  stream: boolean,
):
  | Interactions.CreateModelInteractionParamsNonStreaming
  | Interactions.CreateModelInteractionParamsStreaming => ({
  ...(request.executionMode === 'background' ? { background: true, store: true } : {}),
  generation_config: buildConfig(request, config),
  input: buildInputForRequest(request.messages),
  model: request.model,
  ...(request.responseFormat?.type === 'json_schema'
    ? {
        response_format: {
          mime_type: 'application/json' as const,
          schema: request.responseFormat.schema,
          type: 'text' as const,
        },
      }
    : {}),
  ...(mapServiceTier(request.serviceTier)
    ? { service_tier: mapServiceTier(request.serviceTier) }
    : {}),
  ...(buildSystemInstruction(request.messages)
    ? { system_instruction: buildSystemInstruction(request.messages) }
    : {}),
  ...(buildTools(request.tools, request.nativeTools)
    ? { tools: buildTools(request.tools, request.nativeTools) }
    : {}),
  stream,
})

export const ensureGoogleCompatibleRequest = (request: ResolvedAiInteractionRequest): void => {
  const googleOptions =
    typeof request.vendorOptions?.google === 'object' && request.vendorOptions.google !== null
      ? (request.vendorOptions.google as Record<string, unknown>)
      : null

  if (request.vendorOptions?.google?.cachedContent) {
    throw new DomainErrorException({
      message: 'Google Interactions adapter does not support cachedContent',
      type: 'validation',
    })
  }

  if (googleOptions && 'previousInteractionId' in googleOptions) {
    throw new DomainErrorException({
      message:
        'Google Interactions adapter forbids previousInteractionId; full durable replay is required',
      type: 'validation',
    })
  }
}
