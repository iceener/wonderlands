import type { AiToolDefinition } from '../../domain/ai/types'
import { createDeterministicContextArtifactId, validateContextArtifactMetadata } from './artifacts'
import type {
  ContextArtifact,
  ContextArtifactMetadata,
  ContextArtifactPayload,
  ContextContributorInput,
  ContextRequestOptions,
} from './contracts'
import type { ThreadInteractionRequestFields } from './request-fields'

const REQUEST_ARTIFACT_SOURCE_VERSION = 'request-artifacts/v1'
const REQUEST_ARTIFACT_VALIDATION_ID = 'request-artifacts'
const EXPLICIT_UNDEFINED = 'context-request-option/explicit-undefined'

const requestOptionKeys = [
  'allowParallelToolCalls',
  'maxOutputTokens',
  'model',
  'modelAlias',
  'provider',
  'reasoning',
  'temperature',
  'toolChoice',
] as const satisfies readonly (keyof ContextRequestOptions & keyof ThreadInteractionRequestFields)[]

type RequestOptionKey = (typeof requestOptionKeys)[number]

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  Object.freeze([...new Set(values)].sort(compareText))

const toRunConfigurationSourceIds = (input: ContextContributorInput): readonly string[] => {
  const run = input.context.run

  return uniqueSorted([
    `run:${String(run.id)}`,
    `run-version:${String(run.version)}`,
    ...(run.agentId ? [`agent:${String(run.agentId)}`] : []),
    ...(run.agentRevisionId ? [`agent-revision:${String(run.agentRevisionId)}`] : []),
    ...(run.toolProfileId ? [`tool-profile:${String(run.toolProfileId)}`] : []),
  ])
}

const toToolSourceIds = (
  tools: readonly AiToolDefinition[],
  input: ContextContributorInput,
): readonly string[] => {
  const emittedNames = new Set(tools.map((tool) => tool.name))
  const configuredToolIds = input.activeTools.flatMap((tool) =>
    emittedNames.has(tool.name) ? [`tool:${tool.domain}:${tool.name}`] : [],
  )

  return uniqueSorted([
    ...toRunConfigurationSourceIds(input),
    ...configuredToolIds,
    ...tools.map((tool) => `tool:${tool.name}`),
    `mcp-mode:${input.mcpMode}`,
  ])
}

const toNativeToolSourceIds = (
  tools: readonly string[],
  input: ContextContributorInput,
): readonly string[] =>
  uniqueSorted([
    ...toRunConfigurationSourceIds(input),
    ...tools.map((tool) => `native-tool:${tool}`),
  ])

const hasOwn = (value: object, key: PropertyKey): boolean => Object.hasOwn(value, key)

/** Keeps present `undefined` controls present while excluding payload families and AbortSignal. */
const toRequestOptions = (
  fields: Readonly<ThreadInteractionRequestFields>,
): ContextRequestOptions =>
  Object.freeze(
    Object.fromEntries(
      requestOptionKeys
        .filter((key) => hasOwn(fields, key))
        .map((key): [RequestOptionKey, unknown] => [key, fields[key]]),
    ),
  ) as ContextRequestOptions

const toRequestOptionsIdentity = (options: ContextRequestOptions): unknown =>
  Object.keys(options)
    .sort(compareText)
    .map((key) => {
      const value = (options as Readonly<Record<string, unknown>>)[key]

      return {
        key,
        value: value === undefined ? EXPLICIT_UNDEFINED : value,
      }
    })

const toNormalizedToolsIdentity = (tools: readonly AiToolDefinition[]): readonly unknown[] =>
  [...tools]
    .map((tool) => ({
      sortKey: `${tool.name}:${createDeterministicContextArtifactId(tool)}`,
      tool,
    }))
    .sort((left, right) => compareText(left.sortKey, right.sortKey))
    .map(({ tool }) => tool)

const estimatePayloadTokens = (payload: ContextArtifactPayload): number =>
  Math.ceil(JSON.stringify(payload).length / 4)

interface RequestArtifactDefinition {
  readonly authority: ContextArtifactMetadata['authority']
  readonly dedupeKey: string
  readonly identityPayload: unknown
  readonly layer: ContextArtifact['layer']
  readonly payload: ContextArtifactPayload
  readonly priority: number
  readonly requirement: ContextArtifactMetadata['requirement']
  readonly sensitivity: ContextArtifactMetadata['sensitivity']
  readonly sourceIds: readonly string[]
  readonly volatility: ContextArtifact['volatility']
}

