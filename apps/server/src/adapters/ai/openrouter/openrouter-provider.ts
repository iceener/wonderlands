import { OpenRouter } from '@openrouter/sdk'
import type {
  OutputFunctionCallItem,
  OutputItems,
  OutputWebSearchCallItem,
} from '@openrouter/sdk/models'

import { tryParseJson } from '../../../domain/ai/json-utils'
import type { AiProvider } from '../../../domain/ai/provider'
import type {
  AiCancelResult,
  AiInteractionResponse,
  AiOutputItem,
  AiProviderName,
  AiStreamEvent,
  AiToolCall,
  AiWebSearchActivity,
} from '../../../domain/ai/types'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { toOpenRouterDomainError } from './openrouter-domain-error'
import {
  createRequestBody,
  createRequestOptions,
  type OpenRouterRequestConfig,
} from './openrouter-request'
import {
  createOpenRouterWebSearchActivity,
  mergeOpenRouterWebSearchActivity,
  normalizeResponse,
  normalizeToolCall,
  OPENROUTER_PROVIDER_NAME,
  updateOpenRouterWebSearchActivityStatus,
} from './openrouter-response'

export interface OpenRouterProviderConfig extends OpenRouterRequestConfig {
  apiKey: string | null
  baseUrl: string | null
}

const notConfiguredError = (): Result<never, DomainError> =>
  err({
    message: 'OpenRouter provider is not configured',
    provider: 'openrouter',
    type: 'provider',
  })

const readNormalizedResponseErrorMessage = (
  response: AiInteractionResponse,
  fallback: string,
): string => {
  const raw =
    typeof response.raw === 'object' && response.raw !== null
      ? (response.raw as {
          error?: {
            message?: string | null
          } | null
        })
      : null

  return raw?.error?.message?.trim() || fallback
}

const getToolCallKey = (toolCall: AiToolCall): string => toolCall.providerItemId ?? toolCall.callId

const getResponseOutputCallIds = (response: AiInteractionResponse): Set<string> =>
  new Set(
    response.output
      .filter(
        (item): item is Extract<AiOutputItem, { type: 'function_call' }> =>
          item.type === 'function_call',
      )
      .map((item) => item.providerItemId ?? item.callId),
  )

const getResponseWebSearchIds = (response: AiInteractionResponse): Set<string> =>
  new Set(response.webSearches.map((activity) => activity.id))

const backfillOpenRouterStreamArtifacts = (
  response: AiInteractionResponse,
  accumulatedToolCalls: Map<string, AiToolCall>,
  accumulatedWebSearches: Map<string, AiWebSearchActivity>,
): AiInteractionResponse => {
  let nextOutput = response.output
  let nextToolCalls = response.toolCalls
  let nextWebSearches = response.webSearches

  if (accumulatedToolCalls.size > 0) {
    const mergedToolCalls = new Map<string, AiToolCall>()

    for (const toolCall of accumulatedToolCalls.values()) {
      mergedToolCalls.set(getToolCallKey(toolCall), toolCall)
    }

    for (const toolCall of response.toolCalls) {
      mergedToolCalls.set(getToolCallKey(toolCall), toolCall)
    }

    if (mergedToolCalls.size !== response.toolCalls.length) {
      nextToolCalls = [...mergedToolCalls.values()]

      const existingOutputCallIds = getResponseOutputCallIds(response)
      const missingOutputItems = nextToolCalls
        .filter((toolCall) => !existingOutputCallIds.has(getToolCallKey(toolCall)))
        .map((toolCall) => ({
          ...toolCall,
          type: 'function_call' as const,
        }))

      if (missingOutputItems.length > 0) {
        const firstMessageIndex = response.output.findIndex((item) => item.type === 'message')

        nextOutput =
          firstMessageIndex === -1
            ? [...response.output, ...missingOutputItems]
            : [
                ...response.output.slice(0, firstMessageIndex),
                ...missingOutputItems,
                ...response.output.slice(firstMessageIndex),
              ]
      }
    }
  }

  if (accumulatedWebSearches.size > 0) {
    const mergedWebSearches = new Map<string, AiWebSearchActivity>()

    for (const activity of accumulatedWebSearches.values()) {
      mergedWebSearches.set(activity.id, activity)
    }

    for (const activity of response.webSearches) {
      mergedWebSearches.set(activity.id, activity)
    }

    if (mergedWebSearches.size !== response.webSearches.length) {
      const existingResponseIds = getResponseWebSearchIds(response)
      const merged = [...mergedWebSearches.values()]

      if (existingResponseIds.size === response.webSearches.length) {
        nextWebSearches = merged
      }
    }
  }

  if (
    nextOutput === response.output &&
    nextToolCalls === response.toolCalls &&
    nextWebSearches === response.webSearches
  ) {
    return response
  }

  return {
    ...response,
    output: nextOutput,
    toolCalls: nextToolCalls,
    webSearches: nextWebSearches,
  }
}

