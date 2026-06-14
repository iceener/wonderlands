import { z } from 'zod'
import type { AiProviderName } from '../../domain/ai/types'
import type { ObservationMemoryContent } from '../../domain/memory/memory-record-repository'
import type { ContextSummaryRecord } from '../../domain/runtime/context-summary-repository'
import type { RunRecord } from '../../domain/runtime/run-repository'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import type { CommandContext } from '../commands/command-context'
import { toTextContent } from '../interactions/build-run-interaction-request'
import { estimateMessageTokens } from '../interactions/context-bundle'
import { normalizeAssistantOutputText } from '../interactions/normalize-interaction-response'
import { OBSERVER_PROMPT } from './observer-prompt'

const observerResponseSchema = z.object({
  observations: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(280),
      }),
    )
    .max(8),
})

const observerResponseJsonSchema = {
  additionalProperties: false,
  properties: {
    observations: {
      items: {
        additionalProperties: false,
        properties: {
          text: {
            maxLength: 280,
            minLength: 1,
            type: 'string',
          },
        },
        required: ['text'],
        type: 'object',
      },
      maxItems: 8,
      type: 'array',
    },
  },
  required: ['observations'],
  type: 'object',
} as const

const resolveObserverTarget = (
  context: CommandContext,
  run: RunRecord,
): {
  model?: string
  modelAlias?: string
  provider?: AiProviderName
} => {
  const snapshot = run.configSnapshot
  const provider =
    snapshot.provider === 'openai' ||
    snapshot.provider === 'google' ||
    snapshot.provider === 'openrouter'
      ? snapshot.provider
      : context.config.ai.defaults.provider
  const model =
    typeof snapshot.model === 'string' && snapshot.model.length > 0 ? snapshot.model : undefined
  const modelAlias =
    typeof snapshot.modelAlias === 'string' && snapshot.modelAlias.length > 0
      ? snapshot.modelAlias
      : undefined

  return {
    model,
    modelAlias,
    provider,
  }
}

export const estimateObservationTokenCount = (content: ObservationMemoryContent): number =>
  estimateMessageTokens({
    content: [toTextContent(content.observations.map((item) => item.text).join('\n\n'))],
    role: 'developer',
  })

const toObservationBlock = (
  item: ObservationMemoryContent['observations'][number],
  index: number,
): string => [`Observation ${index + 1}:`, item.text].join('\n')

export const formatObservationMemoryText = (content: ObservationMemoryContent): string =>
  [
    'Durable observations from earlier sealed main-thread context:',
    ...content.observations.map(toObservationBlock),
  ].join('\n\n')

export const observeSummary = async (
  context: CommandContext,
  run: RunRecord,
  summary: ContextSummaryRecord,
): Promise<Result<ObservationMemoryContent | null, DomainError>> => {
  const target = resolveObserverTarget(context, run)
  const response = await context.services.ai.interactions.generate({
    maxOutputTokens: 300,
    messages: [
      {
        content: [toTextContent(OBSERVER_PROMPT)],
        role: 'developer',
      },
      {
        content: [
          toTextContent(
            [
              'Extract durable run-local observations from this sealed main-thread summary.',
              `Run tool profile: ${run.toolProfileId ?? 'none'}`,
              `Summary range: ${summary.fromSequence}-${summary.throughSequence}`,
              'Summary:',
              summary.content,
            ].join('\n\n'),
          ),
        ],
        role: 'user',
      },
    ],
    metadata: {
      runId: run.id,
      stage: 'observer',
      summaryId: summary.id,
    },
    model: target.model,
    modelAlias: target.modelAlias,
    provider: target.provider,
    reasoning: {
      effort: 'none',
    },
    responseFormat: {
      name: 'run_local_observations',
      schema: observerResponseJsonSchema as unknown as Record<string, unknown>,
      strict: true,
      type: 'json_schema',
    },
    temperature: 0,
  })

  if (!response.ok) {
    return response
  }

  const outputText = normalizeAssistantOutputText(response.value)
  let parsedJson: unknown

  try {
    parsedJson = JSON.parse(outputText)
  } catch (error) {
    return err({
      message: error instanceof Error ? error.message : 'Observer output was not valid JSON',
      type: 'validation',
    })
  }

  const parsed = observerResponseSchema.safeParse(parsedJson)

  if (!parsed.success) {
    return err({
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  if (parsed.data.observations.length === 0) {
    return ok(null)
  }

  return ok({
    observations: parsed.data.observations,
    source: 'observer_v1',
  })
}
