import { and, desc, eq, lt, or } from 'drizzle-orm'

import { contextManifests } from '../../../../db/schema'
import {
  type ContextManifestAttemptKey,
  type ContextManifestRecord,
  type ContextManifestRepository,
  type CreateContextManifestInput,
  contextManifestModeValues,
  DEFAULT_CONTEXT_MANIFEST_LIST_LIMIT,
  type ListContextManifestsInput,
  MAX_CONTEXT_MANIFEST_LIST_LIMIT,
} from '../../../../domain/context/context-manifest-repository'
import type { DomainError } from '../../../../shared/errors'
import { asRunId, asSessionThreadId, asTenantId } from '../../../../shared/ids'
import { err, ok, type Result } from '../../../../shared/result'
import type { TenantScope } from '../../../../shared/scope'
import type { RepositoryDatabase } from '../repository-database'

const MAX_MANIFEST_JSON_BYTES = 1_000_000
const UNTHREADED_MANIFEST_COORDINATE = 'thread-unavailable'

const allowedManifestKeys = new Set([
  'artifact',
  'artifactId',
  'assemblerVersion',
  'authority',
  'availableInputTokens',
  'budget',
  'capturedAt',
  'conflicts',
  'consideredArtifactTokens',
  'coordinates',
  'dropped',
  'droppedArtifactTokens',
  'estimatedTokens',
  'expiresAt',
  'fields',
  'freshness',
  'generatedAt',
  'ids',
  'includedBytes',
  'inputTokenLimit',
  'kind',
  'layer',
  'losers',
  'metadataStatus',
  'model',
  'originalBytes',
  'payloadKind',
  'persistenceId',
  'provider',
  'reasonCodes',
  'rejected',
  'replayHash',
  'reservedOutputTokens',
  'runId',
  'selected',
  'selectedArtifactTokens',
  'sensitivity',
  'source',
  'sourceRefs',
  'summarizerVersion',
  'threadId',
  'transformation',
  'transformed',
  'turn',
  'type',
  'version',
  'winner',
])

const forbiddenKeyNames = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'content',
  'cookie',
  'credential',
  'credentials',
  'message',
  'messages',
  'output',
  'password',
  'payload',
  'refreshtoken',
  'secret',
  'text',
])

const normalizeKey = (key: string): string => key.toLowerCase().replaceAll(/[-_]/g, '')

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const scanManifestValue = (
  value: unknown,
  path: string,
  ancestors = new WeakSet<object>(),
): string | null => {
  if (value === null || typeof value === 'boolean') {
    return null
  }

  if (typeof value === 'string') {
    return /^\s*data:/i.test(value) ? `data URL at ${path}` : null
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? null : `non-finite number at ${path}`
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return `cyclic value at ${path}`
    }
    ancestors.add(value)
    for (let index = 0; index < value.length; index += 1) {
      const issue = scanManifestValue(value[index], `${path}[${index}]`, ancestors)
      if (issue) {
        return issue
      }
    }
    ancestors.delete(value)
    return null
  }

  if (!isPlainRecord(value)) {
    return `unsupported JSON value at ${path}`
  }
  if (ancestors.has(value)) {
    return `cyclic value at ${path}`
  }
  ancestors.add(value)

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = normalizeKey(key)
    if (forbiddenKeyNames.has(normalizedKey)) {
      return `forbidden key "${key}" at ${path}`
    }
    if (!allowedManifestKeys.has(key)) {
      return `unsupported manifest key "${key}" at ${path}`
    }
    const issue = scanManifestValue(child, `${path}.${key}`, ancestors)
    if (issue) {
      return issue
    }
  }

  ancestors.delete(value)
  return null
}

