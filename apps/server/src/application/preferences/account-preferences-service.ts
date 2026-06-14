import { z } from 'zod'

import { createAgentRepository } from '../../domain/agents/agent-repository'
import type { RepositoryDatabase } from '../../domain/database-port'
import { createAccountPreferencesRepository } from '../../domain/preferences/account-preferences-repository'
import {
  mergeShortcutBindingOverrides,
  resetShortcutBindingOverrides,
  type ShortcutBindingOverrides,
} from '../../domain/preferences/shortcut-bindings'
import { createTenantMembershipRepository } from '../../domain/tenancy/tenant-membership-repository'
import { createToolProfileRepository } from '../../domain/tool-access/tool-profile-repository'
import type { DomainError } from '../../shared/errors'
import { type AgentId, asAgentId, asToolProfileId, type ToolProfileId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { canReadAgent } from '../agents/agent-access'
import { canReadToolProfile } from '../tool-access/tool-profile-access'

const shortcutBindingsPatchSchema = z.record(z.string(), z.union([z.string(), z.null()]))
const accountPreferencesPatchSchema = z.object({
  assistantToolProfileId: z.string().trim().min(1).max(200).optional(),
  defaultTarget: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('assistant'),
      }),
      z.object({
        agentId: z.string().trim().min(1).max(200),
        kind: z.literal('agent'),
      }),
    ])
    .optional(),
  shortcutBindings: shortcutBindingsPatchSchema.optional(),
})

const accountPreferencesShortcutResetSchema = z.object({
  actionIds: z.array(z.string().trim().min(1).max(200)).optional(),
})

export type AccountPreferencesPatchInput = z.infer<typeof accountPreferencesPatchSchema>
export type AccountPreferencesShortcutResetInput = z.infer<
  typeof accountPreferencesShortcutResetSchema
>

export type AccountPreferencesDefaultTargetView =
  | {
      kind: 'assistant'
    }
  | {
      agentId: AgentId
      kind: 'agent'
    }

export interface AccountPreferencesView {
  accountId: string
  assistantToolProfileId: ToolProfileId
  defaultTarget: AccountPreferencesDefaultTargetView
  shortcutBindings: ShortcutBindingOverrides
  updatedAt: string
}

export interface AccountPreferencesServiceDependencies {
  db: RepositoryDatabase
  now: () => string
}

const formatZodError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''

      return `${path}${issue.message}`
    })
    .join('; ')

const toView = (
  value: ReturnType<typeof createAccountPreferencesRepository> extends {
    getByAccountId: (...args: never[]) => Result<infer TRecord, DomainError>
  }
    ? TRecord
    : never,
): AccountPreferencesView => ({
  accountId: value.accountId,
  assistantToolProfileId: value.assistantToolProfileId,
  defaultTarget:
    value.defaultTargetKind === 'agent' && value.defaultAgentId
      ? {
          agentId: value.defaultAgentId,
          kind: 'agent',
        }
      : {
          kind: 'assistant',
        },
  shortcutBindings: value.shortcutBindings,
  updatedAt: value.updatedAt,
})

