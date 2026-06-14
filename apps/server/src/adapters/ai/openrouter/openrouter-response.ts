import type {
  OpenAIResponsesResponseStatus,
  OpenResponsesResult,
  OutputFunctionCallItem,
  OutputItems,
  OutputMessageItem,
  OutputReasoningItem,
  OutputWebSearchCallItem,
  URLCitation,
  Usage,
  WebSearchStatus,
} from '@openrouter/sdk/models'
import { tryParseJson } from '../../../domain/ai/json-utils'
import { flattenReasoningSummaryText } from '../../../domain/ai/reasoning-summary'
import type {
  AiInteractionResponse,
  AiMessage,
  AiOutputItem,
  AiProviderName,
  AiToolCall,
  AiUsage,
  AiWebReference,
  AiWebSearchActivity,
} from '../../../domain/ai/types'
import {
  dedupeStrings,
  dedupeWebReferences,
  mergeWebSearchStatus,
  toDomainFromUrl,
} from '../response-utils'

interface OpenRouterAdapterIssueInput {
  unsupportedMessageAnnotationTypes?: Iterable<string>
  unsupportedMessageContentTypes?: Iterable<string>
  unsupportedOutputItemTypes?: Iterable<string>
  unsupportedStreamEventTypes?: Iterable<string>
  unsupportedStreamItemTypes?: Iterable<string>
}

interface NormalizeOpenRouterResponseOptions {
  adapterIssues?: OpenRouterAdapterIssueInput
}

interface OpenRouterAdapterIssue {
  code: 'unsupported_response_semantics'
  message: string
  status: 'failed'
  unsupportedMessageAnnotationTypes?: string[]
  unsupportedMessageContentTypes?: string[]
  unsupportedOutputItemTypes?: string[]
  unsupportedStreamEventTypes?: string[]
  unsupportedStreamItemTypes?: string[]
}

export const OPENROUTER_PROVIDER_NAME = 'openrouter' as AiProviderName

const createIssueSet = (values?: Iterable<string>): Set<string> =>
  new Set([...(values ?? [])].map((value) => value.trim()).filter((value) => value.length > 0))

const toSortedIssueList = (values: Set<string>): string[] | undefined => {
  if (values.size === 0) {
    return undefined
  }

  return [...values].sort()
}

const getTypeName = (value: unknown): string =>
  typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
    ? value.type
    : 'unknown'

const isOutputMessageItem = (item: OutputItems): item is OutputMessageItem =>
  item.type === 'message' && 'content' in item && Array.isArray(item.content)

const isOutputFunctionCallItem = (item: OutputItems): item is OutputFunctionCallItem =>
  item.type === 'function_call' &&
  'callId' in item &&
  typeof item.callId === 'string' &&
  'arguments' in item &&
  typeof item.arguments === 'string' &&
  'name' in item &&
  typeof item.name === 'string'

const isOutputReasoningItem = (item: OutputItems): item is OutputReasoningItem =>
  item.type === 'reasoning' &&
  'id' in item &&
  typeof item.id === 'string' &&
  'summary' in item &&
  Array.isArray(item.summary)

const isOutputWebSearchCallItem = (item: OutputItems): item is OutputWebSearchCallItem =>
  item.type === 'web_search_call' &&
  'id' in item &&
  typeof item.id === 'string' &&
  'action' in item &&
  typeof item.action === 'object' &&
  item.action !== null

const isUrlCitation = (annotation: unknown): annotation is URLCitation =>
  typeof annotation === 'object' &&
  annotation !== null &&
  'type' in annotation &&
  annotation.type === 'url_citation' &&
  'url' in annotation &&
  typeof annotation.url === 'string' &&
  'title' in annotation &&
  typeof annotation.title === 'string'

