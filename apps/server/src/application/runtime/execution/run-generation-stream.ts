import type {
  AiInteractionRequest,
  AiInteractionResponse,
  AiOutputReasoningItem,
  AiProviderName,
} from '../../../domain/ai/types'
import type { RunRecord } from '../../../domain/runtime/run-repository'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import type { CommandContext } from '../../commands/command-context'
import type { ContextBudgetReport } from '../../interactions/context-bundle'
import { normalizeAssistantOutputText } from '../../interactions/normalize-interaction-response'
import {
  emitGenerationCompleted,
  emitGenerationFailed,
  emitGenerationStarted,
  emitProgressReported,
  emitReasoningSummaryDelta,
  emitReasoningSummaryDone,
  emitStreamDelta,
  emitStreamDone,
  emitTurnCompleted,
  emitTurnStarted,
  emitWebSearchProgress,
} from '../run-telemetry'

export interface StreamRunInteractionInput {
  budget: ContextBudgetReport
  observationCount: number
  pendingWaitCount: number
  request: AiInteractionRequest
  run: RunRecord
  summaryId: string | null
  turn: number
}

const STREAM_DELTA_BATCH_MAX_CHARS = 384
const STREAM_DELTA_BATCH_MAX_AGE_MS = 120
const REASONING_DELTA_BATCH_MAX_CHARS = 640
const REASONING_DELTA_BATCH_MAX_AGE_MS = 160

const backfillIncompleteGoogleStreamResponse = (
  response: AiInteractionResponse,
  accumulatedText: string,
  accumulatedReasoningSummaries: Map<string, string>,
): AiInteractionResponse => {
  if (response.provider !== 'google') {
    return response
  }

  const normalizedAccumulatedText = accumulatedText.trim()
  const nextOutput = [...response.output]
  let nextMessages = response.messages
  let nextOutputText = response.outputText

  if (normalizedAccumulatedText.length > 0 && normalizeAssistantOutputText(response).length === 0) {
    const backfilledTextPart = {
      text: normalizedAccumulatedText,
      type: 'text' as const,
    }

    nextMessages = [
      ...response.messages,
      {
        content: [backfilledTextPart],
        role: 'assistant',
      },
    ]
    nextOutput.push({
      content: [backfilledTextPart],
      role: 'assistant',
      type: 'message',
    })
    nextOutputText = normalizedAccumulatedText
  }

  const existingReasoningIds = new Set(
    nextOutput
      .filter((item): item is AiOutputReasoningItem => item.type === 'reasoning')
      .map((item) => item.id),
  )

  for (const [itemId, text] of accumulatedReasoningSummaries.entries()) {
    const normalizedText = text.trim()

    if (normalizedText.length === 0 || existingReasoningIds.has(itemId)) {
      continue
    }

    nextOutput.push({
      id: itemId,
      summary: [{ text: normalizedText, type: 'summary_text' as const }],
      text: normalizedText,
      thought: true,
      type: 'reasoning',
    })
    existingReasoningIds.add(itemId)
  }

  if (
    nextMessages === response.messages &&
    nextOutput.length === response.output.length &&
    nextOutputText === response.outputText
  ) {
    return response
  }

  return {
    ...response,
    messages: nextMessages,
    output: nextOutput,
    outputText: nextOutputText,
  }
}