export const parseAccountPreferencesPatchInput = (
  input: unknown,
): Result<AccountPreferencesPatchInput, DomainError> => {
  const parsed = accountPreferencesPatchSchema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: formatZodError(parsed.error),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export const parseAccountPreferencesShortcutResetInput = (
  input: unknown,
): Result<AccountPreferencesShortcutResetInput, DomainError> => {
  const parsed = accountPreferencesShortcutResetSchema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: formatZodError(parsed.error),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export const createAccountPreferencesService = (
  dependencies: AccountPreferencesServiceDependencies,
) => {
  const { db, now } = dependencies

  return {
    getPreferences: (scope: TenantScope): Result<AccountPreferencesView, DomainError> => {
      const membership = createTenantMembershipRepository(db).requireMembership(scope)

      if (!membership.ok) {
        return membership
      }

      const preferences = createAccountPreferencesRepository(db).getByAccountId(
        scope,
        scope.accountId,
      )

      if (!preferences.ok) {
        return preferences
      }

      return ok(toView(preferences.value))
    },
    updatePreferences: (
      scope: TenantScope,
      input: AccountPreferencesPatchInput,
    ): Result<AccountPreferencesView, DomainError> => {
      const membership = createTenantMembershipRepository(db).requireMembership(scope)

      if (!membership.ok) {
        return membership
      }

      const preferencesRepository = createAccountPreferencesRepository(db)
      const current = preferencesRepository.getByAccountId(scope, scope.accountId)

      if (!current.ok) {
        return current
      }

      let assistantToolProfileId: ToolProfileId = current.value.assistantToolProfileId
      let defaultTargetKind: 'assistant' | 'agent' = current.value.defaultTargetKind
      let defaultAgentId: AgentId | null = current.value.defaultAgentId
      let shortcutBindings: ShortcutBindingOverrides = current.value.shortcutBindings

      if (input.assistantToolProfileId !== undefined) {
        const requestedToolProfileId = asToolProfileId(input.assistantToolProfileId)
        const toolProfile = createToolProfileRepository(db).getById(scope, requestedToolProfileId)

        if (!toolProfile.ok) {
          return toolProfile
        }

        if (!canReadToolProfile(scope, toolProfile.value)) {
          return err({
            message: `tool profile ${requestedToolProfileId} is not available to account ${scope.accountId}`,
            type: 'permission',
          })
        }

        assistantToolProfileId = requestedToolProfileId
      }

      if (input.defaultTarget) {
        if (input.defaultTarget.kind === 'assistant') {
          defaultTargetKind = 'assistant'
          defaultAgentId = null
        } else {
          const requestedAgentId = asAgentId(input.defaultTarget.agentId)
          const agent = createAgentRepository(db).getById(scope, requestedAgentId)

          if (!agent.ok) {
            return agent
          }

          if (!canReadAgent(scope, agent.value)) {
            return err({
              message: `agent ${requestedAgentId} is not visible to account ${scope.accountId}`,
              type: 'permission',
            })
          }

          if (agent.value.status !== 'active' || !agent.value.activeRevisionId) {
            return err({
              message: `agent ${requestedAgentId} must be active and have an active revision`,
              type: 'conflict',
            })
          }

          defaultTargetKind = 'agent'
          defaultAgentId = requestedAgentId
        }
      }

      if (input.shortcutBindings !== undefined) {
        const mergedShortcutBindings = mergeShortcutBindingOverrides(
          shortcutBindings,
          input.shortcutBindings,
        )

        if (!mergedShortcutBindings.ok) {
          return mergedShortcutBindings
        }

        shortcutBindings = mergedShortcutBindings.value
      }

      const updated = preferencesRepository.upsert(scope, {
        accountId: scope.accountId,
        assistantToolProfileId,
        defaultAgentId,
        defaultTargetKind,
        shortcutBindings,
        updatedAt: now(),
      })

      if (!updated.ok) {
        return updated
      }

      return ok(toView(updated.value))
    },
    resetShortcutBindings: (
      scope: TenantScope,
      input: AccountPreferencesShortcutResetInput,
    ): Result<AccountPreferencesView, DomainError> => {
      const membership = createTenantMembershipRepository(db).requireMembership(scope)

      if (!membership.ok) {
        return membership
      }

      const preferencesRepository = createAccountPreferencesRepository(db)
      const current = preferencesRepository.getByAccountId(scope, scope.accountId)

      if (!current.ok) {
        return current
      }

      const shortcutBindings = resetShortcutBindingOverrides(
        current.value.shortcutBindings,
        input.actionIds,
      )

      if (!shortcutBindings.ok) {
        return shortcutBindings
      }

      const updated = preferencesRepository.upsert(scope, {
        accountId: scope.accountId,
        assistantToolProfileId: current.value.assistantToolProfileId,
        defaultAgentId: current.value.defaultAgentId,
        defaultTargetKind: current.value.defaultTargetKind,
        shortcutBindings: shortcutBindings.value,
        updatedAt: now(),
      })

      if (!updated.ok) {
        return updated
      }

      return ok(toView(updated.value))
    },
  }
}
