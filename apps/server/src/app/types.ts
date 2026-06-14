import type { AppDatabase } from '../db/client'
import type { RequestAuthContext } from '../shared/auth'
import type { RequestId, TraceId } from '../shared/ids'
import type { AccountContext, RequestScope, TenantScope } from '../shared/scope'
import type { AppConfig } from './config'
import type { AppRuntime, AppServices } from './runtime'

export interface AppVariables {
  account: AccountContext | null
  auth: RequestAuthContext | null
  config: AppConfig
  db: AppDatabase
  requestId: RequestId
  requestScope: RequestScope
  services: AppServices
  tenantScope: TenantScope | null
  traceId: TraceId
}

export type AppEnv = {
  Variables: AppVariables
}

export type AppRuntimeInput = AppRuntime
