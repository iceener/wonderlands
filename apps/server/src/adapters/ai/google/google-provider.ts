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

const toStepList = (steps: Array<Interactions.Step | undefined>): Interactions.Step[] =>
  steps.filter((step): step is Interactions.Step => step !== undefined)

const appendModelOutputText = (
  existing: Interactions.Step | undefined,
  text: string,
): Interactions.Step => {
  const step: Interactions.ModelOutputStep =
    existing?.type === 'model_output' ? existing : { content: [], type: 'model_output' }
  const content = Array.isArray(step.content) ? step.content : []
  const last = content.at(-1)

  if (last?.type === 'text') {
    return {
      ...step,
      content: [...content.slice(0, -1), { ...last, text: `${last.text}${text}` }],
    }
  }

  return {
    ...step,
    content: [...content, { text, type: 'text' }],
  }
}

const appendModelOutputAnnotations = (
  existing: Interactions.Step | undefined,
  annotations: Interactions.Annotation[],
): Interactions.Step | undefined => {
  if (existing?.type !== 'model_output' || !Array.isArray(existing.content)) {
    return existing
  }

  const last = existing.content.at(-1)

  if (last?.type !== 'text') {
    return existing
  }

  return {
    ...existing,
    content: [
      ...existing.content.slice(0, -1),
      {
        ...last,
        annotations: [...(Array.isArray(last.annotations) ? last.annotations : []), ...annotations],
      },
    ],
  }
}

const mergeStepDelta = (
  existing: Interactions.Step | undefined,
  delta: Interactions.StepDelta['delta'],
): Interactions.Step | undefined => {
  switch (delta.type) {
    case 'text':
      return appendModelOutputText(existing, typeof delta.text === 'string' ? delta.text : '')
    case 'text_annotation_delta':
      return appendModelOutputAnnotations(existing, delta.annotations ?? [])
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
                  : []) as NonNullable<Interactions.ThoughtStep['summary']>),
                cloneValue(delta.content) as NonNullable<
                  Interactions.ThoughtStep['summary']
                >[number],
              ],
            }
          : {}),
      }
    case 'function_result':
      return {
        ...(existing?.type === 'function_result'
          ? existing
          : { call_id: '', result: '', type: 'function_result' as const }),
        ...(delta.call_id ? { call_id: delta.call_id } : {}),
        ...(delta.is_error !== undefined ? { is_error: delta.is_error } : {}),
        ...(delta.name ? { name: delta.name } : {}),
        ...(delta.result !== undefined ? { result: delta.result } : {}),
      } as Interactions.Step
    case 'google_search_call':
      return {
        ...(existing?.type === 'google_search_call'
          ? existing
          : {
              arguments: {},
              id: '',
              type: 'google_search_call' as const,
            }),
        ...(delta.arguments ? { arguments: delta.arguments } : {}),
        ...(delta.signature ? { signature: delta.signature } : {}),
      } as Interactions.Step
    case 'google_search_result':
      return {
        ...(existing?.type === 'google_search_result'
          ? existing
          : {
              call_id: '',
              result: [],
              type: 'google_search_result' as const,
            }),
        ...(delta.is_error !== undefined ? { is_error: delta.is_error } : {}),
        ...(delta.signature ? { signature: delta.signature } : {}),
        ...(delta.result ? { result: delta.result } : {}),
      } as Interactions.Step
    default:
      // Function-call arguments stream separately as partial JSON
      // (arguments_delta) and are accumulated by the caller; other
      // delta types have no adapter-visible representation yet.
      return existing
  }
}

const parseStreamedFunctionArguments = (
  step: Interactions.Step | undefined,
  argumentsJson: string,
): Interactions.Step | undefined => {
  if (step?.type !== 'function_call' || argumentsJson.length === 0) {
    return step
  }

  try {
    const parsed: unknown = JSON.parse(argumentsJson)

    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return {
        ...step,
        arguments: parsed as Interactions.FunctionCallStep['arguments'],
      }
    }
  } catch {}

  return step
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
            const argumentBuffers = new Map<number, string>()
            const steps: Array<Interactions.Step | undefined> = []
            let interactionSnapshot: Interactions.Interaction | null = null
            let lastError: {
              code?: string | null
              message?: string | null
            } | null = null
            let lastStatus: Interactions.Interaction['status'] | null = null
            let finalInteraction: Interactions.Interaction | null = null

            const finalizeFunctionArguments = (index: number): void => {
              const buffered = argumentBuffers.get(index)

              if (buffered === undefined) {
                return
              }

              argumentBuffers.delete(index)
              steps[index] = parseStreamedFunctionArguments(steps[index], buffered)
            }

            const flushBufferedThoughtDelta = (index: number): AiStreamEvent | null => {
              const state = ensureThoughtState(thoughtStates, index)
              const step = steps[index]

              if (step?.type === 'thought' && typeof step.signature === 'string') {
                state.itemId = step.signature.trim() || null
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
              if (event.event_type === 'interaction.created') {
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

              if (event.event_type === 'step.start') {
                steps[event.index] = cloneValue(event.step)

                if (event.step.type === 'thought' && typeof event.step.signature === 'string') {
                  ensureThoughtState(thoughtStates, event.index).itemId =
                    event.step.signature.trim() || null
                }

                continue
              }

              if (event.event_type === 'step.delta') {
                if (event.delta.type === 'arguments_delta') {
                  argumentBuffers.set(
                    event.index,
                    `${argumentBuffers.get(event.index) ?? ''}${event.delta.arguments ?? ''}`,
                  )
                  continue
                }

                steps[event.index] = mergeStepDelta(steps[event.index], event.delta)

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

              if (event.event_type === 'step.stop') {
                finalizeFunctionArguments(event.index)

                if (steps[event.index]?.type === 'thought') {
                  const state = ensureThoughtState(thoughtStates, event.index)
                  const thoughtStep = steps[event.index]

                  state.itemId =
                    state.itemId ??
                    getThoughtItemId(
                      thoughtStep && thoughtStep.type === 'thought'
                        ? thoughtStep.signature
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

              if (event.event_type === 'interaction.completed') {
                for (const index of [...argumentBuffers.keys()]) {
                  finalizeFunctionArguments(index)
                }

                finalInteraction = {
                  ...cloneValue(event.interaction),
                  steps: toStepList(steps),
                }
              }
            }

            for (const index of [...argumentBuffers.keys()]) {
              finalizeFunctionArguments(index)
            }

            const interaction =
              finalInteraction ??
              (interactionSnapshot
                ? {
                    ...interactionSnapshot,
                    status: lastStatus ?? interactionSnapshot.status,
                    steps: toStepList(steps),
                    updated: new Date().toISOString(),
                  }
                : null)

            if (!interaction) {
              throw new Error('Google Interactions stream completed without an interaction')
            }

            const normalizedResponse = normalizeResponse(request, interaction, {
              error: lastError,
              steps: toStepList(steps),
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