const toProviderName = (): AiProviderName => OPENROUTER_PROVIDER_NAME

const isOutputFunctionCallItem = (item: OutputItems): item is OutputFunctionCallItem =>
  item.type === 'function_call' &&
  'callId' in item &&
  typeof item.callId === 'string' &&
  'arguments' in item &&
  typeof item.arguments === 'string' &&
  'name' in item &&
  typeof item.name === 'string'

const isOutputWebSearchCallItem = (item: OutputItems): item is OutputWebSearchCallItem =>
  item.type === 'web_search_call' &&
  'id' in item &&
  typeof item.id === 'string' &&
  'action' in item &&
  typeof item.action === 'object' &&
  item.action !== null

const getReasoningTextParts = (
  summaries: Map<string, Map<number, string>>,
  itemId: string,
): Map<number, string> => {
  const existing = summaries.get(itemId)

  if (existing) {
    return existing
  }

  const next = new Map<number, string>()
  summaries.set(itemId, next)
  return next
}

const flattenReasoningTextParts = (parts: Map<number, string>): string =>
  [...parts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, text]) => text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n')
    .trim()

const toMinimalWebSearchActivity = (
  itemId: string,
  responseId: string | null,
): AiWebSearchActivity =>
  createOpenRouterWebSearchActivity({
    id: itemId,
    responseId,
    status: 'in_progress',
  })

const isIgnoredOpenRouterOutputItemType = (type: string): boolean =>
  type === 'message' || type === 'reasoning'

