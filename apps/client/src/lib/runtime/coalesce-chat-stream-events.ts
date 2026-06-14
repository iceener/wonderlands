import type {
  BackendEvent,
  ProgressReportedEvent,
  ReasoningSummaryDeltaEvent,
  StreamDeltaEvent,
} from '@wonderlands/contracts/chat'

const COALESCE_MAX_GAP_MS = 250

const areCloseInTime = (left: BackendEvent, right: BackendEvent): boolean => {
  const leftMs = Date.parse(left.createdAt)
  const rightMs = Date.parse(right.createdAt)

  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    return false
  }

  return Math.abs(rightMs - leftMs) <= COALESCE_MAX_GAP_MS
}

const getRunScope = (
  event: BackendEvent,
): {
  runId: unknown
  threadId: unknown
} => {
  const runId = 'runId' in event.payload ? event.payload.runId : null
  const threadId = 'threadId' in event.payload ? event.payload.threadId : null

  return { runId, threadId }
}

const sameRunScope = (left: BackendEvent, right: BackendEvent): boolean => {
  const leftScope = getRunScope(left)
  const rightScope = getRunScope(right)

  return (
    left.aggregateId === right.aggregateId &&
    left.aggregateType === right.aggregateType &&
    leftScope.runId === rightScope.runId &&
    leftScope.threadId === rightScope.threadId
  )
}

const mergeStreamDelta = (previous: StreamDeltaEvent, next: StreamDeltaEvent): StreamDeltaEvent => {
  return {
    ...next,
    payload: {
      ...next.payload,
      delta: `${previous.payload.delta}${next.payload.delta}`,
    },
  }
}

const mergeReasoningDelta = (
  previous: ReasoningSummaryDeltaEvent,
  next: ReasoningSummaryDeltaEvent,
): ReasoningSummaryDeltaEvent => {
  return {
    ...next,
    payload: {
      ...next.payload,
      delta: `${previous.payload.delta}${next.payload.delta}`,
      text: next.payload.text || previous.payload.text,
    },
  }
}

const isStreamDeltaEvent = (event: BackendEvent): event is StreamDeltaEvent =>
  event.type === 'stream.delta'

const isReasoningSummaryDeltaEvent = (event: BackendEvent): event is ReasoningSummaryDeltaEvent =>
  event.type === 'reasoning.summary.delta'

const isProgressReportedEvent = (event: BackendEvent): event is ProgressReportedEvent =>
  event.type === 'progress.reported'

const canMergeStreamDelta = (previous: StreamDeltaEvent, next: StreamDeltaEvent): boolean =>
  sameRunScope(previous, next) && areCloseInTime(previous, next)

const canMergeReasoningDelta = (
  previous: ReasoningSummaryDeltaEvent,
  next: ReasoningSummaryDeltaEvent,
): boolean =>
  previous.payload.itemId === next.payload.itemId &&
  sameRunScope(previous, next) &&
  areCloseInTime(previous, next)

const canReplaceProgress = (
  previous: ProgressReportedEvent,
  next: ProgressReportedEvent,
): boolean => sameRunScope(previous, next) && areCloseInTime(previous, next)

export const coalesceChatStreamEvents = (events: BackendEvent[]): BackendEvent[] => {
  if (events.length < 2) {
    return events
  }

  const coalesced: BackendEvent[] = []

  for (const event of events) {
    const previous = coalesced[coalesced.length - 1]

    if (!previous) {
      coalesced.push(event)
      continue
    }

    if (
      isStreamDeltaEvent(previous) &&
      isStreamDeltaEvent(event) &&
      canMergeStreamDelta(previous, event)
    ) {
      coalesced[coalesced.length - 1] = mergeStreamDelta(previous, event)
      continue
    }

    if (
      isReasoningSummaryDeltaEvent(previous) &&
      isReasoningSummaryDeltaEvent(event) &&
      canMergeReasoningDelta(previous, event)
    ) {
      coalesced[coalesced.length - 1] = mergeReasoningDelta(previous, event)
      continue
    }

    if (
      isProgressReportedEvent(previous) &&
      isProgressReportedEvent(event) &&
      canReplaceProgress(previous, event)
    ) {
      coalesced[coalesced.length - 1] = event
      continue
    }

    coalesced.push(event)
  }

  return coalesced
}