export const streamRunInteraction = async (
  context: CommandContext,
  input: StreamRunInteractionInput,
): Promise<Result<AiInteractionResponse, DomainError>> => {
  emitTurnStarted(context, context.db, input.run, {
    budget: input.budget,
    observationCount: input.observationCount,
    pendingWaitCount: input.pendingWaitCount,
    summaryId: input.summaryId,
    turn: input.turn,
  })
  emitProgressReported(context, context.db, input.run, {
    detail: 'Thread context assembled from durable state',
    percent: 15,
    stage: 'context.loaded',
    turn: input.turn,
  })

  const generationStartedAt = context.services.clock.nowIso()
  emitGenerationStarted(context, context.db, input.run, {
    request: input.request,
    provider: input.request.provider ?? context.config.ai.defaults.provider,
    requestedModel: input.request.model ?? null,
    startedAt: generationStartedAt,
    turn: input.turn,
  })
  const streamed = await context.services.ai.interactions.stream(input.request)

  if (!streamed.ok) {
    emitGenerationFailed(context, context.db, input.run, {
      error: streamed.error,
      provider: input.request.provider ?? context.config.ai.defaults.provider,
      startedAt: generationStartedAt,
      turn: input.turn,
    })
    return streamed
  }

  emitProgressReported(context, context.db, input.run, {
    detail: 'Model generation started',
    percent: 35,
    stage: 'generation.started',
    turn: input.turn,
  })

  let lastModel: string | undefined
  let lastProvider: AiProviderName | undefined
  let lastResponseId: string | null = null
  let response: AiInteractionResponse | null = null
  let accumulatedText = ''
  const accumulatedReasoningSummaries = new Map<string, string>()
  let pendingStreamDelta: {
    delta: string
    startedAtMs: number
  } | null = null
  let pendingReasoningDelta: {
    delta: string
    itemId: string
    startedAtMs: number
    text: string
  } | null = null

  const nowMs = () => context.services.clock.now().getTime()

  const shouldFlushDeltaBatch = (
    startedAtMs: number,
    currentLength: number,
    nextLength: number,
    options: {
      maxAgeMs: number
      maxChars: number
    },
  ): boolean =>
    currentLength > 0 &&
    (currentLength + nextLength > options.maxChars || nowMs() - startedAtMs >= options.maxAgeMs)

  const flushPendingStreamDelta = () => {
    if (!pendingStreamDelta || pendingStreamDelta.delta.length === 0) {
      pendingStreamDelta = null
      return
    }

    emitStreamDelta(context, context.db, input.run, {
      delta: pendingStreamDelta.delta,
      model: lastModel,
      provider: lastProvider,
      responseId: lastResponseId,
      turn: input.turn,
    })
    pendingStreamDelta = null
  }

  const flushPendingReasoningDelta = () => {
    if (!pendingReasoningDelta || pendingReasoningDelta.delta.length === 0) {
      pendingReasoningDelta = null
      return
    }

    emitReasoningSummaryDelta(context, context.db, input.run, {
      delta: pendingReasoningDelta.delta,
      itemId: pendingReasoningDelta.itemId,
      text: pendingReasoningDelta.text,
      turn: input.turn,
    })
    pendingReasoningDelta = null
  }

  const flushPendingTelemetryDeltas = () => {
    flushPendingReasoningDelta()
    flushPendingStreamDelta()
  }

  try {
    for await (const event of streamed.value) {
      if (event.type === 'text.delta') {
        if (pendingReasoningDelta) {
          flushPendingReasoningDelta()
        }

        accumulatedText += event.delta

        if (
          pendingStreamDelta &&
          shouldFlushDeltaBatch(
            pendingStreamDelta.startedAtMs,
            pendingStreamDelta.delta.length,
            event.delta.length,
            {
              maxAgeMs: STREAM_DELTA_BATCH_MAX_AGE_MS,
              maxChars: STREAM_DELTA_BATCH_MAX_CHARS,
            },
          )
        ) {
          flushPendingStreamDelta()
        }

        if (!pendingStreamDelta) {
          pendingStreamDelta = {
            delta: event.delta,
            startedAtMs: nowMs(),
          }
        } else {
          pendingStreamDelta.delta += event.delta
        }
        continue
      }

      if (event.type === 'reasoning.summary.delta') {
        if (pendingStreamDelta) {
          flushPendingStreamDelta()
        }

        accumulatedReasoningSummaries.set(event.itemId, event.text)

        if (pendingReasoningDelta && pendingReasoningDelta.itemId !== event.itemId) {
          flushPendingReasoningDelta()
        }

        if (
          pendingReasoningDelta &&
          shouldFlushDeltaBatch(
            pendingReasoningDelta.startedAtMs,
            pendingReasoningDelta.delta.length,
            event.delta.length,
            {
              maxAgeMs: REASONING_DELTA_BATCH_MAX_AGE_MS,
              maxChars: REASONING_DELTA_BATCH_MAX_CHARS,
            },
          )
        ) {
          flushPendingReasoningDelta()
        }

        if (!pendingReasoningDelta) {
          pendingReasoningDelta = {
            delta: event.delta,
            itemId: event.itemId,
            startedAtMs: nowMs(),
            text: event.text,
          }
        } else {
          pendingReasoningDelta.delta += event.delta
          pendingReasoningDelta.text = event.text
        }
        continue
      }

      flushPendingTelemetryDeltas()

      if (event.type === 'response.started') {
        lastModel = event.model
        lastProvider = event.provider
        lastResponseId = event.responseId
        continue
      }

      if (event.type === 'reasoning.summary.done') {
        accumulatedReasoningSummaries.set(event.itemId, event.text)
        emitReasoningSummaryDone(context, context.db, input.run, {
          itemId: event.itemId,
          text: event.text,
          turn: input.turn,
        })
        continue
      }

      if (event.type === 'tool.call') {
        continue
      }

      if (event.type === 'web_search') {
        emitWebSearchProgress(context, context.db, input.run, {
          activity: event.activity,
          turn: input.turn,
        })
        continue
      }

      if (event.type !== 'response.completed') {
        continue
      }

      response = event.response
    }
  } catch (error) {
    flushPendingTelemetryDeltas()

    const providerError = {
      message:
        error instanceof Error
          ? error.message
          : `streamed interaction for run ${input.run.id} failed unexpectedly`,
      provider: input.request.provider ?? context.config.ai.defaults.provider,
      type: 'provider',
    } as const

    emitGenerationFailed(context, context.db, input.run, {
      error: providerError,
      provider: providerError.provider,
      startedAt: generationStartedAt,
      turn: input.turn,
    })

    return err(providerError)
  }

  flushPendingTelemetryDeltas()

  if (!response) {
    const providerError = {
      message: `streamed interaction for run ${input.run.id} completed without a final response`,
      type: 'provider',
      provider: input.request.provider ?? context.config.ai.defaults.provider,
    } as const

    emitGenerationFailed(context, context.db, input.run, {
      error: providerError,
      provider: providerError.provider,
      startedAt: generationStartedAt,
      turn: input.turn,
    })

    return err(providerError)
  }

  const effectiveResponse = backfillIncompleteGoogleStreamResponse(
    response,
    accumulatedText,
    accumulatedReasoningSummaries,
  )

  if (effectiveResponse.status !== 'completed') {
    const rawResponse =
      typeof effectiveResponse.raw === 'object' && effectiveResponse.raw !== null
        ? (effectiveResponse.raw as {
            error?: {
              message?: string | null
            } | null
          })
        : null

    const providerError = {
      message:
        rawResponse?.error?.message?.trim() ||
        `provider returned terminal response status ${effectiveResponse.status} for run ${input.run.id}`,
      type: 'provider',
      provider: effectiveResponse.provider,
    } as const

    emitGenerationFailed(context, context.db, input.run, {
      error: providerError,
      provider: providerError.provider,
      startedAt: generationStartedAt,
      turn: input.turn,
    })

    return err(providerError)
  }

  const effectiveOutputText = normalizeAssistantOutputText(effectiveResponse)

  emitStreamDone(context, context.db, input.run, {
    model: effectiveResponse.model,
    provider: effectiveResponse.provider,
    responseId: effectiveResponse.responseId,
    text: effectiveOutputText,
    turn: input.turn,
  })
  emitGenerationCompleted(context, context.db, input.run, {
    budget: input.budget,
    response: {
      ...effectiveResponse,
      outputText: effectiveOutputText,
    },
    startedAt: generationStartedAt,
    turn: input.turn,
  })
  emitTurnCompleted(context, context.db, input.run, {
    hasToolCalls: effectiveResponse.toolCalls.length > 0,
    outputItemCount: effectiveResponse.output.length,
    outputTextLength: effectiveOutputText.length,
    turn: input.turn,
  })
  emitProgressReported(context, context.db, input.run, {
    detail:
      effectiveResponse.toolCalls.length > 0
        ? 'Tool calls returned from model'
        : 'Model turn completed',
    percent: effectiveResponse.toolCalls.length > 0 ? 65 : 55,
    stage: effectiveResponse.toolCalls.length > 0 ? 'tools.pending' : 'generation.completed',
    turn: input.turn,
  })

  return ok({ ...effectiveResponse, outputText: effectiveOutputText })
}
