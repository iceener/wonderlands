import type { DomainError } from '../../shared/errors'
import type { RunId, SessionThreadId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export const contextManifestModeValues = ['shadow', 'active'] as const

export type ContextManifestMode = (typeof contextManifestModeValues)[number]

export type RedactedContextManifestTransformation =
  | { readonly kind: 'none' }
  | { readonly includedBytes: number; readonly kind: 'truncated'; readonly originalBytes: number }
  | {
      readonly kind: 'summarized'
      readonly sourceRefs: readonly string[]
      readonly summarizerVersion: string
    }
  | { readonly fields: readonly string[]; readonly kind: 'redacted' }

export interface RedactedContextManifestArtifactEntry {
  readonly artifactId: string
  readonly authority: string
  readonly estimatedTokens: number
  readonly freshness: {
    readonly capturedAt: string
    readonly expiresAt: string | null
  }
  readonly layer: string
  readonly metadataStatus: 'declared' | 'legacy_shadow'
  readonly payloadKind: 'messages' | 'metadata' | 'native_tools' | 'request_options' | 'tools'
  readonly sensitivity: 'private' | 'public' | 'restricted' | 'secret'
  readonly source: {
    readonly ids: readonly string[]
    readonly type: string
  }
  readonly transformation: RedactedContextManifestTransformation
}

export interface RedactedContextManifestArtifactDecision {
  readonly artifact: RedactedContextManifestArtifactEntry
  readonly reasonCodes: readonly string[]
}

export interface RedactedContextManifestConflictDecision {
  readonly losers: readonly RedactedContextManifestArtifactEntry[]
  readonly reasonCodes: readonly string[]
  readonly winner: RedactedContextManifestArtifactEntry
}

/**
 * Persistence-facing structural contract for the content-free `context/v2` manifest produced by
 * application context assembly. Domain code deliberately does not import the application manifest
 * type. The SQLite adapter additionally applies a fail-closed key allowlist before writing JSON.
 */
export interface RedactedContextManifest {
  readonly assemblerVersion: string
  readonly budget: {
    readonly availableInputTokens: number | null
    readonly consideredArtifactTokens: number
    readonly droppedArtifactTokens: number
    readonly inputTokenLimit: number | null
    readonly reservedOutputTokens: number | null
    readonly selectedArtifactTokens: number
  }
  readonly conflicts: readonly RedactedContextManifestConflictDecision[]
  readonly coordinates: {
    readonly runId: string
    readonly threadId: string | null
    readonly turn: number
  }
  readonly dropped: readonly RedactedContextManifestArtifactDecision[]
  readonly generatedAt: string
  readonly model: string
  readonly persistenceId: string | null
  readonly provider: string
  readonly rejected: readonly RedactedContextManifestArtifactDecision[]
  readonly replayHash: string
  readonly selected: readonly RedactedContextManifestArtifactEntry[]
  readonly transformed: readonly RedactedContextManifestArtifactDecision[]
  readonly version: 'context/v2'
}

export interface ContextManifestRecord {
  readonly assemblerVersion: string
  readonly createdAt: string
  readonly generatedAt: string
  readonly id: string
  readonly manifest: RedactedContextManifest
  readonly mode: ContextManifestMode
  readonly model: string
  readonly provider: string
  readonly replayHash: string
  readonly runId: RunId
  readonly tenantId: TenantId
  readonly threadId: SessionThreadId | null
  readonly turn: number
}

export interface CreateContextManifestInput {
  readonly assemblerVersion: string
  readonly createdAt: string
  readonly generatedAt: string
  readonly id: string
  /** Must be the already-redacted, content-free object returned by context assembly. */
  readonly manifest: RedactedContextManifest
  readonly mode: ContextManifestMode
  readonly model: string
  readonly provider: string
  readonly replayHash: string
  readonly runId: RunId
  readonly threadId?: SessionThreadId | null
  readonly turn: number
}

export interface ContextManifestAttemptKey {
  readonly assemblerVersion: string
  readonly mode: ContextManifestMode
  readonly runId: RunId
  readonly turn: number
}

export interface ContextManifestListCursor {
  readonly createdAt: string
  readonly id: string
}

export interface ListContextManifestsInput {
  readonly before?: ContextManifestListCursor
  readonly limit?: number
  readonly runId?: RunId
  readonly threadId?: SessionThreadId
}

export const DEFAULT_CONTEXT_MANIFEST_LIST_LIMIT = 50
export const MAX_CONTEXT_MANIFEST_LIST_LIMIT = 100

/**
 * Tenant-scoped, persistence-neutral port for redacted context manifests. Create is idempotent on
 * tenant/run/turn/mode/assemblerVersion. A retry with the same replay hash returns the existing
 * record; a different replay hash is a conflict.
 */
export interface ContextManifestRepository {
  create: (
    scope: TenantScope,
    input: CreateContextManifestInput,
  ) => Result<ContextManifestRecord, DomainError>
  getByAttempt: (
    scope: TenantScope,
    key: ContextManifestAttemptKey,
  ) => Result<ContextManifestRecord | null, DomainError>
  getById: (scope: TenantScope, id: string) => Result<ContextManifestRecord | null, DomainError>
  list: (
    scope: TenantScope,
    input?: ListContextManifestsInput,
  ) => Result<ContextManifestRecord[], DomainError>
}
