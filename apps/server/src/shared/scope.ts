import type { AccountId, TenantId } from './ids'

export const tenantRoleValues = ['owner', 'admin', 'member', 'viewer', 'service'] as const

export type TenantRole = (typeof tenantRoleValues)[number]

export interface AccountContext {
  email: string | null
  id: AccountId
  name: string | null
}

export interface TenantScope {
  accountId: AccountId
  role: TenantRole
  tenantId: TenantId
}

export type RequestScope =
  | { kind: 'unauthenticated' }
  | {
      account: AccountContext
      kind: 'authenticated'
      tenantScope: TenantScope | null
    }
