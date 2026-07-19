import type { DomainError } from '../../shared/errors'
import type { RunId, TenantId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { ToolDomain } from '../tooling/tool-vocabulary'

export interface ToolExecutionRecord {
  argsJson: unknown | null
  completedAt: string | null
  createdAt: string
  domain: ToolDomain
  durationMs: number | null
  errorText: string | null
  id: string
  outcomeJson: unknown | null
  runId: RunId
  startedAt: string | null
  tenantId: TenantId
  tool: string
}

export interface CreateToolExecutionInput {
  argsJson: unknown | null
  createdAt: string
  domain: ToolDomain
  id: string
  runId: RunId
  startedAt: string
  tool: string
}

export interface CompleteToolExecutionInput {
  completedAt: string
  durationMs: number | null
  id: string
  outcomeJson: unknown
}

export interface FailToolExecutionInput {
  completedAt: string
  durationMs: number | null
  errorText: string
  id: string
  outcomeJson?: unknown | null
}

/**
 * Persistence-neutral port for tool execution storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface ToolExecutionRepository {
  complete: (
    scope: TenantScope,
    input: CompleteToolExecutionInput,
  ) => Result<ToolExecutionRecord, DomainError>
  create: (
    scope: TenantScope,
    input: CreateToolExecutionInput,
  ) => Result<ToolExecutionRecord, DomainError>
  fail: (
    scope: TenantScope,
    input: FailToolExecutionInput,
  ) => Result<ToolExecutionRecord, DomainError>
  getById: (scope: TenantScope, id: string) => Result<ToolExecutionRecord, DomainError>
  listByRunId: (scope: TenantScope, runId: RunId) => Result<ToolExecutionRecord[], DomainError>
  listIncompleteByRunId: (
    scope: TenantScope,
    runId: RunId,
  ) => Result<ToolExecutionRecord[], DomainError>
}
