import type { ToolSpec } from '../../application/tooling/tool-registry'
import type {
  AiInteractionRequest,
  AiMessage,
  AiProviderNativeToolName,
} from '../../domain/ai/types'
import type { AgentMcpMode } from '../agents/agent-runtime-policy'
import type { ContextContributorInput } from '../context/contracts'
import { buildContextContributions, contextContributors } from '../context/registry'
import {
  buildThreadInteractionRequestFields,
  toFallbackTaskMessages,
} from '../context/request-fields'
import type { McpCodeModeCatalog } from '../mcp/code-mode'
import type { RunInteractionOverrides } from './build-run-interaction-request'
import {
  createContextBudgetReport,
  createContextLayer,
  type ThreadContextBundle,
  type ThreadContextData,
} from './context-bundle'

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

export const assembleThreadInteractionRequest = ({
  activeTools,
  context,
  mcpCatalog = null,
  mcpMode = 'direct',
  nativeTools,
  overrides,
}: AssembleThreadInteractionRequestInput): AssembleThreadInteractionRequestResult => {
  const contributorInput: ContextContributorInput = Object.freeze({
    activeTools,
    context,
    mcpCatalog,
    mcpMode,
    nativeTools,
    overrides,
  })
  const layers = buildContextContributions(contextContributors, contributorInput).map(
    ({ kind, messages, volatility }) =>
      createContextLayer(kind, volatility, messages as AiMessage[]),
  )
  const assembledMessages = layers.flatMap((layer) => layer.messages)
  const requestFields = buildThreadInteractionRequestFields({
    activeTools,
    context,
    mcpMode,
    nativeTools,
    overrides,
  })
  const request: AiInteractionRequest = {
    ...requestFields,
    messages: assembledMessages.length > 0 ? assembledMessages : toFallbackTaskMessages(context),
  }
  const bundle: ThreadContextBundle = {
    ...context,
    budget: createContextBudgetReport(layers, requestFields.maxOutputTokens ?? null, request),
    layers,
  }

  return {
    bundle,
    request,
  }
}
