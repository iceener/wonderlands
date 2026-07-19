import type {
  AiInteractionRequest,
  AiMessage,
  AiProviderNativeToolName,
  AiToolDefinition,
} from '../../domain/ai/types'
import type { AgentMcpMode } from '../agents/agent-runtime-policy'
import type { RunInteractionOverrides } from '../interactions/build-run-interaction-request'
import type {
  ContextLayerKind,
  ContextLayerVolatility,
  ThreadContextData,
} from '../interactions/context-bundle'
import type { McpCodeModeCatalog } from '../mcp/code-mode'
import type { ToolSpec } from '../tooling/tool-registry'

export type ReadonlyDeep<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer TValue)[]
    ? readonly ReadonlyDeep<TValue>[]
    : T extends object
      ? { readonly [TKey in keyof T]: ReadonlyDeep<T[TKey]> }
      : T

/**
 * Compatibility input for extracting today's context assembly into pure contributors.
 * It deliberately carries current facts and explicit request inputs rather than v2 artifacts.
 */
export interface ContextContributorInput {
  readonly activeTools: readonly ReadonlyDeep<ToolSpec>[]
  readonly context: ReadonlyDeep<ThreadContextData>
  readonly mcpCatalog: ReadonlyDeep<McpCodeModeCatalog> | null
  readonly mcpMode: AgentMcpMode
  readonly nativeTools: readonly AiProviderNativeToolName[]
  readonly overrides: ReadonlyDeep<RunInteractionOverrides>
}

/** A provider-neutral message layer compatible with the current assembler. */
export interface ContextContribution {
  readonly kind: ContextLayerKind
  readonly messages: readonly ReadonlyDeep<AiMessage>[]
  readonly volatility: ContextLayerVolatility
}

export type ContextArtifactVisibility = 'model' | 'request'
export type ContextArtifactSensitivity = 'public' | 'private' | 'restricted' | 'secret'
export type ContextArtifactRequirement = 'mandatory' | 'preferred' | 'optional'

/** Semantic authority; precedence is intentionally delegated to the future policy layer. */
export type ContextAuthority =
  | 'platform'
  | 'user_correction'
  | 'authoritative_integration'
  | 'user_input'
  | 'tool_result'
  | 'agent_configuration'
  | 'conversation'
  | 'user_preference'
  | 'reflection'
  | 'observation'
  | 'summary'
  | 'inferred'
  | 'legacy'

export type ContextProvenanceSourceType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_result'
  | 'agent_revision'
  | 'memory_summary'
  | 'memory_observation'
  | 'memory_reflection'
  | 'file'
  | 'garden'
  | 'integration'
  | 'runtime'
  | 'legacy_shadow'

export interface ContextProvenance {
  readonly sourceType: ContextProvenanceSourceType
  readonly sourceIds: readonly string[]
  readonly sourceVersion: string | null
  readonly createdByRunId: string | null
}

export type ContextArtifactTransformation =
  | { readonly kind: 'none' }
  | {
      readonly includedBytes: number
      readonly kind: 'truncated'
      readonly originalBytes: number
    }
  | {
      readonly kind: 'summarized'
      readonly sourceRefs: readonly string[]
      readonly summarizerVersion: string
    }
  | { readonly fields: readonly string[]; readonly kind: 'redacted' }

/**
 * Provider-neutral request controls excluding the payload families represented separately below.
 * AbortSignal is intentionally excluded because artifacts must be deterministic data.
 */
export type ContextRequestOptions = ReadonlyDeep<
  Omit<AiInteractionRequest, 'abortSignal' | 'messages' | 'metadata' | 'nativeTools' | 'tools'>
>

export type ContextArtifactPayload =
  | { readonly kind: 'messages'; readonly messages: readonly ReadonlyDeep<AiMessage>[] }
  | { readonly kind: 'tools'; readonly tools: readonly ReadonlyDeep<AiToolDefinition>[] }
  | {
      readonly kind: 'native_tools'
      readonly tools: readonly AiProviderNativeToolName[]
    }
  | { readonly kind: 'request_options'; readonly options: ContextRequestOptions }
  | { readonly kind: 'metadata'; readonly metadata: Readonly<Record<string, string>> }

/** Metadata supplied incrementally by a contributor's optional describe hook. */
export interface ContextArtifactMetadata {
  readonly authority: ContextAuthority
  readonly capturedAt: string
  readonly conflictKey: string | null
  readonly dedupeKey: string | null
  readonly dependencies: readonly string[]
  readonly expiresAt: string | null
  readonly priority: number
  readonly provenance: ContextProvenance
  readonly requirement: ContextArtifactRequirement
  readonly sensitivity: ContextArtifactSensitivity
  readonly supersedes: readonly string[]
  readonly transformation: ContextArtifactTransformation
  readonly visibility: ContextArtifactVisibility
}

export interface ContextArtifactDescriptionInput {
  readonly contribution: ContextContribution
  readonly contributionIndex: number
  readonly input: ContextContributorInput
}

/**
 * Shadow representation of one provider-neutral context payload. IDs and token estimates are
 * derived by the artifact builder, never supplied by a contributor.
 */
export interface ContextArtifact extends ContextArtifactMetadata {
  readonly estimatedTokens: number
  readonly id: string
  readonly layer: ContextLayerKind
  readonly metadataStatus: 'declared' | 'legacy_shadow'
  readonly payload: ContextArtifactPayload
  readonly volatility: ContextLayerVolatility
}

/** Pure, synchronous transformation from an immutable assembly snapshot. */
export interface ContextContributor {
  readonly id: string
  readonly order: number
  readonly build: (input: ContextContributorInput) => readonly ContextContribution[]
  /** Optional additive hook for migrating contributor provenance without changing build output. */
  readonly describe?: (input: ContextArtifactDescriptionInput) => ContextArtifactMetadata
}
