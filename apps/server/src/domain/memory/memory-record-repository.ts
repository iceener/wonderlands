import type { DomainError } from '../../shared/errors'
import type { RunId, SessionThreadId, TenantId, WorkSessionId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export interface ObservationMemoryContent {
  observations: Array<{
    text: string
  }>
  source: 'observer_v1'
}

export interface ReflectionMemoryContent {
  reflection: string
  source: 'reflector_v1'
}

export interface MemoryRecordRecord {
  content: ObservationMemoryContent | ReflectionMemoryContent | Record<string, unknown>
  createdAt: string
  generation: number
  id: string
  kind: 'observation' | 'reflection'
  ownerRunId: RunId | null
  parentRecordId: string | null
  rootRunId: RunId | null
  scopeKind: 'run_local' | 'thread_shared' | 'session_shared' | 'agent_profile'
  scopeRef: string
  sessionId: WorkSessionId | null
  status: 'active' | 'superseded'
  tenantId: TenantId
  threadId: SessionThreadId | null
  tokenCount: number | null
  visibility: 'private' | 'promoted'
}

export interface CreateObservationRecordInput {
  content: ObservationMemoryContent
  createdAt: string
  fromSequence: number
  id: string
  ownerRunId: RunId
  rootRunId: RunId
  sessionId: WorkSessionId
  scopeKind: MemoryRecordRecord['scopeKind']
  scopeRef: string
  sourceRunId: RunId
  sourceSummaryId: string
  sourceId: string
  threadId: SessionThreadId
  throughSequence: number
  tokenCount?: number | null
}

export interface CreateReflectionRecordInput {
  content: ReflectionMemoryContent
  createdAt: string
  id: string
  ownerRunId: RunId
  previousReflectionId?: string | null
  previousReflectionGeneration?: number | null
  rootRunId: RunId
  scopeKind: MemoryRecordRecord['scopeKind']
  scopeRef: string
  sessionId: WorkSessionId
  sourceIds: string[]
  sourceRecordIds: string[]
  sourceRunId: RunId
  threadId: SessionThreadId
  tokenCount?: number | null
}

/**
 * Persistence-neutral port for memory record storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface MemoryRecordRepository {
  createObservationForSummary: (
    scope: TenantScope,
    input: CreateObservationRecordInput,
  ) => Result<MemoryRecordRecord, DomainError>
  createReflection: (
    scope: TenantScope,
    input: CreateReflectionRecordInput,
  ) => Result<MemoryRecordRecord, DomainError>
  getActiveObservationSourceTokenCountByScope: (
    scope: TenantScope,
    input: Pick<MemoryRecordRecord, 'scopeKind' | 'scopeRef'>,
  ) => Result<number, DomainError>
  getLatestActiveReflectionByScope: (
    scope: TenantScope,
    input: Pick<MemoryRecordRecord, 'scopeKind' | 'scopeRef'>,
  ) => Result<MemoryRecordRecord | null, DomainError>
  getLatestActiveReflectionByThread: (
    scope: TenantScope,
    threadId: SessionThreadId,
  ) => Result<MemoryRecordRecord | null, DomainError>
  hasObservationForSummary: (scope: TenantScope, summaryId: string) => Result<boolean, DomainError>
  listActiveByThread: (
    scope: TenantScope,
    threadId: SessionThreadId,
  ) => Result<MemoryRecordRecord[], DomainError>
  listActiveObservationsByScope: (
    scope: TenantScope,
    input: Pick<MemoryRecordRecord, 'scopeKind' | 'scopeRef'>,
  ) => Result<MemoryRecordRecord[], DomainError>
  supersedeRecords: (scope: TenantScope, recordIds: string[]) => Result<null, DomainError>
  updateContent: (
    scope: TenantScope,
    recordId: string,
    input: Pick<MemoryRecordRecord, 'content' | 'tokenCount'>,
  ) => Result<MemoryRecordRecord, DomainError>
}
