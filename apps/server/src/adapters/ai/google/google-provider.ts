import { GoogleGenAI, type Interactions } from '@google/genai'

import type { AiProvider } from '../../../domain/ai/provider'
import type { AiCancelResult, AiInteractionResponse, AiStreamEvent } from '../../../domain/ai/types'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { toGoogleDomainError } from './google-domain-error'
import {
  buildCreateInteractionParams,
  buildRequestOptions,
  ensureGoogleCompatibleRequest,
} from './google-request'
import { normalizeResponse } from './google-response'

export interface GoogleProviderConfig {
  apiKey: string | null
  apiVersion: string | null
  baseUrl: string | null
  defaultHttpTimeoutMs: number
  location: string | null
  maxRetries: number
  project: string | null
  vertexai: boolean
}

const resolveConfigured = (config: GoogleProviderConfig): boolean =>
  Boolean(config.apiKey) || (config.vertexai && Boolean(config.project) && Boolean(config.location))

const notConfiguredError = (): Result<never, DomainError> =>
  err({
    message: 'Google GenAI provider is not configured',
    provider: 'google',
    type: 'provider',
  })

const installDiagnosticFetch = (): void => {
  const originalFetch = globalThis.fetch

  if ((originalFetch as { __googleDiagnostic?: boolean }).__googleDiagnostic) {
    return
  }

  const diagnosticFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const response = await originalFetch(input, init)

    if (
      !response.ok &&
      typeof input === 'string' &&
      input.includes('generativelanguage.googleapis.com')
    ) {
      const cloned = response.clone()

      try {
        const body = await cloned.text()
        console.error(
          JSON.stringify({
            body: body.slice(0, 2000),
            level: 'error',
            message: 'Google GenAI HTTP error',
            status: response.status,
            statusText: response.statusText,
            subsystem: 'google_provider',
            timestamp: new Date().toISOString(),
          }),
        )
      } catch {}
    }

    return response
  }

  ;(diagnosticFetch as { __googleDiagnostic?: boolean }).__googleDiagnostic = true
  globalThis.fetch = diagnosticFetch as typeof globalThis.fetch
}

const cloneValue = <T>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

const getThoughtItemId = (signature: string | undefined, index: number): string =>
  signature?.trim() || `google_thought:${index}`

interface GoogleThoughtStreamState {
  emittedLength: number
  itemId: string | null
  text: string
}

const ensureThoughtState = (
  thoughts: Map<number, GoogleThoughtStreamState>,
  index: number,
): GoogleThoughtStreamState => {
  const existing = thoughts.get(index)

  if (existing) {
    return existing
  }

  const created: GoogleThoughtStreamState = {
    emittedLength: 0,
    itemId: null,
    text: '',
  }

  thoughts.set(index, created)

  return created
}

const toOutputList = (output: Array<Interactions.Content | undefined>): Interactions.Content[] =>
  output.filter((content): content is Interactions.Content => content !== undefined)

const readTextValue = (content: Interactions.Content | undefined): string =>
  content?.type === 'text' && typeof content.text === 'string' ? content.text : ''

const readTextAnnotations = (content: Interactions.Content | undefined): unknown[] | undefined => {
  const annotations = (content as { annotations?: unknown } | undefined)?.annotations

  return content?.type === 'text' && Array.isArray(annotations) ? annotations : undefined
}

const mergeOutputContent = (
  existing: Interactions.Content | undefined,
  delta: Interactions.ContentDelta['delta'],
): Interactions.Content => {
  switch (delta.type) {
    case 'text':
      return {
        ...(readTextAnnotations(existing) ? { annotations: readTextAnnotations(existing) } : {}),
        text: `${readTextValue(existing)}${typeof delta.text === 'string' ? delta.text : ''}`,
        type: 'text',
      } as Interactions.Content
    case 'text_annotation':
      return {
        text: readTextValue(existing),
        ...(Array.isArray(delta.annotations) ? { annotations: delta.annotations } : {}),
        type: 'text',
      } as Interactions.Content
    case 'thought_signature':
      return {
        ...(existing?.type === 'thought' ? existing : { summary: [], type: 'thought' as const }),
        ...(delta.signature ? { signature: delta.signature } : {}),
      }
    case 'thought_summary':
      return {
        ...(existing?.type === 'thought' ? existing : { summary: [], type: 'thought' as const }),
        ...(delta.content
          ? {
              summary: [
                ...((existing?.type === 'thought' && Array.isArray(existing.summary)
                  ? existing.summary
                  : []) as NonNullable<Interactions.ThoughtContent['summary']>),
                cloneValue(delta.content),
              ],
            }
          : {}),
      }
    case 'function_call':
      return {
        ...(existing?.type === 'function_call' ? existing : { type: 'function_call' as const }),
        ...(delta.arguments ? { arguments: delta.arguments } : {}),
        ...(delta.id ? { id: delta.id } : {}),
        ...(delta.name ? { name: delta.name } : {}),
        ...(delta.signature ? { signature: delta.signature } : {}),
      } as Interactions.Content
    case 'function_result':
      return {
        ...(existing?.type === 'function_result' ? existing : { type: 'function_result' as const }),
        ...(delta.call_id ? { call_id: delta.call_id } : {}),
        ...(delta.is_error !== undefined ? { is_error: delta.is_error } : {}),
        ...(delta.name ? { name: delta.name } : {}),
        ...(delta.signature ? { signature: delta.signature } : {}),
        ...(delta.result !== undefined ? { result: delta.result } : {}),
      } as Interactions.Content
    case 'google_search_call':
      return {
        ...(existing?.type === 'google_search_call'
          ? existing
          : {
              arguments: {},
              type: 'google_search_call' as const,
            }),
        ...(delta.arguments ? { arguments: delta.arguments } : {}),
        ...(delta.id ? { id: delta.id } : {}),
        ...(delta.signature ? { signature: delta.signature } : {}),
      } as Interactions.Content
    case 'google_search_result':
      return {
        ...(existing?.type === 'google_search_result'
          ? existing
          : {
              result: [],
              type: 'google_search_result' as const,
            }),
        ...(delta.call_id ? { call_id: delta.call_id } : {}),
        ...(delta.is_error !== undefined ? { is_error: delta.is_error } : {}),
        ...(delta.signature ? { signature: delta.signature } : {}),
        ...(delta.result ? { result: delta.result } : {}),
      } as Interactions.Content
    default:
      return cloneValue(delta) as Interactions.Content
  }
}

