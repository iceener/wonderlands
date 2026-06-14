import type {
  AiInteractionRequest,
  AiMessage,
  AiProviderName,
  AiProviderNativeToolName,
  AiReasoningOptions,
} from '../../domain/ai/types'
import type {
  ObservationMemoryContent,
  ReflectionMemoryContent,
} from '../../domain/memory/memory-record-repository'
import type { ToolSpec } from '../../domain/tooling/tool-registry'
import type { AgentMcpMode } from '../agents/agent-runtime-policy'
import { toFileContextMessages } from '../files/file-context'
import { formatGardenContextDeveloperMessage } from '../garden/garden-agent-context'
import { formatMcpCodeModeInventoryMessage, type McpCodeModeCatalog } from '../mcp/code-mode'
import { formatObservationMemoryText } from '../memory/observe-summary'
import { formatReflectionMemoryText } from '../memory/reflect-run-local-memory'
import {
  isJustBashAvailableInSandbox,
  resolveAttachmentRefAccessModeForCapabilities,
  resolveInteractionCapabilities,
} from './attachment-ref-access'
import {
  formatAttachmentRefContextDeveloperMessage,
  formatAttachmentRefRulesDeveloperMessage,
} from './attachment-ref-prompt'
import {
  type RunInteractionOverrides,
  toItemMessages,
  toTextContent,
  toVisibleMessages,
} from './build-run-interaction-request'
import { formatCapabilityGuidanceDeveloperMessage } from './capability-prompt'
import {
  createContextBudgetReport,
  createContextLayer,
  type ThreadContextBundle,
  type ThreadContextData,
} from './context-bundle'
import { buildInteractionToolingRequest } from './interaction-tooling'
import { collectInlineReferencedUploadedFileIds } from './model-visible-user-content'

export interface AssembleThreadInteractionRequestInput {
  activeTools: ToolSpec[]
  context: ThreadContextData
  mcpCatalog?: McpCodeModeCatalog | null
  mcpMode?: AgentMcpMode
  nativeTools: AiProviderNativeToolName[]
  overrides: RunInteractionOverrides
}

export interface AssembleThreadInteractionRequestResult {
  bundle: ThreadContextBundle
  request: AiInteractionRequest
}

