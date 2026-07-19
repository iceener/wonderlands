import type { Interactions } from '@google/genai'
import type {
  AiInteractionResponse,
  AiMessage,
  AiOutputItem,
  AiToolCall,
  AiUsage,
  AiWebSearchActivity,
  ResolvedAiInteractionRequest,
} from '../../../domain/ai/types'
import { dedupeStrings, dedupeWebReferences, toDomainFromUrl } from '../response-utils'

interface NormalizeGoogleResponseOptions {
  error?: {
    code?: string | null
    message?: string | null
  } | null
  steps?: Interactions.Step[]
}

interface GoogleAdapterIssue {
  code: string
  message: string
  status: 'failed'
  unsupportedContentTypes: string[]
}

type GoogleThoughtSummary = Array<{
  text: string
  type: 'summary_text'
}>

const getThoughtItemId = (signature: string | undefined, index: number): string =>
  signature?.trim() || `google_thought:${index}`

const normalizeStatus = (
  interaction: Interactions.Interaction,
): AiInteractionResponse['status'] => {
  switch (interaction.status) {
    case 'completed':
    case 'requires_action':
      return 'completed'
    case 'in_progress':
      return 'in_progress'
    case 'queued':
      return 'queued'
    case 'incomplete':
    case 'budget_exceeded':
      return 'incomplete'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'failed'
  }
}

const normalizeToolCall = (step: Interactions.FunctionCallStep, index: number): AiToolCall => ({
  arguments: step.arguments ?? null,
  argumentsJson: JSON.stringify(step.arguments ?? {}),
  callId: step.id || `${step.name || 'tool'}:${index}`,
  name: step.name || 'unknown_function',
})

export const mapUsage = (interaction: Interactions.Interaction): AiUsage | null => {
  if (!interaction.usage) {
    return null
  }

  return {
    cachedTokens: interaction.usage.total_cached_tokens ?? null,
    inputTokens: interaction.usage.total_input_tokens ?? null,
    outputTokens: interaction.usage.total_output_tokens ?? null,
    reasoningTokens: interaction.usage.total_thought_tokens ?? null,
    totalTokens: interaction.usage.total_tokens ?? null,
  }
}

const toThoughtSummary = (step: Interactions.ThoughtStep): GoogleThoughtSummary =>
  (step.summary ?? []).flatMap((item) =>
    item.type === 'text' && item.text.trim().length > 0
      ? [{ text: item.text, type: 'summary_text' as const }]
      : [],
  )

const flushAssistantMessage = (
  output: AiOutputItem[],
  textParts: Extract<AiMessage['content'][number], { type: 'text' }>[],
): void => {
  if (textParts.length === 0) {
    return
  }

  const flushedTextParts = textParts.splice(0, textParts.length)

  output.push({
    content: flushedTextParts,
    role: 'assistant',
    type: 'message',
  })
}

const toModelOutputContent = (step: Interactions.Step): Interactions.Content[] =>
  step.type === 'model_output' && Array.isArray(step.content) ? step.content : []

const toTextAnnotations = (content: Interactions.Content): Interactions.Annotation[] =>
  content.type === 'text' && Array.isArray(content.annotations) ? content.annotations : []

const readTextValue = (content: Interactions.Content): string =>
  content.type === 'text' && typeof content.text === 'string' ? content.text : ''

const normalizeWebSearches = (
  interaction: Interactions.Interaction,
  steps: Interactions.Step[],
): AiWebSearchActivity[] => {
  const queries = dedupeStrings(
    steps.flatMap((step) =>
      step.type === 'google_search_call' ? (step.arguments.queries ?? []) : [],
    ),
  )
  const references = dedupeWebReferences(
    steps.flatMap((step) =>
      toModelOutputContent(step).flatMap((content) =>
        toTextAnnotations(content).flatMap((annotation) => {
          if (annotation.type !== 'url_citation' || typeof annotation.url !== 'string') {
            return []
          }

          return [
            {
              domain: toDomainFromUrl(annotation.url),
              title: annotation.title ?? null,
              url: annotation.url,
            },
          ]
        }),
      ),
    ),
  )
  const hasSearchOutput =
    queries.length > 0 ||
    references.length > 0 ||
    steps.some((step) => step.type === 'google_search_call' || step.type === 'google_search_result')

  if (!hasSearchOutput) {
    return []
  }

  return [
    {
      id: interaction.id ? `web_search:${interaction.id}` : 'web_search:google',
      patterns: [],
      provider: 'google',
      queries,
      references,
      responseId: interaction.id ?? null,
      status:
        interaction.status === 'failed'
          ? 'failed'
          : interaction.status === 'in_progress'
            ? 'searching'
            : 'completed',
      targetUrls: [],
    },
  ]
}

interface GoogleTerminalIssue {
  code?: string | null
  message: string
  status: Extract<AiInteractionResponse['status'], 'failed' | 'incomplete' | 'cancelled'>
}

