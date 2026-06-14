import type { AppRuntime } from '../../app/runtime'
import { asRequestId, asTraceId } from '../../shared/ids'
import type { TenantScope } from '../../shared/scope'
import type { CommandContext } from './command-context'

export const createInternalCommandContext = (
  runtime: Pick<AppRuntime, 'config' | 'db' | 'services'>,
  tenantScope: TenantScope,
): CommandContext => ({
  config: runtime.config,
  db: runtime.db,
  requestId: asRequestId(runtime.services.ids.create('req')),
  services: runtime.services,
  tenantScope,
  traceId: asTraceId(runtime.services.ids.create('trc')),
})
