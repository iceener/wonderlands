import type { DomainError } from '../../shared/errors'
import type { AccountId, AgentId, TenantId, ToolProfileId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { ShortcutBindingOverrides } from './shortcut-bindings'

export interface AccountPreferencesRecord {
  accountId: AccountId
  assistantToolProfileId: ToolProfileId
  defaultAgentId: AgentId | null
  defaultTargetKind: 'assistant' | 'agent'
  shortcutBindings: ShortcutBindingOverrides
  tenantId: TenantId
  updatedAt: string
}

export interface UpsertAccountPreferencesInput {
  accountId: AccountId
  assistantToolProfileId: ToolProfileId
  defaultAgentId?: AgentId | null
  defaultTargetKind: AccountPreferencesRecord['defaultTargetKind']
  shortcutBindings: ShortcutBindingOverrides
  updatedAt: string
}

/**
 * Persistence-neutral port for account preferences storage. Concrete
 * implementations (e.g. the Drizzle/SQLite adapter) live under
 * `adapters/persistence/sqlite/`. This module must not import anything from
 * `db`, `drizzle-orm`, `application`, or `adapters` -- see
 * `test/architecture-guardrails.test.ts`.
 */
export interface AccountPreferencesRepository {
  clearDefaultAgentByAgentId: (scope: TenantScope, agentId: AgentId) => Result<number, DomainError>
  getByAccountId: (
    scope: TenantScope,
    accountId: AccountId,
  ) => Result<AccountPreferencesRecord, DomainError>
  upsert: (
    scope: TenantScope,
    input: UpsertAccountPreferencesInput,
  ) => Result<AccountPreferencesRecord, DomainError>
}