const validateRedactedManifest = (manifest: unknown): string | null => {
  if (!isPlainRecord(manifest)) {
    return 'manifest must be a plain JSON object'
  }

  const requiredKeys = [
    'assemblerVersion',
    'budget',
    'conflicts',
    'coordinates',
    'dropped',
    'generatedAt',
    'model',
    'persistenceId',
    'provider',
    'rejected',
    'replayHash',
    'selected',
    'transformed',
    'version',
  ] as const

  for (const key of requiredKeys) {
    if (!(key in manifest)) {
      return `manifest is missing required key "${key}"`
    }
  }

  if (manifest.version !== 'context/v2') {
    return 'manifest version must be context/v2'
  }
  if (!isPlainRecord(manifest.coordinates)) {
    return 'manifest coordinates must be an object'
  }
  if (!isPlainRecord(manifest.budget)) {
    return 'manifest budget must be an object'
  }
  for (const key of ['conflicts', 'dropped', 'rejected', 'selected', 'transformed'] as const) {
    if (!Array.isArray(manifest[key])) {
      return `manifest ${key} must be an array`
    }
  }

  const scanIssue = scanManifestValue(manifest, '$')
  if (scanIssue) {
    return scanIssue
  }

  const serialized = JSON.stringify(manifest)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_MANIFEST_JSON_BYTES) {
    return `manifest exceeds ${MAX_MANIFEST_JSON_BYTES} bytes`
  }

  return null
}

const isValidTimestamp = (value: string): boolean =>
  value.trim().length > 0 && Number.isFinite(Date.parse(value))

const validateCreateInput = (input: CreateContextManifestInput): string | null => {
  if (input.id.trim().length === 0) {
    return 'id must not be empty'
  }
  if (!Number.isSafeInteger(input.turn) || input.turn < 0) {
    return 'turn must be a non-negative safe integer'
  }
  if (!contextManifestModeValues.includes(input.mode)) {
    return 'mode must be shadow or active'
  }
  if (!isValidTimestamp(input.createdAt) || !isValidTimestamp(input.generatedAt)) {
    return 'createdAt and generatedAt must be valid timestamps'
  }
  for (const [field, value] of [
    ['assemblerVersion', input.assemblerVersion],
    ['model', input.model],
    ['provider', input.provider],
    ['replayHash', input.replayHash],
  ] as const) {
    if (value.trim().length === 0) {
      return `${field} must not be empty`
    }
  }

  const manifestIssue = validateRedactedManifest(input.manifest)
  if (manifestIssue) {
    return manifestIssue
  }

  const { coordinates } = input.manifest
  if (
    input.manifest.assemblerVersion !== input.assemblerVersion ||
    input.manifest.generatedAt !== input.generatedAt ||
    input.manifest.model !== input.model ||
    input.manifest.provider !== input.provider ||
    input.manifest.replayHash !== input.replayHash ||
    coordinates.runId !== input.runId ||
    coordinates.turn !== input.turn
  ) {
    return 'manifest metadata does not match repository input'
  }

  const threadId = input.threadId ?? null
  if (
    (threadId !== null && coordinates.threadId !== threadId) ||
    (threadId === null &&
      coordinates.threadId !== null &&
      coordinates.threadId !== UNTHREADED_MANIFEST_COORDINATE)
  ) {
    return 'manifest thread coordinate does not match repository input'
  }

  return null
}

const toRecord = (row: typeof contextManifests.$inferSelect): ContextManifestRecord => {
  const manifestIssue = validateRedactedManifest(row.manifestJson)
  if (manifestIssue) {
    throw new Error(`stored manifest ${row.id} is invalid: ${manifestIssue}`)
  }

  return {
    assemblerVersion: row.assemblerVersion,
    createdAt: row.createdAt,
    generatedAt: row.generatedAt,
    id: row.id,
    manifest: row.manifestJson,
    mode: row.mode,
    model: row.model,
    provider: row.provider,
    replayHash: row.replayHash,
    runId: asRunId(row.runId),
    tenantId: asTenantId(row.tenantId),
    threadId: row.threadId ? asSessionThreadId(row.threadId) : null,
    turn: row.turn,
  }
}

const findByAttempt = (
  db: RepositoryDatabase,
  scope: TenantScope,
  key: ContextManifestAttemptKey,
): typeof contextManifests.$inferSelect | undefined =>
  db
    .select()
    .from(contextManifests)
    .where(
      and(
        eq(contextManifests.tenantId, scope.tenantId),
        eq(contextManifests.runId, key.runId),
        eq(contextManifests.turn, key.turn),
        eq(contextManifests.mode, key.mode),
        eq(contextManifests.assemblerVersion, key.assemblerVersion),
      ),
    )
    .get()

const repositoryError = (message: string): DomainError => ({ message, type: 'conflict' })

