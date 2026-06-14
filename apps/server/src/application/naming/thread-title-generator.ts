import { z } from 'zod'
import type { AiProviderName } from '../../domain/ai/types'
import type { RunRecord } from '../../domain/runtime/run-repository'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import type { CommandContext } from '../commands/command-context'
import { toTextContent } from '../interactions/build-run-interaction-request'
import { normalizeAssistantOutputText } from '../interactions/normalize-interaction-response'
import { THREAD_TITLE_PROMPT } from './thread-title-prompt'

const threadTitleResponseSchema = z.object({
  title: z.string().trim().min(1).max(120),
})

const threadTitleResponseJsonSchema = {
  additionalProperties: false,
  properties: {
    title: {
      maxLength: 120,
      minLength: 1,
      type: 'string',
    },
  },
  required: ['title'],
  type: 'object',
} as const

const resolveTitleTarget = (
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

const sanitizeGeneratedTitle = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
    .replace(/[.!?。]+$/u, '')
    .slice(0, 80)
    .trim()

export const generateThreadTitle = async (
  context: CommandContext,
  run: RunRecord,
  sampledSourceText: string,
): Promise<Result<string, DomainError>> => {
  const target = resolveTitleTarget(context, run)
  const response = await context.services.ai.interactions.generate({
    maxOutputTokens: 80,
    messages: [
      {
        content: [toTextContent(THREAD_TITLE_PROMPT)],
        role: 'developer',
      },
      {
        content: [
          toTextContent(
            ['Create a concise title for this conversation excerpt:', '', sampledSourceText].join(
              '\n',
            ),
          ),
        ],
        role: 'user',
      },
    ],
    metadata: {
      runId: run.id,
      stage: 'thread_title',
      ...(run.threadId ? { threadId: run.threadId } : {}),
    },
    model: target.model,
    modelAlias: target.modelAlias,
    provider: target.provider,
    reasoning: {
      effort: 'none',
    },
    responseFormat: {
      name: 'thread_title',
      schema: threadTitleResponseJsonSchema as unknown as Record<string, unknown>,
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
      message: error instanceof Error ? error.message : 'Thread title output was not valid JSON',
      type: 'validation',
    })
  }

  const parsed = threadTitleResponseSchema.safeParse(parsedJson)

  if (!parsed.success) {
    return err({
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
      type: 'validation',
    })
  }

  const sanitizedTitle = sanitizeGeneratedTitle(parsed.data.title)

  if (!sanitizedTitle) {
    return err({
      message: 'Thread title generation returned an empty title',
      type: 'validation',
    })
  }

  return ok(sanitizedTitle)
}
