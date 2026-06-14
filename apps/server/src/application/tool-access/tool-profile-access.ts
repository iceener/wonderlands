import type { ToolProfileRecord } from '../../domain/tool-access/tool-profile-repository'
import type { TenantScope } from '../../shared/scope'

export const canViewToolProfile = (scope: TenantScope, profile: ToolProfileRecord): boolean => {
  if (profile.status === 'deleted') {
    return false
  }

  switch (profile.scope) {
    case 'system':
    case 'tenant_shared':
      return true
    case 'account_private':
      return profile.accountId === scope.accountId
  }
}

export const canReadToolProfile = (scope: TenantScope, profile: ToolProfileRecord): boolean => {
  if (profile.status !== 'active') {
    return false
  }

  return canViewToolProfile(scope, profile)
}
