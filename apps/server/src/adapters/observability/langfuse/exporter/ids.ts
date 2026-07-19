import { randomBytes } from 'node:crypto'

import { toLangfuseObservationId, toLangfuseTraceId } from '../trace-identity'
import type { OTelIdGenerator } from './types'

export const toObservationId = (key: string): string => toLangfuseObservationId(key)

export const toTraceId = (traceKey: string): string => toLangfuseTraceId(traceKey)

export const toScoreId = (traceId: string, name: string, target: string): string =>
  `${traceId}:${name}:${target}`

export const createRandomHex = (bytes: number): string => randomBytes(bytes).toString('hex')

export class DeterministicIdGenerator implements OTelIdGenerator {
  private activeSpanIds: string[] = []
  private activeTraceIds: string[] = []

  begin(traceKey: string, observationKeys: readonly string[]) {
    this.activeTraceIds = [toTraceId(traceKey)]
    this.activeSpanIds = observationKeys.map(toObservationId)
  }

  end() {
    this.activeTraceIds = []
    this.activeSpanIds = []
  }

  generateTraceId(): string {
    return this.activeTraceIds.shift() ?? createRandomHex(16)
  }

  generateSpanId(): string {
    return this.activeSpanIds.shift() ?? createRandomHex(8)
  }
}
