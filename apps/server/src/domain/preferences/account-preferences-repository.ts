import { and, eq } from 'drizzle-orm'

import { accountPreferences } from '../../db/schema'
import type { DomainError } from '../../shared/errors'
import {
  type AccountId,
  type AgentId,
  asAccountId,
  asAgentId,
  asTenantId,
  asToolProfileId,
  type TenantId,
  type ToolProfileId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { RepositoryDatabase } from '../database-port'
import {
  parseStoredShortcutBindings,
  type ShortcutBindingOverrides,
  serializeShortcutBindingOverrides,
} from './shortcut-bindings'

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

const toAccountPreferencesRecord = (
  row: typeof accountPreferences.$inferSelect,
): Result<AccountPreferencesRecord, DomainError> => {
  const shortcutBindings = parseStoredShortcutBindings(row.shortcutBindings)
  if (!shortcutBindings.ok) {
    return shortcutBindings
  }

  return ok({
    accountId: asAccountId(row.accountId),
    assistantToolProfileId: asToolProfileId(row.assistantToolProfileId),
    defaultAgentId: row.defaultAgentId ? asAgentId(row.defaultAgentId) : null,
    defaultTargetKind: row.defaultTargetKind,
    shortcutBindings: shortcutBindings.value,
    tenantId: asTenantId(row.tenantId),
    updatedAt: row.updatedAt,
  })
}

export const createAccountPreferencesRepository = (db: RepositoryDatabase) => {
  const getByAccountId = (
    scope: TenantScope,
    accountId: AccountId,
  ): Result<AccountPreferencesRecord, DomainError> => {
    const row = db
      .select()
      .from(accountPreferences)
      .where(
        and(
          eq(accountPreferences.accountId, accountId),
          eq(accountPreferences.tenantId, scope.tenantId),
        ),
      )
      .get()

    if (!row) {
      return err({
        message: `account preferences for account ${accountId} not found in tenant ${scope.tenantId}`,
        type: 'not_found',
      })
    }

    return toAccountPreferencesRecord(row)
  }

  return {
    clearDefaultAgentByAgentId: (
      scope: TenantScope,
      agentId: AgentId,
    ): Result<number, DomainError> => {
      try {
        const result = db
          .update(accountPreferences)
          .set({
            defaultAgentId: null,
            defaultTargetKind: 'assistant',
          })
          .where(
            and(
              eq(accountPreferences.defaultAgentId, agentId),
              eq(accountPreferences.tenantId, scope.tenantId),
            ),
          )
          .run()

        return ok(result.changes)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown account preference clear failure'

        return err({
          message: `failed to clear default target for agent ${agentId}: ${message}`,
          type: 'conflict',
        })
      }
    },
    getByAccountId,
    toRecord: toAccountPreferencesRecord,
    upsert: (
      scope: TenantScope,
      input: UpsertAccountPreferencesInput,
    ): Result<AccountPreferencesRecord, DomainError> => {
      try {
        db.insert(accountPreferences)
          .values({
            accountId: input.accountId,
            assistantToolProfileId: input.assistantToolProfileId,
            defaultAgentId: input.defaultAgentId ?? null,
            defaultTargetKind: input.defaultTargetKind,
            shortcutBindings: serializeShortcutBindingOverrides(input.shortcutBindings),
            tenantId: scope.tenantId,
            updatedAt: input.updatedAt,
          })
          .onConflictDoUpdate({
            set: {
              assistantToolProfileId: input.assistantToolProfileId,
              defaultAgentId: input.defaultAgentId ?? null,
              defaultTargetKind: input.defaultTargetKind,
              shortcutBindings: serializeShortcutBindingOverrides(input.shortcutBindings),
              updatedAt: input.updatedAt,
            },
            target: [accountPreferences.tenantId, accountPreferences.accountId],
          })
          .run()

        return getByAccountId(scope, input.accountId)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown account preferences upsert failure'

        return err({
          message: `failed to upsert account preferences for account ${input.accountId}: ${message}`,
          type: 'conflict',
        })
      }
    },
  }
}