const createAdapterIssue = (
  response: OpenResponsesResult,
  input: OpenRouterAdapterIssueInput = {},
): OpenRouterAdapterIssue | null => {
  const unsupportedOutputItemTypes = createIssueSet(input.unsupportedOutputItemTypes)
  const unsupportedMessageContentTypes = createIssueSet(input.unsupportedMessageContentTypes)
  const unsupportedMessageAnnotationTypes = createIssueSet(input.unsupportedMessageAnnotationTypes)
  const unsupportedStreamEventTypes = createIssueSet(input.unsupportedStreamEventTypes)
  const unsupportedStreamItemTypes = createIssueSet(input.unsupportedStreamItemTypes)

  for (const item of response.output) {
    if (isOutputMessageItem(item)) {
      for (const part of item.content) {
        if (part.type === 'output_text') {
          for (const annotation of part.annotations ?? []) {
            if (!isUrlCitation(annotation)) {
              unsupportedMessageAnnotationTypes.add(getTypeName(annotation))
            }
          }
          continue
        }

        if (part.type !== 'refusal') {
          unsupportedMessageContentTypes.add(getTypeName(part))
        }
      }

      continue
    }

    if (
      isOutputFunctionCallItem(item) ||
      isOutputReasoningItem(item) ||
      isOutputWebSearchCallItem(item)
    ) {
      continue
    }

    unsupportedOutputItemTypes.add(item.type)
  }

  const issueLists = {
    unsupportedMessageAnnotationTypes: toSortedIssueList(unsupportedMessageAnnotationTypes),
    unsupportedMessageContentTypes: toSortedIssueList(unsupportedMessageContentTypes),
    unsupportedOutputItemTypes: toSortedIssueList(unsupportedOutputItemTypes),
    unsupportedStreamEventTypes: toSortedIssueList(unsupportedStreamEventTypes),
    unsupportedStreamItemTypes: toSortedIssueList(unsupportedStreamItemTypes),
  }

  const summaries = [
    issueLists.unsupportedOutputItemTypes
      ? `output items: ${issueLists.unsupportedOutputItemTypes.join(', ')}`
      : null,
    issueLists.unsupportedMessageContentTypes
      ? `message content parts: ${issueLists.unsupportedMessageContentTypes.join(', ')}`
      : null,
    issueLists.unsupportedMessageAnnotationTypes
      ? `message annotations: ${issueLists.unsupportedMessageAnnotationTypes.join(', ')}`
      : null,
    issueLists.unsupportedStreamEventTypes
      ? `stream events: ${issueLists.unsupportedStreamEventTypes.join(', ')}`
      : null,
    issueLists.unsupportedStreamItemTypes
      ? `stream output items: ${issueLists.unsupportedStreamItemTypes.join(', ')}`
      : null,
  ].filter((value): value is string => value !== null)

  if (summaries.length === 0) {
    return null
  }

  return {
    code: 'unsupported_response_semantics',
    message: `OpenRouter Responses adapter does not support response semantics for ${summaries.join('; ')}`,
    status: 'failed',
    ...issueLists,
  }
}

export const normalizeToolCall = (toolCall: OutputFunctionCallItem): AiToolCall => ({
  arguments: tryParseJson(toolCall.arguments),
  argumentsJson: toolCall.arguments,
  callId: toolCall.callId,
  name: toolCall.name,
  ...(toolCall.id ? { providerItemId: toolCall.id } : {}),
})

const normalizeWebSearchStatus = (status: WebSearchStatus): AiWebSearchActivity['status'] => {
  switch (status) {
    case 'in_progress':
      return 'in_progress'
    case 'searching':
      return 'searching'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    default:
      return 'completed'
  }
}

const normalizeResponseStatus = (
  status: OpenAIResponsesResponseStatus,
  response: OpenResponsesResult,
): AiInteractionResponse['status'] => {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'in_progress':
      return 'in_progress'
    case 'failed':
      return 'failed'
    case 'incomplete':
      return 'incomplete'
    case 'cancelled':
      return 'cancelled'
    case 'queued':
      return 'queued'
    default:
      return response.error ? 'failed' : 'completed'
  }
}

const toUrlCitationReference = (annotation: URLCitation): AiWebReference => ({
  domain: toDomainFromUrl(annotation.url),
  title: annotation.title,
  url: annotation.url,
})

const collectOutputTextReferences = (messages: OutputMessageItem[]): AiWebReference[] => {
  const references: AiWebReference[] = []

  for (const item of messages) {
    for (const part of item.content) {
      if (part.type !== 'output_text') {
        continue
      }

      for (const annotation of part.annotations ?? []) {
        if (isUrlCitation(annotation)) {
          references.push(toUrlCitationReference(annotation))
        }
      }
    }
  }

  return dedupeWebReferences(references)
}

