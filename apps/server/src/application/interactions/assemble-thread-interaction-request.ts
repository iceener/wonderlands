import type { ToolSpec } from '../../application/tooling/tool-registry'
import type {
  AiInteractionRequest,
  AiMessage,
  AiProviderNativeToolName,
} from '../../domain/ai/types'
import type { AgentMcpMode } from '../agents/agent-runtime-policy'
import { buildContextArtifacts, projectContextArtifactMessages } from '../context/artifacts'
import type { ContextArtifact, ContextContributorInput } from '../context/contracts'
import { buildContextManifest, type ContextManifest } from '../context/manifest'
import { type ContextPolicyDecision, evaluateContextArtifactsPolicy } from '../context/policy'
import { contextContributors } from '../context/registry'
import { buildRequestContextArtifacts } from '../context/request-artifacts'
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
  readonly artifacts: readonly ContextArtifact[]
  bundle: ThreadContextBundle
  readonly manifest: ContextManifest
  readonly policyDecisions: readonly ContextPolicyDecision[]
  request: AiInteractionRequest
}

const CONTEXT_ASSEMBLER_VERSION = 'context-assembly/v2-shadow-1'
const UNSPECIFIED_CONTEXT_PROVIDER = 'provider-unspecified'
const UNSPECIFIED_CONTEXT_MODEL = 'model-unspecified'

/**
 * Durable runs without a thread use this sentinel only in shadow-manifest coordinates. It is never
 * projected into request metadata, messages, the context bundle, or any persisted run field.
 */
export const UNTHREADED_CONTEXT_MANIFEST_THREAD_ID = 'thread-unavailable'

const sumArtifactTokens = (artifacts: readonly ContextArtifact[]): number =>
  artifacts.reduce((total, artifact) => total + artifact.estimatedTokens, 0)

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
  // Contributors execute exactly once. Their strict artifacts are projected back to the legacy
  // contribution shape so shadow metadata cannot alter layer order or provider-visible messages.
  const messageArtifacts = buildContextArtifacts(contextContributors, contributorInput, {
    validationMode: 'strict',
  })
  const layers = projectContextArtifactMessages(messageArtifacts).map(
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
  const artifacts = Object.freeze([
    ...messageArtifacts,
    ...buildRequestContextArtifacts(requestFields, contributorInput),
  ])
  const policyDecisions = evaluateContextArtifactsPolicy(artifacts, {
    now: context.run.updatedAt,
    validationMode: 'strict',
  })
  const selectedArtifacts = artifacts.filter(
    (_artifact, index) => policyDecisions[index]?.outcome === 'allow',
  )
  const rejectedArtifacts = artifacts.flatMap((artifact, index) =>
    policyDecisions[index]?.outcome === 'reject'
      ? [{ artifact, reasonCodes: ['policy_rejected' as const] }]
      : [],
  )
  const selectedArtifactTokens = sumArtifactTokens(selectedArtifacts)
  const consideredArtifactTokens = sumArtifactTokens(artifacts)
  const manifest = buildContextManifest({
    assemblerVersion: CONTEXT_ASSEMBLER_VERSION,
    budget: {
      availableInputTokens: null,
      consideredArtifactTokens,
      droppedArtifactTokens: consideredArtifactTokens - selectedArtifactTokens,
      inputTokenLimit: null,
      reservedOutputTokens: bundle.budget.reservedOutputTokens,
      selectedArtifactTokens,
    },
    generatedAt: context.run.updatedAt,
    model: request.model?.trim() || UNSPECIFIED_CONTEXT_MODEL,
    provider: request.provider ?? UNSPECIFIED_CONTEXT_PROVIDER,
    rejected: rejectedArtifacts,
    runId: String(context.run.id),
    selectedArtifacts,
    threadId: context.run.threadId
      ? String(context.run.threadId)
      : UNTHREADED_CONTEXT_MANIFEST_THREAD_ID,
    turn: context.run.turnCount + 1,
  })

  return {
    artifacts,
    bundle,
    manifest,
    policyDecisions,
    request,
  }
}
