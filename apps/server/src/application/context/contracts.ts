import type { AiMessage, AiProviderNativeToolName } from '../../domain/ai/types'
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

/** Pure, synchronous transformation from an immutable assembly snapshot. */
export interface ContextContributor {
  readonly id: string
  readonly order: number
  readonly build: (input: ContextContributorInput) => readonly ContextContribution[]
}
