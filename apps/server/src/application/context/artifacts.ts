import { createHash } from 'node:crypto'

import type { AiMessage } from '../../domain/ai/types'
import { estimateMessageTokens } from '../interactions/context-bundle'
import type {
  ContextArtifact,
  ContextArtifactMetadata,
  ContextArtifactTransformation,
  ContextContribution,
  ContextContributor,
  ContextContributorInput,
} from './contracts'

export const LEGACY_SHADOW_ARTIFACT_VERSION = 'context-artifact/legacy-shadow-v1'

export type ContextArtifactValidationMode = 'legacy-shadow' | 'strict'

export interface BuildContextArtifactsOptions {
  readonly validationMode?: ContextArtifactValidationMode
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** JSON-compatible canonicalization with recursively sorted object keys. */
const toCanonicalValue = (value: unknown, path: string): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Context artifact identity contains a non-finite number at ${path}`)
    }

    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      entry === undefined ? null : toCanonicalValue(entry, `${path}[${index}]`),
    )
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, toCanonicalValue(value[key], `${path}.${key}`)]),
    )
  }

  throw new Error(`Context artifact identity contains unsupported data at ${path}`)
}

export const createDeterministicContextArtifactId = (identity: unknown): string => {
  const canonicalIdentity = JSON.stringify(toCanonicalValue(identity, '$'))
  const digest = createHash('sha256').update(canonicalIdentity).digest('hex')

  return `ctxa_${digest}`
}

const assertTimestamp = (value: string, field: string, contributorId: string): void => {
  if (value.trim().length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Context contributor "${contributorId}" has invalid ${field}: "${value}"`)
  }
}

const assertNullableKey = (value: string | null, field: string, contributorId: string): void => {
  if (value !== null && value.trim().length === 0) {
    throw new Error(`Context contributor "${contributorId}" has an empty ${field}`)
  }
}

const assertReferenceList = (
  values: readonly string[],
  field: string,
  contributorId: string,
): void => {
  if (values.some((value) => value.trim().length === 0)) {
    throw new Error(`Context contributor "${contributorId}" has an empty ${field} reference`)
  }
}

const assertTransformation = (
  transformation: ContextArtifactTransformation,
  contributorId: string,
): void => {
  if (
    transformation.kind === 'truncated' &&
    (!Number.isSafeInteger(transformation.originalBytes) ||
      transformation.originalBytes < 0 ||
      !Number.isSafeInteger(transformation.includedBytes) ||
      transformation.includedBytes < 0 ||
      transformation.includedBytes > transformation.originalBytes)
  ) {
    throw new Error(`Context contributor "${contributorId}" has invalid truncation metadata`)
  }

  if (transformation.kind === 'summarized') {
    assertReferenceList(transformation.sourceRefs, 'transformation source', contributorId)
    if (transformation.summarizerVersion.trim().length === 0) {
      throw new Error(`Context contributor "${contributorId}" has an empty summarizer version`)
    }
  }

  if (transformation.kind === 'redacted') {
    assertReferenceList(transformation.fields, 'redacted field', contributorId)
  }
}

export const validateContextArtifactMetadata = (
  metadata: ContextArtifactMetadata,
  contributorId: string,
): void => {
  assertTimestamp(metadata.capturedAt, 'capturedAt', contributorId)
  if (metadata.expiresAt !== null) {
    assertTimestamp(metadata.expiresAt, 'expiresAt', contributorId)
  }
  if (!Number.isFinite(metadata.priority)) {
    throw new Error(`Context contributor "${contributorId}" priority must be finite`)
  }

  assertNullableKey(metadata.dedupeKey, 'dedupeKey', contributorId)
  assertNullableKey(metadata.conflictKey, 'conflictKey', contributorId)
  assertReferenceList(metadata.dependencies, 'dependency', contributorId)
  assertReferenceList(metadata.supersedes, 'supersedes', contributorId)
  assertReferenceList(metadata.provenance.sourceIds, 'provenance source', contributorId)
  assertTransformation(metadata.transformation, contributorId)
}

const cloneTransformation = (
  transformation: ContextArtifactTransformation,
): ContextArtifactTransformation => {
  switch (transformation.kind) {
    case 'none':
      return Object.freeze({ kind: 'none' })
    case 'truncated':
      return Object.freeze({ ...transformation })
    case 'summarized':
      return Object.freeze({
        ...transformation,
        sourceRefs: Object.freeze([...transformation.sourceRefs]),
      })
    case 'redacted':
      return Object.freeze({
        fields: Object.freeze([...transformation.fields]),
        kind: 'redacted',
      })
  }
}