export const createContextManifestRepository = (
  db: RepositoryDatabase,
): ContextManifestRepository => ({
  create: (
    scope: TenantScope,
    input: CreateContextManifestInput,
  ): Result<ContextManifestRecord, DomainError> => {
    const validationIssue = validateCreateInput(input)
    if (validationIssue) {
      return err({
        message: `invalid redacted context manifest: ${validationIssue}`,
        type: 'validation',
      })
    }

    try {
      db.insert(contextManifests)
        .values({
          assemblerVersion: input.assemblerVersion,
          createdAt: input.createdAt,
          generatedAt: input.generatedAt,
          id: input.id,
          manifestJson: input.manifest,
          mode: input.mode,
          model: input.model,
          provider: input.provider,
          replayHash: input.replayHash,
          runId: input.runId,
          tenantId: scope.tenantId,
          threadId: input.threadId ?? null,
          turn: input.turn,
        })
        .onConflictDoNothing({
          target: [
            contextManifests.tenantId,
            contextManifests.runId,
            contextManifests.turn,
            contextManifests.mode,
            contextManifests.assemblerVersion,
          ],
        })
        .run()

      const stored = findByAttempt(db, scope, input)
      if (!stored) {
        return err(repositoryError('context manifest create did not produce a readable record'))
      }
      if (stored.replayHash !== input.replayHash || stored.threadId !== (input.threadId ?? null)) {
        return err(
          repositoryError(
            `context manifest attempt already exists with different content for run ${input.runId} turn ${input.turn}`,
          ),
        )
      }

      return ok(toRecord(stored))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown context manifest create failure'
      return err(repositoryError(`failed to create context manifest ${input.id}: ${message}`))
    }
  },

  getByAttempt: (
    scope: TenantScope,
    key: ContextManifestAttemptKey,
  ): Result<ContextManifestRecord | null, DomainError> => {
    if (
      !Number.isSafeInteger(key.turn) ||
      key.turn < 0 ||
      key.assemblerVersion.trim().length === 0 ||
      !contextManifestModeValues.includes(key.mode)
    ) {
      return err({ message: 'invalid context manifest attempt key', type: 'validation' })
    }

    try {
      const row = findByAttempt(db, scope, key)
      return ok(row ? toRecord(row) : null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown context manifest lookup failure'
      return err(repositoryError(`failed to read context manifest attempt: ${message}`))
    }
  },

  getById: (scope: TenantScope, id: string): Result<ContextManifestRecord | null, DomainError> => {
    if (id.trim().length === 0) {
      return err({ message: 'context manifest id must not be empty', type: 'validation' })
    }

    try {
      const row = db
        .select()
        .from(contextManifests)
        .where(and(eq(contextManifests.id, id), eq(contextManifests.tenantId, scope.tenantId)))
        .get()
      return ok(row ? toRecord(row) : null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown context manifest lookup failure'
      return err(repositoryError(`failed to read context manifest ${id}: ${message}`))
    }
  },

  list: (
    scope: TenantScope,
    input: ListContextManifestsInput = {},
  ): Result<ContextManifestRecord[], DomainError> => {
    const limit = input.limit ?? DEFAULT_CONTEXT_MANIFEST_LIST_LIMIT
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CONTEXT_MANIFEST_LIST_LIMIT) {
      return err({
        message: `context manifest list limit must be between 1 and ${MAX_CONTEXT_MANIFEST_LIST_LIMIT}`,
        type: 'validation',
      })
    }
    if (
      input.before &&
      (!isValidTimestamp(input.before.createdAt) || input.before.id.trim().length === 0)
    ) {
      return err({ message: 'invalid context manifest list cursor', type: 'validation' })
    }

    try {
      const rows = db
        .select()
        .from(contextManifests)
        .where(
          and(
            eq(contextManifests.tenantId, scope.tenantId),
            input.runId ? eq(contextManifests.runId, input.runId) : undefined,
            input.threadId ? eq(contextManifests.threadId, input.threadId) : undefined,
            input.before
              ? or(
                  lt(contextManifests.createdAt, input.before.createdAt),
                  and(
                    eq(contextManifests.createdAt, input.before.createdAt),
                    lt(contextManifests.id, input.before.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(contextManifests.createdAt), desc(contextManifests.id))
        .limit(limit)
        .all()

      return ok(rows.map(toRecord))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown context manifest list failure'
      return err(repositoryError(`failed to list context manifests: ${message}`))
    }
  },
})
