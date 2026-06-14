import type { AppConfig } from '../../app/config'
import type { AppServices } from '../../app/runtime'
import type { AppDatabase } from '../../db/client'
import type { DomainError } from '../../shared/errors'
import type { RequestId, TraceId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export interface CommandContext {
  config: AppConfig
  db: AppDatabase
  requestId: RequestId
  services: AppServices
  tenantScope: TenantScope
  traceId: TraceId
}

export type CommandResult<TValue> = Result<TValue, DomainError>
