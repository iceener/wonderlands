import type { DomainEventCategory } from './domain-event'

export type EventOutboxTopic = 'background' | 'observability' | 'projection' | 'realtime'

export interface CanonicalCommittedEventContract {
  category: DomainEventCategory
  defaultReplay: boolean
  outboxTopics: readonly EventOutboxTopic[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null

const DOMAIN_OUTBOX_TOPICS = [
  'projection',
  'realtime',
] as const satisfies readonly EventOutboxTopic[]
const BACKGROUND_OUTBOX_TOPICS = [
  'background',
  'realtime',
] as const satisfies readonly EventOutboxTopic[]
const OBSERVABILITY_DOMAIN_OUTBOX_TOPICS = [
  'observability',
  'projection',
  'realtime',
] as const satisfies readonly EventOutboxTopic[]
const REALTIME_DOMAIN_OUTBOX_TOPICS = ['realtime'] as const satisfies readonly EventOutboxTopic[]
const TELEMETRY_OUTBOX_TOPICS = ['realtime'] as const satisfies readonly EventOutboxTopic[]

export const DEFAULT_REPLAY_EVENT_CATEGORY: DomainEventCategory = 'domain'

export const DOMAIN_EVENT_TYPES = [
  'agent.created',
  'agent.revision.created',
  'child_run.completed',
  'child_run.created',
  'delegation.started',
  'file.linked',
  'file.uploaded',
  'message.posted',
  'run.cancelling',
  'run.cancelled',
  'run.completed',
  'run.created',
  'run.failed',
  'run.requeued',
  'run.resumed',
  'run.started',
  'run.waiting',
  'session.created',
  'thread.created',
  'thread.naming.completed',
  'thread.naming.failed',
  'thread.naming.requested',
  'thread.naming.started',
  'thread.updated',
  'tool.called',
  'tool.completed',
  'tool.confirmation_granted',
  'tool.confirmation_rejected',
  'tool.confirmation_requested',
  'tool.failed',
  'tool.waiting',
  'upload.failed',
  'wait.timed_out',
  'job.blocked',
  'job.cancelled',
  'job.completed',
  'job.created',
  'job.queued',
  'job.requeued',
  'job.superseded',
  'job.waiting',
  'workspace.created',
  'workspace.resolved',
] as const

export const TELEMETRY_EVENT_TYPES = [
  'generation.started',
  'generation.completed',
  'generation.failed',
  'memory.observation.completed',
  'memory.observation.started',
  'memory.reflection.completed',
  'memory.reflection.started',
  'progress.reported',
  'reasoning.summary.delta',
  'reasoning.summary.done',
  'stream.delta',
  'stream.done',
  'turn.completed',
  'turn.started',
  'web_search.progress',
] as const

export type DomainCommittedEventType = (typeof DOMAIN_EVENT_TYPES)[number]
export type TelemetryCommittedEventType = (typeof TELEMETRY_EVENT_TYPES)[number]
export type CanonicalCommittedEventType = DomainCommittedEventType | TelemetryCommittedEventType

const toContracts = (
  eventTypes: readonly CanonicalCommittedEventType[],
  contract: CanonicalCommittedEventContract,
): Record<CanonicalCommittedEventType, CanonicalCommittedEventContract> =>
  Object.fromEntries(eventTypes.map((type) => [type, contract])) as Record<
    CanonicalCommittedEventType,
    CanonicalCommittedEventContract
  >

const DOMAIN_EVENT_CONTRACT: CanonicalCommittedEventContract = {
  category: 'domain',
  defaultReplay: true,
  outboxTopics: DOMAIN_OUTBOX_TOPICS,
}

const TELEMETRY_EVENT_CONTRACT: CanonicalCommittedEventContract = {
  category: 'telemetry',
  defaultReplay: false,
  outboxTopics: TELEMETRY_OUTBOX_TOPICS,
}

const BACKGROUND_DOMAIN_EVENT_CONTRACT: CanonicalCommittedEventContract = {
  category: 'domain',
  defaultReplay: true,
  outboxTopics: BACKGROUND_OUTBOX_TOPICS,
}

const OBSERVABILITY_DOMAIN_EVENT_CONTRACT: CanonicalCommittedEventContract = {
  category: 'domain',
  defaultReplay: true,
  outboxTopics: OBSERVABILITY_DOMAIN_OUTBOX_TOPICS,
}

const REALTIME_DOMAIN_EVENT_CONTRACT: CanonicalCommittedEventContract = {
  category: 'domain',
  defaultReplay: true,
  outboxTopics: REALTIME_DOMAIN_OUTBOX_TOPICS,
}

const CANONICAL_COMMITTED_EVENT_CONTRACTS = {
  ...toContracts(DOMAIN_EVENT_TYPES, DOMAIN_EVENT_CONTRACT),
  ...toContracts(TELEMETRY_EVENT_TYPES, TELEMETRY_EVENT_CONTRACT),
  ...toContracts(['run.completed', 'run.failed'], OBSERVABILITY_DOMAIN_EVENT_CONTRACT),
  ...toContracts(['thread.naming.requested'], BACKGROUND_DOMAIN_EVENT_CONTRACT),
  ...toContracts(
    ['thread.naming.completed', 'thread.naming.failed', 'thread.naming.started', 'thread.updated'],
    REALTIME_DOMAIN_EVENT_CONTRACT,
  ),
} as const satisfies Record<CanonicalCommittedEventType, CanonicalCommittedEventContract>

export const getCanonicalCommittedEventContract = (
  type: string,
): CanonicalCommittedEventContract | null =>
  type in CANONICAL_COMMITTED_EVENT_CONTRACTS
    ? CANONICAL_COMMITTED_EVENT_CONTRACTS[type as CanonicalCommittedEventType]
    : null

const isRootRunTerminalObservabilityTrigger = (
  type: string,
  payload: unknown,
): payload is { rootRunId?: string; runId: string } => {
  if (type !== 'run.completed' && type !== 'run.failed') {
    return false
  }

  if (!isRecord(payload)) {
    return false
  }

  const runId = asString(payload.runId)
  const rootRunId = asString(payload.rootRunId) ?? runId

  return runId !== null && rootRunId !== null && runId === rootRunId
}

export const resolveCanonicalCommittedEventOutboxTopics = (
  type: string,
  payload: unknown,
): readonly EventOutboxTopic[] | null => {
  const contract = getCanonicalCommittedEventContract(type)

  if (!contract) {
    return null
  }

  if (!contract.outboxTopics.includes('observability')) {
    return contract.outboxTopics
  }

  return isRootRunTerminalObservabilityTrigger(type, payload)
    ? contract.outboxTopics
    : contract.outboxTopics.filter((topic) => topic !== 'observability')
}