const toMetadata = (
  context: ThreadContextData['run'],
  activeMcpToolNames: string[],
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

const toFallbackMessages = (context: ThreadContextData): AiMessage[] => [
  {
    content: [toTextContent(context.run.task)],
    role: 'user',
  },
]

const toSummaryMessages = (context: ThreadContextData): AiMessage[] =>
  context.summary
    ? [
        {
          content: [toTextContent(context.summary.content)],
          role: 'developer',
        },
      ]
    : []

const toAgentProfileMessages = (context: ThreadContextData): AiMessage[] => {
  if (!context.agentProfile) {
    return []
  }

  const sections: string[] = []
  const instructions = context.agentProfile.instructionsMd.trim()

  if (instructions.length > 0) {
    sections.push(['Instructions:', instructions].join('\n'))
  }

  if (context.agentProfile.subagents.length > 0) {
    const subagentBlocks = context.agentProfile.subagents.map((subagent) => {
      const toolLine =
        subagent.tools.length > 0
          ? `  tools: ${subagent.tools.map((tool) => tool.name).join(', ')}`
          : '  tools: none configured'

      return [
        `- alias: ${subagent.alias}`,
        `  name: ${subagent.childName ?? 'unnamed'}`,
        ...(subagent.childDescription ? [`  description: ${subagent.childDescription}`] : []),
        toolLine,
      ].join('\n')
    })

    sections.push(
      [
        'Allowed subagents for this run. Use the alias value as agentAlias when calling delegate_to_agent.',
        'If a delegated child returns kind="suspended", this run stays responsible for orchestration. Gather the missing input yourself, then call resume_delegated_run with the returned childRunId and waitId.',
        subagentBlocks.join('\n\n'),
      ].join('\n\n'),
    )
  }

  if (sections.length === 0) {
    return []
  }

  return [
    {
      content: [toTextContent(sections.join('\n\n'))],
      role: 'developer',
    },
  ]
}

const toObservationMessages = (context: ThreadContextData): AiMessage[] =>
  context.observations.map((record) => ({
    content: [
      toTextContent(formatObservationMemoryText(record.content as ObservationMemoryContent)),
    ],
    role: 'developer',
  }))

const toReflectionMessages = (context: ThreadContextData): AiMessage[] =>
  context.activeReflection
    ? [
        {
          content: [
            toTextContent(
              formatReflectionMemoryText(
                context.activeReflection.content as ReflectionMemoryContent,
              ),
            ),
          ],
          role: 'developer',
        },
      ]
    : []

const toActiveMcpToolMessages = (
  mcpMode: AgentMcpMode,
  catalog: McpCodeModeCatalog | null | undefined,
): AiMessage[] => {
  if (mcpMode !== 'code') {
    return []
  }

  const text = formatMcpCodeModeInventoryMessage(
    catalog ?? {
      servers: [],
      tools: [],
    },
  )

  return text
    ? [
        {
          content: [toTextContent(text)],
          role: 'developer',
        },
      ]
    : []
}

const toCapabilityMessages = (
  capabilities: ReturnType<typeof resolveInteractionCapabilities>,
): AiMessage[] => {
  const text = formatCapabilityGuidanceDeveloperMessage(capabilities)

  return text
    ? [
        {
          content: [toTextContent(text)],
          role: 'developer',
        },
      ]
    : []
}

const toGardenMessages = (
  context: ThreadContextData,
  capabilities: ReturnType<typeof resolveInteractionCapabilities>,
  hasGardenContextTool: boolean,
): AiMessage[] => {
  const accessMode = resolveAttachmentRefAccessModeForCapabilities(capabilities)
  const text = formatGardenContextDeveloperMessage(context.gardenContext, {
    includeExecuteHint: capabilities.sandboxExecute,
    includeToolHint: hasGardenContextTool,
    includeSandboxHint: accessMode === 'sandbox',
    includeJustBashHint: accessMode === 'sandbox' && isJustBashAvailableInSandbox(),
  })

  return text
    ? [
        {
          content: [toTextContent(text)],
          role: 'developer',
        },
      ]
    : []
}

const toAttachmentRefRuleMessages = (
  context: ThreadContextData,
  capabilities: ReturnType<typeof resolveInteractionCapabilities>,
): AiMessage[] => {
  const accessMode = resolveAttachmentRefAccessModeForCapabilities(capabilities)
  const text = formatAttachmentRefRulesDeveloperMessage(context.attachmentRefs, {
    accessMode,
    includeExecuteHint: capabilities.sandboxExecute,
    includeGenerateImageHint: capabilities.generateImage,
    includeJustBashHint: accessMode === 'sandbox' && isJustBashAvailableInSandbox(),
  })

  return text
    ? [
        {
          content: [toTextContent(text)],
          role: 'developer',
        },
      ]
    : []
}

const toAttachmentRefContextMessages = (
  context: ThreadContextData,
  capabilities: ReturnType<typeof resolveInteractionCapabilities>,
): AiMessage[] => {
  const accessMode = resolveAttachmentRefAccessModeForCapabilities(capabilities)
  const text = formatAttachmentRefContextDeveloperMessage(context.attachmentRefs, {
    accessMode,
    includeExecuteHint: capabilities.sandboxExecute,
    includeGenerateImageHint: capabilities.generateImage,
    includeJustBashHint: accessMode === 'sandbox' && isJustBashAvailableInSandbox(),
  })

  return text
    ? [
        {
          content: [toTextContent(text)],
          role: 'developer',
        },
      ]
    : []
}

const resolveRequestedProvider = (
  context: ThreadContextData,
  overrides: RunInteractionOverrides,
): AiProviderName | null => {
  if (overrides.provider) {
    return overrides.provider
  }

  const provider = context.run.configSnapshot.provider

  return provider === 'openai' || provider === 'google' || provider === 'openrouter'
    ? provider
    : null
}

const resolveRequestedModel = (
  context: ThreadContextData,
  overrides: RunInteractionOverrides,
): string | undefined => {
  if (overrides.model) {
    return overrides.model
  }

  return typeof context.run.configSnapshot.model === 'string' &&
    context.run.configSnapshot.model.length > 0
    ? context.run.configSnapshot.model
    : undefined
}

const resolveRequestedModelAlias = (
  context: ThreadContextData,
  overrides: RunInteractionOverrides,
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

const resolveRequestedReasoning = (
  context: ThreadContextData,
  overrides: RunInteractionOverrides,
): AiReasoningOptions | undefined => {
  if (overrides.reasoning) {
    return overrides.reasoning
  }

  return isReasoningOptions(context.run.configSnapshot.reasoning)
    ? context.run.configSnapshot.reasoning
    : undefined
}

const resolveRequestedMaxOutputTokens = (
  context: ThreadContextData,
  overrides: RunInteractionOverrides,
): number | undefined => {
  if (typeof overrides.maxOutputTokens === 'number') {
    return overrides.maxOutputTokens
  }

  return typeof context.run.configSnapshot.maxOutputTokens === 'number'
    ? context.run.configSnapshot.maxOutputTokens
    : undefined
}

const resolveRequestedTemperature = (
  context: ThreadContextData,
  overrides: RunInteractionOverrides,
): number | undefined => {
  if (typeof overrides.temperature === 'number') {
    return overrides.temperature
  }

  return typeof context.run.configSnapshot.temperature === 'number'
    ? context.run.configSnapshot.temperature
    : undefined
}

export const assembleThreadInteractionRequest = ({
  activeTools,
  context,
  mcpCatalog = null,
  mcpMode = 'direct',
  nativeTools,
  overrides,
}: AssembleThreadInteractionRequestInput): AssembleThreadInteractionRequestResult => {
  const capabilities = resolveInteractionCapabilities(activeTools)
  const hasGardenContextTool = activeTools.some((tool) => tool.name === 'get_garden_context')
  const accessMode = resolveAttachmentRefAccessModeForCapabilities(capabilities)
  const provider = resolveRequestedProvider(context, overrides)
  const maxOutputTokens = resolveRequestedMaxOutputTokens(context, overrides)
  const runTranscriptMessages = toItemMessages(context.items, { provider })
  const inlineReferencedFileIds = collectInlineReferencedUploadedFileIds(context.visibleMessages)
  const activeMcpToolNames = activeTools
    .filter((tool) => tool.domain === 'mcp')
    .map((tool) => tool.name)
    .sort((left, right) => left.localeCompare(right))
  const layers = [
    createContextLayer('system_prompt', 'stable', []),
    createContextLayer('agent_profile', 'stable', toAgentProfileMessages(context)),
    createContextLayer('capability_guidance', 'stable', toCapabilityMessages(capabilities)),
    createContextLayer(
      'garden_context',
      'stable',
      toGardenMessages(context, capabilities, hasGardenContextTool),
    ),
    createContextLayer(
      'attachment_ref_rules',
      'stable',
      toAttachmentRefRuleMessages(context, capabilities),
    ),
    createContextLayer('tool_context', 'stable', toActiveMcpToolMessages(mcpMode, mcpCatalog)),
    createContextLayer('session_metadata', 'stable', []),
    createContextLayer('summary_memory', 'stable', toSummaryMessages(context)),
    createContextLayer('run_local_memory', 'stable', toReflectionMessages(context)),
    createContextLayer('run_local_memory', 'stable', toObservationMessages(context)),
    createContextLayer('run_transcript', 'volatile', runTranscriptMessages),
    createContextLayer(
      'visible_message_history',
      'volatile',
      runTranscriptMessages.length === 0 && !context.summary
        ? toVisibleMessages(context.visibleMessages, context.visibleFiles)
        : [],
    ),
    createContextLayer(
      'attachment_ref_context',
      'volatile',
      toAttachmentRefContextMessages(context, capabilities),
    ),
    createContextLayer(
      'file_context',
      'volatile',
      toFileContextMessages(context.visibleFiles, provider, inlineReferencedFileIds, accessMode),
    ),
    createContextLayer('pending_waits', 'volatile', []),
  ]
  const assembledMessages = layers.flatMap((layer) => layer.messages)
  const requestMessages =
    assembledMessages.length > 0 ? assembledMessages : toFallbackMessages(context)
  const request: AiInteractionRequest = {
    ...buildInteractionToolingRequest(activeTools, nativeTools, mcpMode),
    maxOutputTokens,
    messages: requestMessages,
    metadata: toMetadata(context.run, activeMcpToolNames),
    model: resolveRequestedModel(context, overrides),
    modelAlias: resolveRequestedModelAlias(context, overrides),
    provider: provider ?? undefined,
    reasoning: resolveRequestedReasoning(context, overrides),
    temperature: resolveRequestedTemperature(context, overrides),
  }
  const bundle: ThreadContextBundle = {
    ...context,
    budget: createContextBudgetReport(layers, maxOutputTokens ?? null, request),
    layers,
  }

  return {
    bundle,
    request,
  }
}
