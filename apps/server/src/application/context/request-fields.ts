import type {
  AiInteractionRequest,
  AiMessage,
  AiProviderName,
  AiProviderNativeToolName,
  AiReasoningOptions,
} from '../../domain/ai/types'
import type { AgentMcpMode } from '../agents/agent-runtime-policy'
import type { RunInteractionOverrides } from '../interactions/build-run-interaction-request'
import { toTextContent } from '../interactions/build-run-interaction-request'
import type { ThreadContextData } from '../interactions/context-bundle'
import { buildInteractionToolingRequest } from '../interactions/interaction-tooling'
import type { ToolSpec } from '../tooling/tool-registry'
import type { ReadonlyDeep } from './contracts'

export type RequestFieldContext = ReadonlyDeep<Pick<ThreadContextData, 'run'>>

export type ThreadInteractionRequestFields = Pick<
  AiInteractionRequest,
  | 'allowParallelToolCalls'
  | 'maxOutputTokens'
  | 'metadata'
  | 'model'
  | 'modelAlias'
  | 'nativeTools'
  | 'provider'
  | 'reasoning'
  | 'temperature'
  | 'toolChoice'
  | 'tools'
>

export interface BuildThreadInteractionRequestFieldsInput {
  readonly activeTools: readonly ToolSpec[]
  readonly context: RequestFieldContext
  readonly mcpMode?: AgentMcpMode
  readonly nativeTools: readonly AiProviderNativeToolName[]
  readonly overrides: ReadonlyDeep<RunInteractionOverrides>
}

export const resolveRequestedProvider = (
  context: RequestFieldContext,
  overrides: ReadonlyDeep<RunInteractionOverrides>,
): AiProviderName | null => {
  if (overrides.provider) {
    return overrides.provider
  }

  const provider = context.run.configSnapshot.provider

  return provider === 'openai' || provider === 'google' || provider === 'openrouter'
    ? provider
    : null
}

export const resolveRequestedModel = (
  context: RequestFieldContext,
  overrides: ReadonlyDeep<RunInteractionOverrides>,
): string | undefined => {
  if (overrides.model) {
    return overrides.model
  }

  return typeof context.run.configSnapshot.model === 'string' &&
    context.run.configSnapshot.model.length > 0
    ? context.run.configSnapshot.model
    : undefined
}

export const resolveRequestedModelAlias = (
  context: RequestFieldContext,
  overrides: ReadonlyDeep<RunInteractionOverrides>,
): string | undefined => {
  if (overrides.modelAlias) {
    return overrides.modelAlias
  }

  return typeof context.run.configSnapshot.modelAlias === 'string' &&
    context.run.configSnapshot.modelAlias.length > 0
    ? context.run.configSnapshot.modelAlias
    : undefined
}

const isReasoningOptions = (value: unknown): value is AiReasoningOptions => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<AiReasoningOptions>

  return (
    candidate.effort === 'none' ||
    candidate.effort === 'minimal' ||
    candidate.effort === 'low' ||
    candidate.effort === 'medium' ||
    candidate.effort === 'high' ||
    candidate.effort === 'xhigh'
  )
}

export const resolveRequestedReasoning = (
  context: RequestFieldContext,
  overrides: ReadonlyDeep<RunInteractionOverrides>,
): AiReasoningOptions | undefined => {
  if (overrides.reasoning) {
    return overrides.reasoning
  }

  return isReasoningOptions(context.run.configSnapshot.reasoning)
    ? context.run.configSnapshot.reasoning
    : undefined
}

export const resolveRequestedMaxOutputTokens = (
  context: RequestFieldContext,
  overrides: ReadonlyDeep<RunInteractionOverrides>,
): number | undefined => {
  if (typeof overrides.maxOutputTokens === 'number') {
    return overrides.maxOutputTokens
  }

  return typeof context.run.configSnapshot.maxOutputTokens === 'number'
    ? context.run.configSnapshot.maxOutputTokens
    : undefined
}

export const resolveRequestedTemperature = (
  context: RequestFieldContext,
  overrides: ReadonlyDeep<RunInteractionOverrides>,
): number | undefined => {
  if (typeof overrides.temperature === 'number') {
    return overrides.temperature
  }

  return typeof context.run.configSnapshot.temperature === 'number'
    ? context.run.configSnapshot.temperature
    : undefined
}

export const toSortedActiveMcpToolNames = (activeTools: readonly ToolSpec[]): string[] =>
  activeTools
    .filter((tool) => tool.domain === 'mcp')
    .map((tool) => tool.name)
    .sort((left, right) => left.localeCompare(right))

export const toInteractionRequestMetadata = (
  context: RequestFieldContext['run'],
  activeMcpToolNames: readonly string[],
): Record<string, string> =>
  Object.fromEntries(
    Object.entries({
      ...(activeMcpToolNames.length > 0
        ? {
            mcpActiveToolCount: String(activeMcpToolNames.length),
          }
        : {}),
      runId: context.id,
      sessionId: context.sessionId,
      tenantId: context.tenantId,
      threadId: context.threadId,
      ...(context.toolProfileId ? { toolProfileId: context.toolProfileId } : {}),
      workspaceRef: context.workspaceRef,
    }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0,
    ),
  )

export const toFallbackTaskMessages = (context: RequestFieldContext): AiMessage[] => [
  {
    content: [toTextContent(context.run.task)],
    role: 'user',
  },
]

export const buildThreadInteractionRequestFields = ({
  activeTools,
  context,
  mcpMode = 'direct',
  nativeTools,
  overrides,
}: BuildThreadInteractionRequestFieldsInput): ThreadInteractionRequestFields => {
  const activeMcpToolNames = toSortedActiveMcpToolNames(activeTools)
  const provider = resolveRequestedProvider(context, overrides)

  return {
    ...buildInteractionToolingRequest([...activeTools], [...nativeTools], mcpMode),
    maxOutputTokens: resolveRequestedMaxOutputTokens(context, overrides),
    metadata: toInteractionRequestMetadata(context.run, activeMcpToolNames),
    model: resolveRequestedModel(context, overrides),
    modelAlias: resolveRequestedModelAlias(context, overrides),
    provider: provider ?? undefined,
    reasoning: resolveRequestedReasoning(context, overrides),
    temperature: resolveRequestedTemperature(context, overrides),
  }
}