const toWebSearchSourceReferences = (item: OutputWebSearchCallItem): AiWebReference[] => {
  if (item.action.type !== 'search' || !item.action.sources) {
    return []
  }

  return dedupeWebReferences(
    item.action.sources.map((source) => ({
      domain: toDomainFromUrl(source.url),
      title: null,
      url: source.url,
    })),
  )
}

export const createOpenRouterWebSearchActivity = (input: {
  id: string
  responseId: string | null
  status: AiWebSearchActivity['status']
}): AiWebSearchActivity => ({
  id: input.id,
  patterns: [],
  provider: OPENROUTER_PROVIDER_NAME,
  queries: [],
  references: [],
  responseId: input.responseId,
  status: input.status,
  targetUrls: [],
})

export const updateOpenRouterWebSearchActivityStatus = (
  current: AiWebSearchActivity | null,
  input: {
    id: string
    responseId: string | null
    status: AiWebSearchActivity['status']
  },
): AiWebSearchActivity => ({
  ...(current ??
    createOpenRouterWebSearchActivity({
      id: input.id,
      responseId: input.responseId,
      status: input.status,
    })),
  responseId: current?.responseId ?? input.responseId,
  status: current ? mergeWebSearchStatus(current.status, input.status) : input.status,
})

export const mergeOpenRouterWebSearchActivity = (
  current: AiWebSearchActivity | null,
  item: OutputWebSearchCallItem,
  responseId: string | null,
): AiWebSearchActivity => {
  const nextBase =
    current ??
    createOpenRouterWebSearchActivity({
      id: item.id,
      responseId,
      status: normalizeWebSearchStatus(item.status),
    })

  const queries = [...nextBase.queries]
  const targetUrls = [...nextBase.targetUrls]
  const patterns = [...nextBase.patterns]

  if (item.action.type === 'search') {
    queries.push(...(item.action.queries ?? []))

    if (item.action.query.trim().length > 0) {
      queries.push(item.action.query)
    }
  }

  if (item.action.type === 'open_page' && typeof item.action.url === 'string') {
    targetUrls.push(item.action.url)
  }

  if (item.action.type === 'find_in_page') {
    if (item.action.pattern.trim().length > 0) {
      patterns.push(item.action.pattern)
    }

    if (item.action.url.trim().length > 0) {
      targetUrls.push(item.action.url)
    }
  }

  return {
    ...nextBase,
    patterns: dedupeStrings(patterns),
    queries: dedupeStrings(queries),
    references: dedupeWebReferences([...nextBase.references, ...toWebSearchSourceReferences(item)]),
    responseId,
    status: mergeWebSearchStatus(nextBase.status, normalizeWebSearchStatus(item.status)),
    targetUrls: dedupeStrings(targetUrls),
  }
}

const mapUsage = (usage: Usage | null | undefined): AiUsage | null => {
  if (!usage) {
    return null
  }

  return {
    cachedTokens: usage.inputTokensDetails.cachedTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.outputTokensDetails.reasoningTokens,
    totalTokens: usage.totalTokens,
  }
}

const normalizeOutputItems = (response: OpenResponsesResult): AiOutputItem[] => {
  const output: AiOutputItem[] = []

  for (const item of response.output) {
    if (isOutputMessageItem(item)) {
      const content: AiMessage['content'] = []

      for (const part of item.content) {
        if (part.type === 'output_text') {
          content.push({ text: part.text, type: 'text' })
          continue
        }

        content.push({ text: part.refusal, type: 'text' })
      }

      output.push({
        content,
        phase: item.phase ?? undefined,
        providerMessageId: item.id,
        role: 'assistant',
        type: 'message',
      })
      continue
    }

    if (isOutputFunctionCallItem(item)) {
      output.push({
        ...normalizeToolCall(item),
        type: 'function_call',
      })
      continue
    }

    if (isOutputReasoningItem(item)) {
      const text =
        flattenReasoningSummaryText(item.summary) ||
        (item.content ?? [])
          .flatMap((part) =>
            typeof part.text === 'string' && part.text.trim().length > 0 ? [part.text] : [],
          )
          .join('\n\n')
          .trim()

      output.push({
        encryptedContent: item.encryptedContent ?? null,
        id: item.id,
        summary: item.summary,
        ...(text.length > 0 ? { text } : {}),
        type: 'reasoning',
      })
    }
  }

  return output
}

