import OpenAI from 'openai'
import type {
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
} from 'openai/resources/responses/responses'
import type { AiProvider } from '../../../domain/ai/provider'
import type {
  AiCancelResult,
  AiInteractionResponse,
  ResolvedAiInteractionRequest,
} from '../../../domain/ai/types'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { toOpenAiDomainError } from './openai-domain-error'
import { normalizeOpenAiInputImages } from './openai-input-images'
import { createRequestBody, createRequestOptions } from './openai-request'
import {
  mergeOpenAiWebSearchActivity,
  normalizeResponse,
  normalizeToolCall,
  updateOpenAiWebSearchActivityStatus,
} from './openai-response'

export interface OpenAiProviderConfig {
  apiKey: string | null
  baseUrl: string | null
  defaultServiceTier: 'auto' | 'default' | 'flex' | 'scale' | 'priority' | null
  maxRetries: number
  organization: string | null
  project: string | null
  timeoutMs: number
  webhookSecret: string | null
}

const getFunctionToolNames = (
  tools: ResponseCreateParamsNonStreaming['tools'] | ResponseCreateParamsStreaming['tools'],
): string[] =>
  (tools ?? []).flatMap((tool) =>
    tool.type === 'function' && typeof tool.name === 'string' ? [tool.name] : [],
  )

const getToolDescriptors = (
  tools: ResponseCreateParamsNonStreaming['tools'] | ResponseCreateParamsStreaming['tools'],
): string[] =>
  (tools ?? []).map((tool) =>
    tool.type === 'function'
      ? `function:${tool.name}`
      : 'type' in tool && typeof tool.type === 'string'
        ? tool.type
        : 'unknown',
  )

const getReplayFunctionCallNames = (input: unknown): string[] =>
  (Array.isArray(input) ? input : []).flatMap((item) =>
    item.type === 'function_call' && typeof item.name === 'string' ? [item.name] : [],
  )

const cloneRequestBody = <
  TBody extends ResponseCreateParamsNonStreaming | ResponseCreateParamsStreaming,
>(
  body: TBody | null,
): TBody | null => {
  if (!body) {
    return null
  }

  return JSON.parse(JSON.stringify(body)) as TBody
}

const getRequestRunId = (request: ResolvedAiInteractionRequest): string | null =>
  typeof request.metadata?.runId === 'string' && request.metadata.runId.length > 0
    ? request.metadata.runId
    : null

const getErrorCode = (error: unknown): string | null =>
  error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null

const getErrorParam = (error: unknown): string | null =>
  error && typeof error === 'object' && 'param' in error && typeof error.param === 'string'
    ? error.param
    : null

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

const logOpenAiRequestDebug = (
  phase: 'request' | 'error',
  input: {
    body: ResponseCreateParamsNonStreaming | ResponseCreateParamsStreaming | null
    error?: unknown
    mode: 'generate' | 'stream'
    request: ResolvedAiInteractionRequest
  },
): void => {
  if (process.env.NODE_ENV === 'production' || !input.body) {
    return
  }

  const replayFunctionCallNames = getReplayFunctionCallNames(input.body.input)
  const payload = {
    functionToolNames: getFunctionToolNames(input.body.tools),
    messageCount: input.request.messages.length,
    mode: input.mode,
    model: input.request.model,
    nativeTools: input.request.nativeTools ?? [],
    provider: input.request.provider,
    replayFunctionCallNames,
    runId: getRequestRunId(input.request),
    toolDescriptors: getToolDescriptors(input.body.tools),
    toolSnapshot: (input.body.tools ?? []).map((tool) =>
      tool.type === 'function'
        ? {
            name: tool.name,
            strict: tool.strict ?? null,
            type: tool.type,
          }
        : {
            type: 'type' in tool && typeof tool.type === 'string' ? tool.type : 'unknown',
          },
    ),
    toolChoice:
      typeof input.body.tool_choice === 'string'
        ? input.body.tool_choice
        : input.body.tool_choice?.type === 'function'
          ? `function:${input.body.tool_choice.name}`
          : (input.body.tool_choice ?? null),
  }

  if (phase === 'request') {
    console.info(
      JSON.stringify({
        ...payload,
        level: 'info',
        message: 'OpenAI request debug',
        subsystem: 'openai_provider',
        timestamp: new Date().toISOString(),
      }),
    )
    return
  }

  console.warn(
    JSON.stringify({
      ...payload,
      errorCode: getErrorCode(input.error),
      error: input.error instanceof Error ? input.error.message : String(input.error),
      errorParam: getErrorParam(input.error),
      level: 'warn',
      message: 'OpenAI request failed',
      subsystem: 'openai_provider',
      timestamp: new Date().toISOString(),
    }),
  )
}

