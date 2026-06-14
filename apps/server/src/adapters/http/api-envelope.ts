import type { Context } from 'hono'
import type { AppEnv } from '../../app/types'
import type { DomainError } from '../../shared/errors'

export const successEnvelope = <TData>(c: Context<AppEnv>, data: TData) => ({
  data,
  meta: {
    requestId: c.get('requestId'),
    traceId: c.get('traceId'),
  },
  ok: true as const,
})

export const errorEnvelope = (c: Context<AppEnv>, error: DomainError) => ({
  error,
  meta: {
    requestId: c.get('requestId'),
    traceId: c.get('traceId'),
  },
  ok: false as const,
})
