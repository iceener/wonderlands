import type { DomainError } from '../../shared/errors'
import type { ItemId, RunId, SessionThreadId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export interface ItemContentPart {
  text: string
  thought?: boolean
  thoughtSignature?: string
  type: 'text'
}

export interface ItemRecord {
  arguments: string | null
  callId: string | null
  content: ItemContentPart[] | null
  createdAt: string
  id: ItemId
  name: string | null
  output: string | null
  providerPayload: unknown | null
  role: 'user' | 'assistant' | 'system' | 'developer' | null
  runId: RunId
  sequence: number
  summary: unknown | null
  tenantId: TenantId
  type: 'message' | 'function_call' | 'function_call_output' | 'reasoning'
}

export interface CreateItemInput {
  content: ItemContentPart[]
  createdAt: string
  id: ItemId
  providerPayload?: unknown | null
  role: NonNullable<ItemRecord['role']>
  runId: RunId
  sequence: number
}

export interface CreateFunctionCallItemInput {
  argumentsJson: string
  callId: string
  createdAt: string
  id: ItemId
  name: string
  providerPayload?: unknown | null
  runId: RunId
  sequence: number
}

export interface CreateFunctionCallOutputItemInput {
  callId: string
  createdAt: string
  id: ItemId
  output: string
  providerPayload?: unknown | null
  runId: RunId
  sequence: number
}

export interface CreateReasoningItemInput {
  createdAt: string
  id: ItemId
  providerPayload?: unknown | null
  runId: RunId
  sequence: number
  summary: unknown
}

/**
 * Persistence-neutral port for run item (conversation item) storage.
 * Concrete implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface ItemRepository {
  createFunctionCall: (
    scope: TenantScope,
    input: CreateFunctionCallItemInput,
  ) => Result<ItemRecord, DomainError>
  createFunctionCallOutput: (
    scope: TenantScope,
    input: CreateFunctionCallOutputItemInput,
  ) => Result<ItemRecord, DomainError>
  createMessage: (scope: TenantScope, input: CreateItemInput) => Result<ItemRecord, DomainError>
  createReasoning: (
    scope: TenantScope,
    input: CreateReasoningItemInput,
  ) => Result<ItemRecord, DomainError>
  createAssistantMessage: (
    scope: TenantScope,
    input: Omit<CreateItemInput, 'role'>,
  ) => Result<ItemRecord, DomainError>
  createUserMessage: (
    scope: TenantScope,
    input: Omit<CreateItemInput, 'role'>,
  ) => Result<ItemRecord, DomainError>
  getNextSequence: (scope: TenantScope, runId: RunId) => Result<number, DomainError>
  listByRunId: (scope: TenantScope, runId: RunId) => Result<ItemRecord[], DomainError>
  listByRunIds: (scope: TenantScope, runIds: RunId[]) => Result<ItemRecord[], DomainError>
  listByThreadId: (
    scope: TenantScope,
    threadId: SessionThreadId,
  ) => Result<ItemRecord[], DomainError>
}