const createRequestArtifact = (
  definition: RequestArtifactDefinition,
  input: ContextContributorInput,
): ContextArtifact => {
  const metadata: ContextArtifactMetadata = {
    authority: definition.authority,
    capturedAt: input.context.run.createdAt,
    conflictKey: null,
    dedupeKey: definition.dedupeKey,
    dependencies: Object.freeze([]),
    expiresAt: null,
    priority: definition.priority,
    provenance: Object.freeze({
      createdByRunId: String(input.context.run.id),
      sourceIds: uniqueSorted(definition.sourceIds),
      sourceType: 'runtime',
      sourceVersion: REQUEST_ARTIFACT_SOURCE_VERSION,
    }),
    requirement: definition.requirement,
    sensitivity: definition.sensitivity,
    supersedes: Object.freeze([]),
    transformation: Object.freeze({ kind: 'none' }),
    visibility: 'request',
  }

  validateContextArtifactMetadata(metadata, REQUEST_ARTIFACT_VALIDATION_ID)

  const artifactWithoutId: Omit<ContextArtifact, 'id'> = {
    ...metadata,
    estimatedTokens: estimatePayloadTokens(definition.payload),
    layer: definition.layer,
    metadataStatus: 'declared',
    payload: definition.payload,
    volatility: definition.volatility,
  }

  return Object.freeze({
    ...artifactWithoutId,
    id: createDeterministicContextArtifactId({
      artifact: {
        ...artifactWithoutId,
        payload: definition.identityPayload,
      },
      schemaVersion: 'context-artifact/v1',
    }),
  })
}

/**
 * Builds a shadow artifact view of the already-resolved provider-neutral request fields.
 *
 * Tool families and request controls are mandatory because dropping them can change execution.
 * Correlation metadata is preferred: it is operationally useful but does not change model
 * semantics. Tool configuration is stable; per-request options and identifiers are volatile.
 * Empty tools, native-tools, and metadata families are omitted. A request-options artifact is
 * emitted whenever an option property is present, including an explicitly present `undefined`.
 */
export const buildRequestContextArtifacts = (
  fields: Readonly<ThreadInteractionRequestFields>,
  input: ContextContributorInput,
): readonly ContextArtifact[] => {
  const artifacts: ContextArtifact[] = []
  const tools = fields.tools ?? []
  const nativeTools = fields.nativeTools ?? []
  const options = toRequestOptions(fields)
  const metadata = fields.metadata ?? {}
  const runConfigurationSourceIds = toRunConfigurationSourceIds(input)

  if (tools.length > 0) {
    const payload = Object.freeze({
      kind: 'tools' as const,
      tools: Object.freeze([...tools]),
    })
    artifacts.push(
      createRequestArtifact(
        {
          authority: 'agent_configuration',
          dedupeKey: 'request-tools',
          identityPayload: {
            kind: payload.kind,
            tools: toNormalizedToolsIdentity(payload.tools),
          },
          layer: 'tool_context',
          payload,
          priority: 100,
          requirement: 'mandatory',
          sensitivity: 'restricted',
          sourceIds: toToolSourceIds(payload.tools, input),
          volatility: 'stable',
        },
        input,
      ),
    )
  }

  if (nativeTools.length > 0) {
    const payload = Object.freeze({
      kind: 'native_tools' as const,
      tools: Object.freeze([...nativeTools]),
    })
    artifacts.push(
      createRequestArtifact(
        {
          authority: 'agent_configuration',
          dedupeKey: 'request-native-tools',
          identityPayload: {
            kind: payload.kind,
            tools: [...payload.tools].sort(compareText),
          },
          layer: 'tool_context',
          payload,
          priority: 100,
          requirement: 'mandatory',
          sensitivity: 'private',
          sourceIds: toNativeToolSourceIds(payload.tools, input),
          volatility: 'stable',
        },
        input,
      ),
    )
  }

  if (Object.keys(options).length > 0) {
    const payload = Object.freeze({ kind: 'request_options' as const, options })
    artifacts.push(
      createRequestArtifact(
        {
          authority: 'agent_configuration',
          dedupeKey: 'request-options',
          identityPayload: {
            kind: payload.kind,
            options: toRequestOptionsIdentity(options),
          },
          layer: 'session_metadata',
          payload,
          priority: 100,
          requirement: 'mandatory',
          sensitivity: 'private',
          sourceIds: runConfigurationSourceIds,
          volatility: 'volatile',
        },
        input,
      ),
    )
  }

  if (Object.keys(metadata).length > 0) {
    const payload = Object.freeze({
      kind: 'metadata' as const,
      metadata: Object.freeze({ ...metadata }),
    })
    artifacts.push(
      createRequestArtifact(
        {
          authority: 'agent_configuration',
          dedupeKey: 'request-metadata',
          identityPayload: payload,
          layer: 'session_metadata',
          payload,
          priority: 20,
          requirement: 'preferred',
          sensitivity: 'restricted',
          sourceIds: runConfigurationSourceIds,
          volatility: 'volatile',
        },
        input,
      ),
    )
  }

  return Object.freeze(artifacts)
}
