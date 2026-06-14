import { z } from 'zod'
import type { AppDatabase } from '../../db/client'
import { createTenantMembershipRepository } from '../../domain/tenancy/tenant-membership-repository'
import {
  createToolProfileRepository,
  type ToolProfileRecord,
  type ToolProfileScope,
  type ToolProfileStatus,
} from '../../domain/tool-access/tool-profile-repository'
import type { DomainError } from '../../shared/errors'
import {
  type AccountId,
  asToolProfileId,
  createPrefixedId,
  type ToolProfileId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import { writableTenantRoles } from '../agents/agent-access'
import { canViewToolProfile } from './tool-profile-access'

const createToolProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  scope: z.enum(['account_private', 'tenant_shared']),
})

const updateToolProfileInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    scope: z.enum(['account_private', 'tenant_shared']).optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.scope !== undefined || value.status !== undefined,
    {
      message: 'At least one tool profile field must be provided.',
    },
  )

export type CreateToolProfileInput = z.infer<typeof createToolProfileInputSchema>
export type UpdateToolProfileInput = z.infer<typeof updateToolProfileInputSchema>

export interface ToolProfileSummary {
  accountId: AccountId | null
  createdAt: string
  id: ToolProfileId
  name: string
  scope: ToolProfileScope
  status: ToolProfileStatus
  tenantId: string
  updatedAt: string
}

export interface ToolProfileService {
  createToolProfile: (
    scope: TenantScope,
    input: CreateToolProfileInput,
  ) => Result<ToolProfileSummary, DomainError>
  getToolProfileById: (
    scope: TenantScope,
    toolProfileId: ToolProfileId,
  ) => Result<ToolProfileSummary, DomainError>
  listToolProfiles: (scope: TenantScope) => Result<ToolProfileSummary[], DomainError>
  updateToolProfile: (
    scope: TenantScope,
    toolProfileId: ToolProfileId,
    input: UpdateToolProfileInput,
  ) => Result<ToolProfileSummary, DomainError>
}

export interface CreateToolProfileServiceDependencies {
  createId?: (prefix: string) => string
  db: AppDatabase
  now?: () => string
}

const formatZodError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
      return `${path}${issue.message}`
    })
    .join('; ')

const parseWithSchema = <TValue>(
  schema: z.ZodType<TValue>,
  input: unknown,
): Result<TValue, DomainError> => {
  const parsed = schema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: formatZodError(parsed.error),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export const parseCreateToolProfileInput = (
  input: unknown,
): Result<CreateToolProfileInput, DomainError> =>
  parseWithSchema(createToolProfileInputSchema, input)

export const parseUpdateToolProfileInput = (
  input: unknown,
): Result<UpdateToolProfileInput, DomainError> =>
  parseWithSchema(updateToolProfileInputSchema, input)

const canWriteToolProfiles = (scope: TenantScope): boolean => writableTenantRoles.has(scope.role)

const canEditToolProfile = (scope: TenantScope, profile: ToolProfileRecord): boolean => {
  if (profile.status === 'deleted' || profile.scope === 'system') {
    return false
  }

  if (!canWriteToolProfiles(scope)) {
    return false
  }

  if (profile.scope === 'tenant_shared') {
    return true
  }

  return profile.accountId === scope.accountId
}

const toToolProfileSummary = (profile: ToolProfileRecord): ToolProfileSummary => ({
  accountId: profile.accountId,
  createdAt: profile.createdAt,
  id: profile.id,
  name: profile.name,
  scope: profile.scope,
  status: profile.status,
  tenantId: profile.tenantId,
  updatedAt: profile.updatedAt,
})

const requireMembership = (db: AppDatabase, scope: TenantScope): Result<null, DomainError> => {
  const membership = createTenantMembershipRepository(db).requireMembership(scope)

  if (!membership.ok) {
    return membership
  }

  return ok(null)
}

export const createToolProfileService = ({
  createId = createPrefixedId,
  db,
  now = () => new Date().toISOString(),
}: CreateToolProfileServiceDependencies): ToolProfileService => {
  const repository = createToolProfileRepository(db)

  return {
    createToolProfile: (scope, input) => {
      const membership = requireMembership(db, scope)

      if (!membership.ok) {
        return membership
      }

      if (!canWriteToolProfiles(scope)) {
        return err({
          message: `tenant role ${scope.role} cannot modify tool profiles`,
          type: 'permission',
        })
      }

      const timestamp = now()
      const created = repository.create(scope, {
        accountId: input.scope === 'account_private' ? scope.accountId : null,
        createdAt: timestamp,
        id: asToolProfileId(createId('tpf')),
        name: input.name,
        scope: input.scope,
        status: 'active',
        updatedAt: timestamp,
      })

      if (!created.ok) {
        return created
      }

      return ok(toToolProfileSummary(created.value))
    },
    getToolProfileById: (scope, toolProfileId) => {
      const membership = requireMembership(db, scope)

      if (!membership.ok) {
        return membership
      }

      const profile = repository.getById(scope, toolProfileId)

      if (!profile.ok) {
        return profile
      }

      if (!canViewToolProfile(scope, profile.value)) {
        return err({
          message: `tool profile ${toolProfileId} is not available to account ${scope.accountId}`,
          type: 'permission',
        })
      }

      return ok(toToolProfileSummary(profile.value))
    },
    listToolProfiles: (scope) => {
      const membership = requireMembership(db, scope)

      if (!membership.ok) {
        return membership
      }

      const profiles = repository.listByTenant(scope)

      if (!profiles.ok) {
        return profiles
      }

      return ok(
        profiles.value
          .filter((profile) => profile.status !== 'deleted')
          .filter((profile) => canViewToolProfile(scope, profile))
          .map(toToolProfileSummary),
      )
    },
    updateToolProfile: (scope, toolProfileId, input) => {
      const membership = requireMembership(db, scope)

      if (!membership.ok) {
        return membership
      }

      const current = repository.getById(scope, toolProfileId)

      if (!current.ok) {
        return current
      }

      if (!canEditToolProfile(scope, current.value)) {
        return err({
          message: `tool profile ${toolProfileId} cannot be modified by account ${scope.accountId}`,
          type: 'permission',
        })
      }

      const nextScope = input.scope ?? current.value.scope
      const updated = repository.update(scope, toolProfileId, {
        accountId: nextScope === 'account_private' ? scope.accountId : null,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: now(),
      })

      if (!updated.ok) {
        return updated
      }

      return ok(toToolProfileSummary(updated.value))
    },
  }
}
