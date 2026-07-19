import type { Context } from 'hono'
import { requireTenantScope } from '../../app/require-tenant-scope'
import type { AppEnv } from '../../app/types'
import { createResourceAccessService } from '../../application/access/resource-access'
import { createSandboxExecutionRepository } from '../persistence/sqlite/sandbox/sandbox-execution-repository'
import { DomainErrorException } from '../../shared/errors'
import type {
  FileId,
  RunId,
  SandboxExecutionId,
  SessionThreadId,
  WorkSessionId,
} from '../../shared/ids'
import { unwrapRouteResult } from './route-support'

const toResourceAccess = (c: Context<AppEnv>) => createResourceAccessService(c.get('db'))

export const requireRunAccess = (c: Context<AppEnv>, runId: RunId) => {
  const tenantScope = requireTenantScope(c)

  return {
    ...unwrapRouteResult(toResourceAccess(c).requireRunAccess(tenantScope, runId)),
    tenantScope,
  }
}

export const requireThreadAccess = (c: Context<AppEnv>, threadId: SessionThreadId) => {
  const tenantScope = requireTenantScope(c)

  return {
    ...unwrapRouteResult(toResourceAccess(c).requireThreadAccess(tenantScope, threadId)),
    tenantScope,
  }
}

export const authorizeThreadWrite = (c: Context<AppEnv>, threadId: SessionThreadId) => {
  const tenantScope = requireTenantScope(c)

  return {
    ...unwrapRouteResult(toResourceAccess(c).authorizeThreadWrite(tenantScope, threadId)),
    tenantScope,
  }
}

export const requireSessionAccess = (c: Context<AppEnv>, sessionId: WorkSessionId) => {
  const tenantScope = requireTenantScope(c)

  return {
    session: unwrapRouteResult(toResourceAccess(c).requireSessionAccess(tenantScope, sessionId)),
    tenantScope,
  }
}

export const requireFileAccess = (c: Context<AppEnv>, fileId: FileId) => {
  const tenantScope = requireTenantScope(c)

  return {
    file: unwrapRouteResult(toResourceAccess(c).requireFileAccess(tenantScope, fileId)),
    tenantScope,
  }
}

export const requireSandboxExecutionAccess = (
  c: Context<AppEnv>,
  input: {
    runId: RunId
    sandboxExecutionId: SandboxExecutionId
  },
) => {
  const { run, tenantScope } = requireRunAccess(c, input.runId)
  const execution = unwrapRouteResult(
    createSandboxExecutionRepository(c.get('db')).getById(tenantScope, input.sandboxExecutionId),
  )

  if (execution.runId !== run.id) {
    throw new DomainErrorException({
      message: `sandbox execution ${execution.id} does not belong to run ${run.id}`,
      type: 'permission',
    })
  }

  return {
    execution,
    run,
    tenantScope,
  }
}