const cloneMetadata = (metadata: ContextArtifactMetadata): ContextArtifactMetadata => ({
  ...metadata,
  dependencies: Object.freeze([...metadata.dependencies]),
  provenance: Object.freeze({
    ...metadata.provenance,
    sourceIds: Object.freeze([...metadata.provenance.sourceIds]),
  }),
  supersedes: Object.freeze([...metadata.supersedes]),
  transformation: cloneTransformation(metadata.transformation),
})

export const createLegacyShadowArtifactMetadata = (
  contributor: ContextContributor,
  input: ContextContributorInput,
): ContextArtifactMetadata => ({
  authority: 'legacy',
  capturedAt: input.context.run.createdAt,
  conflictKey: null,
  dedupeKey: null,
  dependencies: [],
  expiresAt: null,
  priority: 0,
  provenance: {
    createdByRunId: String(input.context.run.id),
    sourceIds: [String(input.context.run.id), contributor.id],
    sourceType: 'legacy_shadow',
    sourceVersion: LEGACY_SHADOW_ARTIFACT_VERSION,
  },
  requirement: 'preferred',
  sensitivity: 'private',
  supersedes: [],
  transformation: { kind: 'none' },
  visibility: 'model',
})

const estimateContributionTokens = (contribution: ContextContribution): number =>
  contribution.messages.reduce(
    (total, message) => total + estimateMessageTokens(message as AiMessage),
    0,
  )

const toArtifact = (
  contributor: ContextContributor,
  contribution: ContextContribution,
  contributionIndex: number,
  input: ContextContributorInput,
  validationMode: ContextArtifactValidationMode,
): ContextArtifact => {
  const describedMetadata = contributor.describe?.({
    contribution,
    contributionIndex,
    input,
  })

  if (validationMode === 'strict' && describedMetadata === undefined) {
    throw new Error(
      `Context contributor "${contributor.id}" is missing artifact metadata in strict mode`,
    )
  }

  const metadata = cloneMetadata(
    describedMetadata ?? createLegacyShadowArtifactMetadata(contributor, input),
  )
  validateContextArtifactMetadata(metadata, contributor.id)

  const artifactWithoutId = {
    ...metadata,
    estimatedTokens: estimateContributionTokens(contribution),
    layer: contribution.kind,
    metadataStatus: describedMetadata ? ('declared' as const) : ('legacy_shadow' as const),
    payload: Object.freeze({
      kind: 'messages' as const,
      messages: Object.freeze([...contribution.messages]),
    }),
    volatility: contribution.volatility,
  }

  return Object.freeze({
    ...artifactWithoutId,
    id: createDeterministicContextArtifactId({
      artifact: artifactWithoutId,
      schemaVersion: 'context-artifact/v1',
    }),
  })
}

/**
 * Builds shadow artifacts in the supplied static registry order. It only reads immutable input;
 * captured time comes from the run snapshot and there is no clock or random access.
 */
export const buildContextArtifacts = (
  contributors: readonly ContextContributor[],
  input: ContextContributorInput,
  options: BuildContextArtifactsOptions = {},
): readonly ContextArtifact[] => {
  const validationMode = options.validationMode ?? 'legacy-shadow'
  const ids = new Set<string>()
  const artifacts: ContextArtifact[] = []

  for (const contributor of contributors) {
    const contributions = contributor.build(input)

    for (const [contributionIndex, contribution] of contributions.entries()) {
      const artifact = toArtifact(
        contributor,
        contribution,
        contributionIndex,
        input,
        validationMode,
      )

      if (ids.has(artifact.id)) {
        throw new Error(
          `Duplicate context artifact id "${artifact.id}" from contributor "${contributor.id}"`,
        )
      }

      ids.add(artifact.id)
      artifacts.push(artifact)
    }
  }

  return Object.freeze(artifacts)
}

/** Projects only message artifacts back to the exact legacy contribution shape and order. */
export const projectContextArtifactMessages = (
  artifacts: readonly ContextArtifact[],
): readonly ContextContribution[] =>
  Object.freeze(
    artifacts.flatMap((artifact) =>
      artifact.payload.kind === 'messages'
        ? [
            Object.freeze({
              kind: artifact.layer,
              messages: artifact.payload.messages,
              volatility: artifact.volatility,
            }),
          ]
        : [],
    ),
  )