export const createOpenRouterProvider = (config: OpenRouterProviderConfig): AiProvider => {
  const configured = Boolean(config.apiKey)
  const client =
    configured && config.apiKey
      ? new OpenRouter({
          apiKey: config.apiKey,
          appCategories: config.appCategories ?? undefined,
          appTitle: config.appTitle ?? undefined,
          httpReferer: config.httpReferer ?? undefined,
          serverURL: config.baseUrl ?? undefined,
          timeoutMs: config.timeoutMs,
        })
      : null

  return {
    cancel: async (request): Promise<Result<AiCancelResult, DomainError>> => {
      if (!client) {
        return notConfiguredError()
      }

      return ok({
        provider: toProviderName(),
        responseId: request.responseId,
        status: 'client_abort_only',
      })
    },
    configured,
    generate: async (request): Promise<Result<AiInteractionResponse, DomainError>> => {
      if (!client) {
        return notConfiguredError()
      }

      try {
        const response = await client.beta.responses.send(
          createRequestBody(request, config, false),
          createRequestOptions(request, config),
        )
        const normalizedResponse = normalizeResponse(response, null)

        if (normalizedResponse.status !== 'completed') {
          return err({
            message: readNormalizedResponseErrorMessage(
              normalizedResponse,
              `OpenRouter response completed with status ${normalizedResponse.status}`,
            ),
            provider: OPENROUTER_PROVIDER_NAME,
            type: 'provider',
          })
        }

        return ok(normalizedResponse)
      } catch (error) {
        return err(toOpenRouterDomainError(error))
      }
    },
    name: toProviderName(),
    stream: async (request) => {
      if (!client) {
        return notConfiguredError()
      }

      try {
        const responseStream = await client.beta.responses.send(
          createRequestBody(request, config, true),
          createRequestOptions(request, config),
        )

        return ok(
          (async function* (): AsyncGenerator<AiStreamEvent> {
            let hasStarted = false
            let lastResponseId: string | null = null
            const accumulatedToolCalls = new Map<string, AiToolCall>()
            const emittedToolCallKeys = new Set<string>()
            const accumulatedWebSearches = new Map<string, AiWebSearchActivity>()
            const reasoningSummaryParts = new Map<string, Map<number, string>>()
            const reasoningTextParts = new Map<string, Map<number, string>>()
            const unsupportedStreamEventTypes = new Set<string>()
            const unsupportedStreamItemTypes = new Set<string>()

            const normalizeTerminalResponse = (
              response: Parameters<typeof normalizeResponse>[0],
            ): AiInteractionResponse =>
              normalizeResponse(response, null, {
                adapterIssues: {
                  unsupportedStreamEventTypes,
                  unsupportedStreamItemTypes,
                },
              })

            const emitStartedIfNeeded = (
              model: string,
              responseId: string | null,
            ): AiStreamEvent | null => {
              lastResponseId = responseId

              if (hasStarted) {
                return null
              }

              hasStarted = true

              return {
                model,
                provider: toProviderName(),
                responseId,
                type: 'response.started',
              }
            }

            const upsertToolCall = (toolCall: AiToolCall): void => {
              accumulatedToolCalls.set(getToolCallKey(toolCall), toolCall)
            }

            const emitToolCallIfNeeded = (toolCall: AiToolCall): AiStreamEvent | null => {
              const key = getToolCallKey(toolCall)

              if (emittedToolCallKeys.has(key)) {
                return null
              }

              emittedToolCallKeys.add(key)
              return {
                call: toolCall,
                type: 'tool.call',
              }
            }

            const upsertWebSearch = (activity: AiWebSearchActivity): void => {
              accumulatedWebSearches.set(activity.id, activity)
            }

            const handleOutputItemEvent = (
              item: OutputItems,
              phase: 'added' | 'done',
            ): AiStreamEvent | null => {
              if (isIgnoredOpenRouterOutputItemType(item.type)) {
                return null
              }

              if (isOutputFunctionCallItem(item)) {
                const toolCall = normalizeToolCall(item)
                upsertToolCall(toolCall)

                if (phase === 'done') {
                  return emitToolCallIfNeeded(toolCall)
                }

                return null
              }

              if (isOutputWebSearchCallItem(item)) {
                const nextActivity = mergeOpenRouterWebSearchActivity(
                  accumulatedWebSearches.get(item.id) ?? null,
                  item,
                  lastResponseId,
                )
                upsertWebSearch(nextActivity)
                return {
                  activity: nextActivity,
                  type: 'web_search',
                }
              }

              unsupportedStreamItemTypes.add(item.type)
              return null
            }

            for await (const event of responseStream) {
              switch (event.type) {
                case 'response.created':
                case 'response.in_progress': {
                  const startedEvent = emitStartedIfNeeded(event.response.model, event.response.id)

                  if (startedEvent) {
                    yield startedEvent
                  }
                  break
                }

                case 'error':
                  throw new Error(event.message)

                case 'response.output_item.added': {
                  const nextEvent = handleOutputItemEvent(event.item, 'added')

                  if (nextEvent) {
                    yield nextEvent
                  }
                  break
                }

                case 'response.output_item.done': {
                  const nextEvent = handleOutputItemEvent(event.item, 'done')

                  if (nextEvent) {
                    yield nextEvent
                  }
                  break
                }

                case 'response.output_text.delta':
                  yield {
                    delta: event.delta,
                    type: 'text.delta',
                  }
                  break

                case 'response.output_text.done':
                  break

                case 'response.reasoning_summary_text.delta': {
                  const parts = getReasoningTextParts(reasoningSummaryParts, event.itemId)
                  parts.set(
                    event.summaryIndex,
                    `${parts.get(event.summaryIndex) ?? ''}${event.delta}`,
                  )
                  yield {
                    delta: event.delta,
                    itemId: event.itemId,
                    text: flattenReasoningTextParts(parts),
                    type: 'reasoning.summary.delta',
                  }
                  break
                }

                case 'response.reasoning_summary_text.done': {
                  const parts = getReasoningTextParts(reasoningSummaryParts, event.itemId)
                  parts.set(event.summaryIndex, event.text)
                  yield {
                    itemId: event.itemId,
                    text: flattenReasoningTextParts(parts),
                    type: 'reasoning.summary.done',
                  }
                  break
                }

                case 'response.reasoning_summary_part.added':
                case 'response.reasoning_summary_part.done':
                  break

                case 'response.reasoning_text.delta': {
                  const parts = getReasoningTextParts(reasoningTextParts, event.itemId)
                  parts.set(
                    event.contentIndex,
                    `${parts.get(event.contentIndex) ?? ''}${event.delta}`,
                  )
                  yield {
                    delta: event.delta,
                    itemId: event.itemId,
                    text: flattenReasoningTextParts(parts),
                    type: 'reasoning.summary.delta',
                  }
                  break
                }

                case 'response.reasoning_text.done': {
                  const parts = getReasoningTextParts(reasoningTextParts, event.itemId)
                  parts.set(event.contentIndex, event.text)
                  yield {
                    itemId: event.itemId,
                    text: flattenReasoningTextParts(parts),
                    type: 'reasoning.summary.done',
                  }
                  break
                }

                case 'response.refusal.delta':
                  yield {
                    delta: event.delta,
                    type: 'text.delta',
                  }
                  break

                case 'response.refusal.done':
                  break

                case 'response.output_text.annotation.added': {
                  const annotationType =
                    event.annotation &&
                    typeof event.annotation === 'object' &&
                    'type' in event.annotation &&
                    typeof event.annotation.type === 'string'
                      ? event.annotation.type
                      : 'unknown'

                  if (annotationType !== 'url_citation') {
                    unsupportedStreamEventTypes.add(
                      `response.output_text.annotation.added:${annotationType}`,
                    )
                  }
                  break
                }

                case 'response.content_part.added':
                case 'response.content_part.done':
                  break

                case 'response.function_call_arguments.delta':
                  break

                case 'response.function_call_arguments.done': {
                  const existing = accumulatedToolCalls.get(event.itemId) ?? null
                  const nextToolCall: AiToolCall = {
                    arguments: tryParseJson(event.arguments),
                    argumentsJson: event.arguments,
                    callId: existing?.callId ?? event.itemId,
                    name: existing?.name ?? event.name,
                    providerItemId: event.itemId,
                  }
                  upsertToolCall(nextToolCall)
                  const toolCallEvent = emitToolCallIfNeeded(nextToolCall)

                  if (toolCallEvent) {
                    yield toolCallEvent
                  }
                  break
                }

                case 'response.web_search_call.in_progress':
                case 'response.web_search_call.searching':
                case 'response.web_search_call.completed': {
                  const status =
                    event.type === 'response.web_search_call.in_progress'
                      ? 'in_progress'
                      : event.type === 'response.web_search_call.searching'
                        ? 'searching'
                        : 'completed'
                  const nextActivity = updateOpenRouterWebSearchActivityStatus(
                    accumulatedWebSearches.get(event.itemId) ??
                      toMinimalWebSearchActivity(event.itemId, lastResponseId),
                    {
                      id: event.itemId,
                      responseId: lastResponseId,
                      status,
                    },
                  )
                  upsertWebSearch(nextActivity)
                  yield {
                    activity: nextActivity,
                    type: 'web_search',
                  }
                  break
                }

                case 'response.completed':
                case 'response.incomplete':
                case 'response.failed': {
                  const startedEvent = emitStartedIfNeeded(event.response.model, event.response.id)

                  if (startedEvent) {
                    yield startedEvent
                  }

                  const normalized = backfillOpenRouterStreamArtifacts(
                    normalizeTerminalResponse(event.response),
                    accumulatedToolCalls,
                    accumulatedWebSearches,
                  )

                  for (const outputItem of normalized.output) {
                    if (outputItem.type !== 'reasoning' || typeof outputItem.text !== 'string') {
                      continue
                    }

                    yield {
                      itemId: outputItem.id,
                      text: outputItem.text,
                      type: 'reasoning.summary.done',
                    }
                  }

                  yield {
                    response: normalized,
                    type: 'response.completed',
                  }
                  break
                }

                default:
                  unsupportedStreamEventTypes.add(event.type)
                  break
              }
            }
          })(),
        )
      } catch (error) {
        return err(toOpenRouterDomainError(error))
      }
    },
  }
}