const notConfiguredError = (): Result<never, DomainError> =>
  err({
    message: 'OpenAI provider is not configured',
    provider: 'openai',
    type: 'provider',
  })

const getReasoningSummaryParts = (
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

const flattenReasoningSummaryParts = (parts: Map<number, string>): string =>
  [...parts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, text]) => text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n')
    .trim()

const isIgnoredOpenAiOutputItemType = (type: string): boolean =>
  type === 'function_call' ||
  type === 'message' ||
  type === 'reasoning' ||
  type === 'web_search_call'

export const createOpenAiProvider = (config: OpenAiProviderConfig): AiProvider => {
  const configured = Boolean(config.apiKey)
  const client =
    configured && config.apiKey
      ? new OpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseUrl ?? undefined,
          maxRetries: config.maxRetries,
          organization: config.organization ?? undefined,
          project: config.project ?? undefined,
          timeout: config.timeoutMs,
          webhookSecret: config.webhookSecret ?? undefined,
        })
      : null
  const imageUploadCache = new Map<string, Promise<string>>()

  return {
    cancel: async (request): Promise<Result<AiCancelResult, DomainError>> => {
      if (!client) {
        return notConfiguredError()
      }

      if (!request.background) {
        return ok({
          provider: 'openai',
          responseId: request.responseId,
          status: 'not_supported',
        })
      }

      try {
        const response = await client.responses.cancel(request.responseId, {
          signal: request.abortSignal,
          timeout: request.timeoutMs ?? config.timeoutMs,
        })

        return ok({
          provider: 'openai',
          responseId: response.id,
          status: response.status === 'cancelled' ? 'cancelled' : 'accepted',
        })
      } catch (error) {
        return err(toOpenAiDomainError(error))
      }
    },
    configured,
    generate: async (request): Promise<Result<AiInteractionResponse, DomainError>> => {
      if (!client) {
        return notConfiguredError()
      }

      let body: ResponseCreateParamsNonStreaming | null = null
      let requestDebugBody: ResponseCreateParamsNonStreaming | null = null

      try {
        const normalizedRequest = await normalizeOpenAiInputImages(client, request, {
          defaultTimeoutMs: config.timeoutMs,
          uploadCache: imageUploadCache,
        })
        body = createRequestBody(normalizedRequest, config, false)
        requestDebugBody = cloneRequestBody(body)
        logOpenAiRequestDebug('request', {
          body: requestDebugBody,
          mode: 'generate',
          request: normalizedRequest,
        })
        const { data, request_id } = await client.responses
          .create(body, createRequestOptions(request, config))
          .withResponse()
        const normalizedResponse = normalizeResponse(data, request_id)

        if (normalizedResponse.status !== 'completed') {
          return err({
            message: readNormalizedResponseErrorMessage(
              normalizedResponse,
              `OpenAI response completed with status ${normalizedResponse.status}`,
            ),
            provider: 'openai',
            type: 'provider',
          })
        }

        return ok(normalizedResponse)
      } catch (error) {
        logOpenAiRequestDebug('error', {
          body: requestDebugBody,
          error,
          mode: 'generate',
          request,
        })
        return err(
          toOpenAiDomainError(error, {
            requestFunctionToolNames: requestDebugBody
              ? getFunctionToolNames(requestDebugBody.tools)
              : [],
          }),
        )
      }
    },
    name: 'openai',
    stream: async (request) => {
      if (!client) {
        return notConfiguredError()
      }

      let body: ResponseCreateParamsStreaming | null = null
      let requestDebugBody: ResponseCreateParamsStreaming | null = null

      try {
        const normalizedRequest = await normalizeOpenAiInputImages(client, request, {
          defaultTimeoutMs: config.timeoutMs,
          uploadCache: imageUploadCache,
        })
        body = createRequestBody(normalizedRequest, config, true)
        requestDebugBody = cloneRequestBody(body)
        logOpenAiRequestDebug('request', {
          body: requestDebugBody,
          mode: 'stream',
          request: normalizedRequest,
        })
        const stream = await client.responses.create(body, createRequestOptions(request, config))

        const events = (async function* (): AsyncGenerator<
          import('../../../domain/ai/types').AiStreamEvent
        > {
          let lastResponseId: string | null = null
          let responseStarted = false
          const reasoningSummaries = new Map<string, Map<number, string>>()
          const webSearchActivities = new Map<
            string,
            import('../../../domain/ai/types').AiWebSearchActivity
          >()
          const unsupportedStreamEventTypes = new Set<string>()
          const unsupportedStreamItemTypes = new Set<string>()

          const normalizeTerminalResponse = (response: Parameters<typeof normalizeResponse>[0]) =>
            normalizeResponse(response, null, {
              adapterIssues: {
                unsupportedStreamEventTypes,
                unsupportedStreamItemTypes,
              },
            })

          const ensureResponseStarted = function* (input: {
            model: string
            responseId: string | null
          }): Generator<import('../../../domain/ai/types').AiStreamEvent> {
            if (responseStarted) {
              return
            }

            responseStarted = true
            lastResponseId = input.responseId
            yield {
              model: input.model,
              provider: 'openai',
              responseId: input.responseId,
              type: 'response.started',
            }
          }

          for await (const event of stream) {
            const eventType = String(event.type)

            if (eventType === 'keepalive' || eventType === 'response.keepalive') {
              continue
            }

            if (event.type === 'response.created') {
              yield* ensureResponseStarted({
                model: event.response.model,
                responseId: event.response.id,
              })
              continue
            }

            if (event.type === 'response.in_progress') {
              yield* ensureResponseStarted({
                model: event.response.model,
                responseId: event.response.id,
              })
              continue
            }

            if (event.type === 'response.queued') {
              yield* ensureResponseStarted({
                model: event.response.model,
                responseId: event.response.id,
              })
              continue
            }

            if (event.type === 'error') {
              throw new Error(event.message)
            }

            if (event.type === 'response.failed' || event.type === 'response.incomplete') {
              yield* ensureResponseStarted({
                model: event.response.model,
                responseId: event.response.id,
              })
              yield {
                response: normalizeTerminalResponse(event.response),
                type: 'response.completed',
              }
              continue
            }

            if (event.type === 'response.completed') {
              yield* ensureResponseStarted({
                model: event.response.model,
                responseId: event.response.id,
              })
              const normalizedResponse = normalizeTerminalResponse(event.response)

              for (const outputItem of normalizedResponse.output) {
                if (outputItem.type !== 'reasoning' || typeof outputItem.text !== 'string') {
                  continue
                }

                yield {
                  itemId: outputItem.id,
                  text: outputItem.text,
                  type: 'reasoning.summary.done',
                }
              }

              for (const activity of normalizedResponse.webSearches) {
                yield {
                  activity,
                  type: 'web_search',
                }
              }

              yield {
                response: normalizedResponse,
                type: 'response.completed',
              }
              continue
            }

            if (event.type === 'response.output_text.delta') {
              if (event.delta) {
                yield {
                  delta: event.delta,
                  type: 'text.delta',
                }
              }
              continue
            }

            if (event.type === 'response.output_text.done') {
              continue
            }

            if (event.type === 'response.reasoning_summary_text.delta') {
              const parts = getReasoningSummaryParts(reasoningSummaries, event.item_id)
              parts.set(
                event.summary_index,
                `${parts.get(event.summary_index) ?? ''}${event.delta}`,
              )
              yield {
                delta: event.delta,
                itemId: event.item_id,
                text: flattenReasoningSummaryParts(parts),
                type: 'reasoning.summary.delta',
              }
              continue
            }

            if (event.type === 'response.reasoning_summary_text.done') {
              const parts = getReasoningSummaryParts(reasoningSummaries, event.item_id)
              parts.set(event.summary_index, event.text)
              yield {
                itemId: event.item_id,
                text: flattenReasoningSummaryParts(parts),
                type: 'reasoning.summary.done',
              }
              continue
            }

            if (
              event.type === 'response.reasoning_summary_part.added' ||
              event.type === 'response.reasoning_summary_part.done'
            ) {
              continue
            }

            if (event.type === 'response.reasoning_text.delta') {
              const parts = getReasoningSummaryParts(reasoningSummaries, event.item_id)
              parts.set(
                event.content_index,
                `${parts.get(event.content_index) ?? ''}${event.delta}`,
              )
              yield {
                delta: event.delta,
                itemId: event.item_id,
                text: flattenReasoningSummaryParts(parts),
                type: 'reasoning.summary.delta',
              }
              continue
            }

            if (event.type === 'response.reasoning_text.done') {
              const parts = getReasoningSummaryParts(reasoningSummaries, event.item_id)
              parts.set(event.content_index, event.text)
              yield {
                itemId: event.item_id,
                text: flattenReasoningSummaryParts(parts),
                type: 'reasoning.summary.done',
              }
              continue
            }

            if (event.type === 'response.web_search_call.in_progress') {
              const activity = updateOpenAiWebSearchActivityStatus(
                webSearchActivities.get(event.item_id) ?? null,
                {
                  id: event.item_id,
                  responseId: lastResponseId,
                  status: 'in_progress',
                },
              )
              webSearchActivities.set(event.item_id, activity)
              yield {
                activity,
                type: 'web_search',
              }
              continue
            }

            if (event.type === 'response.web_search_call.searching') {
              const activity = updateOpenAiWebSearchActivityStatus(
                webSearchActivities.get(event.item_id) ?? null,
                {
                  id: event.item_id,
                  responseId: lastResponseId,
                  status: 'searching',
                },
              )
              webSearchActivities.set(event.item_id, activity)
              yield {
                activity,
                type: 'web_search',
              }
              continue
            }

            if (event.type === 'response.web_search_call.completed') {
              const activity = updateOpenAiWebSearchActivityStatus(
                webSearchActivities.get(event.item_id) ?? null,
                {
                  id: event.item_id,
                  responseId: lastResponseId,
                  status: 'completed',
                },
              )
              webSearchActivities.set(event.item_id, activity)
              yield {
                activity,
                type: 'web_search',
              }
              continue
            }

            if (event.type === 'response.refusal.delta') {
              if (event.delta) {
                yield {
                  delta: event.delta,
                  type: 'text.delta',
                }
              }
              continue
            }

            if (event.type === 'response.refusal.done') {
              continue
            }

            if (
              event.type === 'response.content_part.added' ||
              event.type === 'response.content_part.done' ||
              event.type === 'response.function_call_arguments.delta' ||
              event.type === 'response.function_call_arguments.done'
            ) {
              continue
            }

            if (event.type === 'response.output_text.annotation.added') {
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
              continue
            }

            if (event.type === 'response.output_item.added') {
              if (!isIgnoredOpenAiOutputItemType(event.item.type)) {
                unsupportedStreamItemTypes.add(event.item.type)
              }
              continue
            }

            if (event.type === 'response.output_item.done' && event.item.type === 'function_call') {
              yield {
                call: normalizeToolCall(event.item),
                type: 'tool.call',
              }
              continue
            }

            if (
              event.type === 'response.output_item.done' &&
              event.item.type === 'web_search_call'
            ) {
              const activity = mergeOpenAiWebSearchActivity(
                webSearchActivities.get(event.item.id) ?? null,
                event.item,
                lastResponseId,
              )
              webSearchActivities.set(event.item.id, activity)
              yield {
                activity,
                type: 'web_search',
              }
              continue
            }

            if (event.type === 'response.output_item.done') {
              if (!isIgnoredOpenAiOutputItemType(event.item.type)) {
                unsupportedStreamItemTypes.add(event.item.type)
              }
              continue
            }

            unsupportedStreamEventTypes.add(event.type)
          }
        })()

        return ok(events)
      } catch (error) {
        logOpenAiRequestDebug('error', {
          body: requestDebugBody,
          error,
          mode: 'stream',
          request,
        })
        return err(
          toOpenAiDomainError(error, {
            requestFunctionToolNames: requestDebugBody
              ? getFunctionToolNames(requestDebugBody.tools)
              : [],
          }),
        )
      }
    },
  }
}
