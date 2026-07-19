import type { AppConfig } from '../../app/config'
import type { AppServices } from '../../app/runtime'
import type { AppDatabase } from '../../db/client'
import type { DomainError } from '../../shared/errors'
import type { RequestId, TraceId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'
import type { Repositories } from '../persistence/repositories'

export interface CommandContext {
  config: AppConfig
  db: AppDatabase
  /**
   * Centrally-constructed repository instances bound to `db`. Application
   * code should prefer these over constructing repositories itself; see
   * `application/persistence/repositories.ts`.
   */
  repositories: Repositories
  requestId: RequestId
  services: AppServices
  tenantScope: TenantScope
  traceId: TraceId
}

export type CommandResult<TValue> = Result<TValue, DomainError>
