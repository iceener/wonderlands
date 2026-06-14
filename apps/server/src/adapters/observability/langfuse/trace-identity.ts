import { createHash } from 'node:crypto'

export const toLangfuseObservationId = (key: string): string =>
  createHash('sha256').update(`span:${key}`).digest('hex').slice(0, 16)

export const toLangfuseTraceId = (traceKey: string): string =>
  createHash('sha256').update(`trace:${traceKey}`).digest('hex').slice(0, 32)
