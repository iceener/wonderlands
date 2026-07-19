import { isRecord } from '../../../../../domain/ai/json-utils'
import type { DomainEventEnvelope } from '../../../../../domain/events/domain-event'
import type { EventOutboxRecord } from '../../../../../domain/events/event-outbox-repository'
import { asAccountId } from '../../../../../shared/ids'
import type { TenantScope } from '../../../../../shared/scope'
import { asString, toEventPayload } from '../normalization'
import type { ExportRun, ExportTool } from '../types'

export const isTerminalRootRunEvent = (entry: EventOutboxRecord): boolean => {
  if (entry.event.type !== 'run.completed' && entry.event.type !== 'run.failed') {
    return false
  }

  if (!isRecord(entry.event.payload)) {
    return false
  }

  const runId = asString(entry.event.payload.runId)
  const rootRunId = asString(entry.event.payload.rootRunId) ?? runId

  return runId !== null && rootRunId !== null && runId === rootRunId
}

export const toRunScope = (entry: EventOutboxRecord): TenantScope | null => {
  if (!entry.tenantId) {
    return null
  }

  return {
    accountId: entry.event.actorAccountId ?? asAccountId('acc_system'),
    role: 'service',
    tenantId: entry.tenantId,
  }
}

export const findRunLifecycleEvent = (
  events: readonly (DomainEventEnvelope<unknown> & { eventNo: number })[],
  type: string,
): (DomainEventEnvelope<unknown> & { eventNo: number }) | null =>
  events.find((event) => event.type === type) ?? null

export const pickLatestEvent = (
  events: readonly (DomainEventEnvelope<unknown> & { eventNo: number })[],
  type: string,
): (DomainEventEnvelope<unknown> & { eventNo: number }) | null => {
  const matches = events.filter((event) => event.type === type)
  return matches.length > 0 ? matches[matches.length - 1]! : null
}

export const toRelevantRunEvents = (
  events: readonly (DomainEventEnvelope<unknown> & { eventNo: number })[],
  runId: string,
): Array<DomainEventEnvelope<unknown> & { eventNo: number }> =>
  events.filter((event) => {
    const payload = toEventPayload(event)
    const payloadRunId = asString(payload?.runId)

    return payloadRunId === runId || (event.aggregateType === 'run' && event.aggregateId === runId)
  })

export const collectObservationKeys = (run: ExportRun): string[] => [
  run.key,
  ...run.generations.flatMap((generation) => [
    generation.key,
    ...generation.events.map((event) => event.key),
    ...generation.tools.flatMap(collectToolObservationKeys),
  ]),
  ...run.tools.flatMap(collectToolObservationKeys),
  ...run.childRuns.flatMap(collectObservationKeys),
]

export const collectToolObservationKeys = (tool: ExportTool): string[] => [
  tool.key,
  ...tool.childRuns.flatMap(collectObservationKeys),
]