const normalizeOutputText = (
  output: AiOutputItem[],
  responseOutputText: string | undefined,
): string => {
  if (typeof responseOutputText === 'string' && responseOutputText.trim().length > 0) {
    return responseOutputText
  }

  return output
    .flatMap((item) =>
      item.type === 'message'
        ? item.content.flatMap((part) => (part.type === 'text' ? [part.text] : []))
        : [],
    )
    .join('')
}

const normalizeMessages = (items: AiOutputItem[]): AiMessage[] =>
  items.flatMap((item) =>
    item.type === 'message'
      ? [
          {
            content: item.content,
            phase: item.phase,
            providerMessageId: item.providerMessageId,
            role: 'assistant' as const,
          },
        ]
      : [],
  )

const normalizeWebSearches = (response: OpenResponsesResult): AiWebSearchActivity[] => {
  const activitiesById = new Map<string, AiWebSearchActivity>()
  const messageItems: OutputMessageItem[] = []

  for (const item of response.output) {
    if (isOutputMessageItem(item)) {
      messageItems.push(item)
      continue
    }

    if (!isOutputWebSearchCallItem(item)) {
      continue
    }

    const current = activitiesById.get(item.id) ?? null
    activitiesById.set(item.id, mergeOpenRouterWebSearchActivity(current, item, response.id))
  }

  const activities = [...activitiesById.values()]
  const outputTextReferences = collectOutputTextReferences(messageItems)

  if (activities.length === 0) {
    return outputTextReferences.length > 0
      ? [
          {
            ...createOpenRouterWebSearchActivity({
              id: response.id ? `web_search:${response.id}` : 'web_search:openrouter',
              responseId: response.id,
              status: 'completed',
            }),
            references: outputTextReferences,
          },
        ]
      : []
  }

  if (outputTextReferences.length === 0) {
    return activities
  }

  const lastIndex = activities.length - 1

  return activities.map((activity, index) =>
    index === lastIndex
      ? {
          ...activity,
          references: dedupeWebReferences([...activity.references, ...outputTextReferences]),
        }
      : activity,
  )
}

export const normalizeResponse = (
  response: OpenResponsesResult,
  providerRequestId: string | null = null,
  options: NormalizeOpenRouterResponseOptions = {},
): AiInteractionResponse => {
  const adapterIssue = createAdapterIssue(response, options.adapterIssues)
  const output = normalizeOutputItems(response)
  const webSearches = normalizeWebSearches(response)

  return {
    messages: normalizeMessages(output),
    model: response.model,
    output,
    outputText: normalizeOutputText(output, response.outputText),
    provider: OPENROUTER_PROVIDER_NAME,
    providerRequestId,
    raw: adapterIssue
      ? {
          error: {
            code: adapterIssue.code,
            message: adapterIssue.message,
            status: response.status,
          },
          ...(adapterIssue.unsupportedMessageAnnotationTypes
            ? {
                unsupportedMessageAnnotationTypes: adapterIssue.unsupportedMessageAnnotationTypes,
              }
            : {}),
          ...(adapterIssue.unsupportedMessageContentTypes
            ? {
                unsupportedMessageContentTypes: adapterIssue.unsupportedMessageContentTypes,
              }
            : {}),
          ...(adapterIssue.unsupportedOutputItemTypes
            ? {
                unsupportedOutputItemTypes: adapterIssue.unsupportedOutputItemTypes,
              }
            : {}),
          ...(adapterIssue.unsupportedStreamEventTypes
            ? {
                unsupportedStreamEventTypes: adapterIssue.unsupportedStreamEventTypes,
              }
            : {}),
          ...(adapterIssue.unsupportedStreamItemTypes
            ? {
                unsupportedStreamItemTypes: adapterIssue.unsupportedStreamItemTypes,
              }
            : {}),
          response,
        }
      : response,
    responseId: response.id,
    status: adapterIssue?.status ?? normalizeResponseStatus(response.status, response),
    toolCalls: output.reduce<AiToolCall[]>((calls, item) => {
      if (item.type === 'function_call') {
        const { type: _type, ...toolCall } = item
        calls.push(toolCall)
      }

      return calls
    }, []),
    usage: mapUsage(response.usage),
    webSearches,
  }
}