const detectUnsupportedOutputContent = (steps: Interactions.Step[]): GoogleAdapterIssue | null => {
  const unsupportedContentTypes = new Set<string>()

  for (const step of steps) {
    switch (step.type) {
      case 'user_input':
      case 'function_call':
      case 'function_result':
      case 'google_search_call':
      case 'google_search_result':
        continue
      case 'model_output': {
        for (const content of step.content ?? []) {
          if (content.type !== 'text') {
            unsupportedContentTypes.add(content.type)
          }
        }

        continue
      }
      case 'thought': {
        const unsupportedSummaryTypes = (step.summary ?? [])
          .map((item) => item.type)
          .filter((type) => type !== 'text')

        for (const type of unsupportedSummaryTypes) {
          unsupportedContentTypes.add(`thought.summary:${type}`)
        }

        continue
      }
      default:
        unsupportedContentTypes.add(step.type)
        continue
    }
  }

  if (unsupportedContentTypes.size === 0) {
    return null
  }

  const sortedTypes = [...unsupportedContentTypes].sort()

  return {
    code: 'unsupported_output_content',
    message: `Google Interactions adapter does not support output content types: ${sortedTypes.join(', ')}`,
    status: 'failed',
    unsupportedContentTypes: sortedTypes,
  }
}

const toTerminalIssue = (
  _interaction: Interactions.Interaction,
  status: AiInteractionResponse['status'],
  options: NormalizeGoogleResponseOptions,
): GoogleTerminalIssue | null => {
  if (status === 'completed' || status === 'in_progress' || status === 'queued') {
    return null
  }

  const explicitMessage = options.error?.message?.trim()

  if (explicitMessage) {
    return {
      code: options.error?.code ?? null,
      message: explicitMessage,
      status,
    }
  }

  switch (status) {
    case 'failed':
      return {
        code: null,
        message: 'Google GenAI interaction failed.',
        status,
      }
    case 'incomplete':
      return {
        code: null,
        message: 'Google GenAI interaction completed incompletely.',
        status,
      }
    case 'cancelled':
      return {
        code: null,
        message: 'Google GenAI interaction was cancelled.',
        status,
      }
  }
}

export const normalizeResponse = (
  request: ResolvedAiInteractionRequest,
  interaction: Interactions.Interaction,
  options: NormalizeGoogleResponseOptions = {},
): AiInteractionResponse => {
  const outputSteps = options.steps ?? interaction.steps ?? []
  const adapterIssue = detectUnsupportedOutputContent(outputSteps)
  const output: AiOutputItem[] = []
  const toolCalls: AiToolCall[] = []
  const pendingTextParts: Extract<AiMessage['content'][number], { type: 'text' }>[] = []
  let outputText = ''

  for (const [index, step] of outputSteps.entries()) {
    if (step.type === 'function_call') {
      flushAssistantMessage(output, pendingTextParts)
      const toolCall = normalizeToolCall(step, index)
      toolCalls.push(toolCall)
      output.push({
        ...toolCall,
        type: 'function_call',
      })
      continue
    }

    if (step.type === 'thought') {
      flushAssistantMessage(output, pendingTextParts)
      const summary = toThoughtSummary(step)
      const text = summary
        .map((part) => part.text)
        .join('')
        .trim()

      output.push({
        id: getThoughtItemId(step.signature, index),
        summary,
        ...(text ? { text } : {}),
        thought: true,
        type: 'reasoning',
      })
      continue
    }

    if (step.type !== 'model_output') {
      continue
    }

    for (const content of step.content ?? []) {
      const text = readTextValue(content)

      if (text.length === 0) {
        continue
      }

      pendingTextParts.push({
        text,
        type: 'text',
      })
      outputText += text
    }
  }

  flushAssistantMessage(output, pendingTextParts)

  const messages = output
    .filter((item): item is Extract<AiOutputItem, { type: 'message' }> => item.type === 'message')
    .map((item) => ({
      content: item.content,
      role: 'assistant' as const,
    }))
  const status = adapterIssue ? adapterIssue.status : normalizeStatus(interaction)
  const terminalIssue = adapterIssue ?? toTerminalIssue(interaction, status, options)

  return {
    messages,
    model: interaction.model ?? request.model,
    output,
    outputText,
    provider: 'google',
    providerRequestId: null,
    raw:
      terminalIssue || options.error
        ? {
            error: {
              code: adapterIssue?.code ?? terminalIssue?.code ?? options.error?.code ?? null,
              message: terminalIssue?.message ?? options.error?.message ?? null,
              status: interaction.status,
            },
            ...(adapterIssue
              ? { unsupportedOutputContentTypes: adapterIssue.unsupportedContentTypes }
              : {}),
            interaction,
          }
        : interaction,
    responseId: interaction.id ?? null,
    status: terminalIssue?.status ?? status,
    toolCalls,
    usage: mapUsage(interaction),
    webSearches: normalizeWebSearches(interaction, outputSteps),
  }
}
