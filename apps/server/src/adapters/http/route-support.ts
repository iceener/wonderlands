import type { Context } from 'hono'
import type { z } from 'zod'

import { requireTenantScope } from '../../app/require-tenant-scope'
import type { AppEnv } from '../../app/types'
import type { CommandContext } from '../../application/commands/command-context'
import { createRepositories } from '../../application/persistence/repositories'
import { type DomainError, DomainErrorException } from '../../shared/errors'
import type { Result } from '../../shared/result'
import { parseJsonBody } from './parse-json-body'
import { toZodErrorMessage } from './validation'

export const toCommandContext = (c: Context<AppEnv>): CommandContext => {
  const db = c.get('db')

  return {
    config: c.get('config'),
    db,
    repositories: createRepositories(db),
    requestId: c.get('requestId'),
    services: c.get('services'),
    tenantScope: requireTenantScope(c),
    traceId: c.get('traceId'),
  }
}

export const parseJsonBodyAs = async <TSchema extends z.ZodTypeAny>(
  c: Context<AppEnv>,
  schema: TSchema,
): Promise<z.infer<TSchema>> => {
  const parsed = schema.safeParse(await parseJsonBody(c))

  if (!parsed.success) {
    throw new DomainErrorException({
      message: toZodErrorMessage(parsed.error),
      type: 'validation',
    })
  }

  return parsed.data
}

export const parseQueryAs = <TSchema extends z.ZodTypeAny>(
  _c: Context<AppEnv>,
  schema: TSchema,
  raw: unknown,
): z.infer<TSchema> => {
  const parsed = schema.safeParse(raw)

  if (!parsed.success) {
    throw new DomainErrorException({
      message: toZodErrorMessage(parsed.error),
      type: 'validation',
    })
  }

  return parsed.data
}

export const unwrapRouteResult = <T>(result: Result<T, DomainError>): T => {
  if (!result.ok) {
    throw new DomainErrorException(result.error)
  }

  return result.value
}