const toCancelRequestOptions = (
  request: Parameters<AiProvider['cancel']>[0],
  config: GoogleProviderConfig,
): {
  maxRetries: number
  signal?: AbortSignal
  timeout: number
} => ({
  ...(request.abortSignal ? { signal: request.abortSignal } : {}),
  maxRetries: config.maxRetries,
  timeout: request.timeoutMs ?? config.defaultHttpTimeoutMs,
})

export const createGoogleProvider = (config: GoogleProviderConfig): AiProvider => {
  const configured = resolveConfigured(config)

  if (configured) {
    installDiagnosticFetch()
  }

  const client = configured
    ? new GoogleGenAI({
        apiKey: config.apiKey ?? undefined,
        apiVersion: config.apiVersion ?? undefined,
        httpOptions: {
          baseUrl: config.baseUrl ?? undefined,
          retryOptions: {
            attempts: config.maxRetries + 1,
          },
          timeout: config.defaultHttpTimeoutMs,
        },
        location: config.location ?? undefined,
        project: config.project ?? undefined,
        vertexai: config.vertexai,
      })
    : null

  return {
    cancel: async (request): Promise<Result<AiCancelResult, DomainError>> => {
      if (!client) {
        return notConfiguredError()
      }

      if (!request.background) {
        return ok({
          provider: 'google',
          responseId: request.responseId,
          status: 'not_supported',
        })
      }

      try {
        const interaction = await client.interactions.cancel(
          request.responseId,
          {
            ...(config.apiVersion ? { api_version: config.apiVersion } : {}),
          },
          toCancelRequestOptions(request, config),
        )

        return ok({
          provider: 'google',
          responseId: interaction.id,
          status: interaction.status === 'cancelled' ? 'cancelled' : 'accepted',
        })
      } catch (error) {
        return err(toGoogleDomainError(error))
      }
    },
    configured,
    generate: async (request): Promise<Result<AiInteractionResponse, DomainError>> => {
      if (!client) {
        return notConfiguredError()
      }

      try {
        ensureGoogleCompatibleRequest(request)

        const interaction = (await client.interactions.create(
          buildCreateInteractionParams(request, config, false),
          buildRequestOptions(request, config),
        )) as Interactions.Interaction

        return ok(normalizeResponse(request, interaction))
      } catch (error) {
        const domainError = toGoogleDomainError(error)

        console.error(
          JSON.stringify({
            errorClass: error instanceof Error ? error.constructor.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : undefined,
            domainType: domainError.type,
            level: 'error',
            message: 'Google Interactions generate failed',
            model: request.model,
            subsystem: 'google_provider',
            timestamp: new Date().toISOString(),
            toolCount: request.tools?.length ?? 0,
          }),
        )

        return err(domainError)
      }
    },
    name: 'google',
    stream: async (request) => {
      if (!client) {
        return notConfiguredError()
      }

      try {
        ensureGoogleCompatibleRequest(request)

        const responseStream = (await client.interactions.create(
          buildCreateInteractionParams(request, config, true),
          buildRequestOptions(request, config),
        )) as AsyncIterable<Interactions.InteractionSSEEvent>

        return ok(
          (async function* (): AsyncGenerator<AiStreamEvent> {
            const thoughtStates = new Map<number, GoogleThoughtStreamState>()
            const output: Array<Interactions.Content | undefined> = []
            let interactionSnapshot: Interactions.Interaction | null = null
            let lastError: {
              code?: string | null
              message?: string | null
            } | null = null
            let lastStatus: Interactions.Interaction['status'] | null = null
            let finalInteraction: Interactions.Interaction | null = null

            const flushBufferedThoughtDelta = (index: number): AiStreamEvent | null => {
              const state = ensureThoughtState(thoughtStates, index)
              const content = output[index]

              if (content?.type === 'thought' && typeof content.signature === 'string') {
                state.itemId = content.signature.trim() || null
              }

              if (!state.itemId) {
                return null
              }

              const delta = state.text.slice(state.emittedLength)

              if (delta.length === 0) {
                return null
              }

              state.emittedLength = state.text.length

              return {
                delta,
                itemId: state.itemId,
                text: state.text,
                type: 'reasoning.summary.delta',
              }
            }

            for await (const event of responseStream) {
              if (event.event_type === 'interaction.start') {
                interactionSnapshot = cloneValue(event.interaction)
                lastStatus = event.interaction.status

                yield {
                  model: event.interaction.model ?? request.model,
                  provider: 'google',
                  responseId: event.interaction.id ?? null,
                  type: 'response.started',
                }
                continue
              }

              if (event.event_type === 'interaction.status_update') {
                lastStatus = event.status

                if (interactionSnapshot) {
                  interactionSnapshot.status = event.status
                }

                continue
              }

              if (event.event_type === 'content.start') {
                output[event.index] = cloneValue(event.content)

                if (
                  event.content.type === 'thought' &&
                  typeof event.content.signature === 'string'
                ) {
                  ensureThoughtState(thoughtStates, event.index).itemId =
                    event.content.signature.trim() || null
                }

                continue
              }

              if (event.event_type === 'content.delta') {
                output[event.index] = mergeOutputContent(output[event.index], event.delta)

                if (
                  event.delta.type === 'text' &&
                  typeof event.delta.text === 'string' &&
                  event.delta.text.length > 0
                ) {
                  yield {
                    delta: event.delta.text,
                    type: 'text.delta',
                  }
                  continue
                }

                if (event.delta.type === 'thought_signature') {
                  const bufferedDelta = flushBufferedThoughtDelta(event.index)

                  if (bufferedDelta) {
                    yield bufferedDelta
                  }

                  continue
                }

                if (
                  event.delta.type === 'thought_summary' &&
                  event.delta.content?.type === 'text' &&
                  event.delta.content.text.length > 0
                ) {
                  const state = ensureThoughtState(thoughtStates, event.index)

                  state.text += event.delta.content.text

                  const bufferedDelta = flushBufferedThoughtDelta(event.index)

                  if (bufferedDelta) {
                    yield bufferedDelta
                  }
                }

                continue
              }

              if (event.event_type === 'content.stop') {
                if (output[event.index]?.type === 'thought') {
                  const state = ensureThoughtState(thoughtStates, event.index)
                  const thoughtContent = output[event.index]

                  state.itemId =
                    state.itemId ??
                    getThoughtItemId(
                      thoughtContent && thoughtContent.type === 'thought'
                        ? thoughtContent.signature
                        : undefined,
                      event.index,
                    )

                  const bufferedDelta = flushBufferedThoughtDelta(event.index)

                  if (bufferedDelta) {
                    yield bufferedDelta
                  }
                }

                continue
              }

              if (event.event_type === 'error') {
                lastError = {
                  code: event.error?.code ?? null,
                  message: event.error?.message ?? null,
                }
                continue
              }

              if (event.event_type === 'interaction.complete') {
                finalInteraction = {
                  ...cloneValue(event.interaction),
                  outputs: toOutputList(output),
                }
              }
            }

            const interaction =
              finalInteraction ??
              (interactionSnapshot
                ? {
                    ...interactionSnapshot,
                    outputs: toOutputList(output),
                    status: lastStatus ?? interactionSnapshot.status,
                    updated: new Date().toISOString(),
                  }
                : null)

            if (!interaction) {
              throw new Error('Google Interactions stream completed without an interaction')
            }

            const normalizedResponse = normalizeResponse(request, interaction, {
              error: lastError,
              output: toOutputList(output),
            })

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

            for (const toolCall of normalizedResponse.toolCalls) {
              yield {
                call: toolCall,
                type: 'tool.call',
              }
            }

            yield {
              response: normalizedResponse,
              type: 'response.completed',
            }
          })(),
        )
      } catch (error) {
        const domainError = toGoogleDomainError(error)

        console.error(
          JSON.stringify({
            errorClass: error instanceof Error ? error.constructor.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : undefined,
            domainType: domainError.type,
            level: 'error',
            message: 'Google Interactions stream failed',
            model: request.model,
            subsystem: 'google_provider',
            timestamp: new Date().toISOString(),
            toolCount: request.tools?.length ?? 0,
          }),
        )

        return err(domainError)
      }
    },
  }
}
