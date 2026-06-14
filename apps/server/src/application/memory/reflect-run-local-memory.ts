import { z } from 'zod'
import type { AiProviderName } from '../../domain/ai/types'
import type {
  MemoryRecordRecord,
  ObservationMemoryContent,
  ReflectionMemoryContent,
} from '../../domain/memory/memory-record-repository'
import type { RunRecord } from '../../domain/runtime/run-repository'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import type { CommandContext } from '../commands/command-context'
import { toTextContent } from '../interactions/build-run-interaction-request'
import { estimateMessageTokens } from '../interactions/context-bundle'
import { normalizeAssistantOutputText } from '../interactions/normalize-interaction-response'
import { resolveContextWindowForModel } from '../system/models-catalog'
import { REFLECTOR_PROMPT } from './reflector-prompt'

const reflectorResponseSchema = z.object({
  reflection: z.string().trim().min(1).max(1200),
})

const reflectorResponseJsonSchema = {
  additionalProperties: false,
  properties: {
    reflection: {
      maxLength: 1200,
      minLength: 1,
      type: 'string',
    },
  },
  required: ['reflection'],
  type: 'object',
} as const

const resolveReflectorTarget = (
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

export const shouldReflectRunLocalObservations = (
  observationSourceTokenThreshold: number,
  observationSourceTokenCount: number,
): boolean => {
  return observationSourceTokenCount >= observationSourceTokenThreshold
}

export const estimateReflectionTokenCount = (content: ReflectionMemoryContent): number =>
  estimateMessageTokens({
    content: [toTextContent(content.reflection)],
    role: 'developer',
  })

export const formatReflectionMemoryText = (content: ReflectionMemoryContent): string =>
  ['Compressed reflection from earlier run-local observations:', content.reflection].join('\n\n')

const toReflectionBlock = (record: MemoryRecordRecord): string => {
  const content = record.content as ReflectionMemoryContent

  return content.reflection
}

const toObservationBlocks = (record: MemoryRecordRecord): string[] => {
  const content = record.content as ObservationMemoryContent

  return content.observations.map((item, index) =>
    [`Observation ${index + 1}:`, item.text].join('\n'),
  )
}

const resolveReflectionSourceTokenThreshold = (context: CommandContext, run: RunRecord): number => {
  const configuredModel =
    typeof run.configSnapshot.model === 'string' && run.configSnapshot.model.length > 0
      ? run.configSnapshot.model
      : context.config.ai.defaults.model
  const contextWindow = resolveContextWindowForModel(configuredModel)

  return Math.max(1, Math.floor(contextWindow * context.config.memory.reflection.triggerRatio))
}

export const reflectRunLocalMemory = async (
  context: CommandContext,
  run: RunRecord,
  input: {
    latestReflection: MemoryRecordRecord | null
    observationSourceTokenCount: number
    observations: MemoryRecordRecord[]
  },
): Promise<Result<ReflectionMemoryContent | null, DomainError>> => {
  const reflectionSourceTokenThreshold = resolveReflectionSourceTokenThreshold(context, run)

  if (
    !shouldReflectRunLocalObservations(
      reflectionSourceTokenThreshold,
      input.observationSourceTokenCount,
    )
  ) {
    return ok(null)
  }

  const target = resolveReflectorTarget(context, run)
  const response = await context.services.ai.interactions.generate({
    maxOutputTokens: 400,
    messages: [
      {
        content: [toTextContent(REFLECTOR_PROMPT)],
        role: 'developer',
      },
      {
        content: [
          toTextContent(
            [
              'Compress these active run-local observations into one durable reflection.',
              `Run tool profile: ${run.toolProfileId ?? 'none'}`,
              input.latestReflection
                ? `Previous reflection generation: ${input.latestReflection.generation}`
                : 'Previous reflection generation: none',
              input.latestReflection
                ? ['Previous reflection:', toReflectionBlock(input.latestReflection)].join('\n')
                : 'Previous reflection: none',
              'Observations:',
              ...input.observations.flatMap(toObservationBlocks),
            ].join('\n\n'),
          ),
        ],
        role: 'user',
      },
    ],
    metadata: {
      runId: run.id,
      stage: 'reflector',
    },
    model: target.model,
    modelAlias: target.modelAlias,
    provider: target.provider,
    reasoning: {
      effort: 'none',
    },
    responseFormat: {
      name: 'run_local_reflection',
      schema: reflectorResponseJsonSchema as unknown as Record<string, unknown>,
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
      message: error instanceof Error ? error.message : 'Reflector output was not valid JSON',
      type: 'validation',
    })
  }

  const parsed = reflectorResponseSchema.safeParse(parsedJson)

  if (!parsed.success) {
    return err({
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  return ok({
    reflection: parsed.data.reflection,
    source: 'reflector_v1',
  })
}
