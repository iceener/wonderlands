import type { DomainEventEnvelope } from '../../../../../domain/events/domain-event'
import { LANGFUSE_OBSERVATION_TAXONOMY } from '../../observation-taxonomy'
import { toToolMetadata, toToolWaitingOutput, toWebSearchMetadata } from '../metadata/tool-metadata'
import {
  asString,
  findTurn,
  sortByTimestamp,
  toErrorMessage,
  toErrorOutput,
  toEventPayload,
} from '../normalization'
import type { ExportTool } from '../types'

export const buildToolSnapshots = (input: {
  childRunsBySourceCallId: Map<string, ExportTool['childRuns']>
  runEvents: readonly (DomainEventEnvelope<unknown> & { eventNo: number })[]
}): { byTurn: Map<number, ExportTool[]>; unscoped: ExportTool[] } => {
  const grouped = new Map<
    string,
    {
      called: (DomainEventEnvelope<unknown> & { eventNo: number }) | null
      completed: (DomainEventEnvelope<unknown> & { eventNo: number }) | null
      confirmationRequested: (DomainEventEnvelope<unknown> & { eventNo: number }) | null
      failed: (DomainEventEnvelope<unknown> & { eventNo: number }) | null
      turn: number | null
      waiting: (DomainEventEnvelope<unknown> & { eventNo: number }) | null
    }
  >()

  for (const event of input.runEvents) {
    if (
      event.type !== 'tool.called' &&
      event.type !== 'tool.completed' &&
      event.type !== 'tool.confirmation_requested' &&
      event.type !== 'tool.failed' &&
      event.type !== 'tool.waiting'
    ) {
      continue
    }

    const payload = toEventPayload(event)
    const callId = asString(payload?.callId) ?? event.aggregateId

    if (!callId) {
      continue
    }

    const current = grouped.get(callId) ?? {
      called: null,
      completed: null,
      confirmationRequested: null,
      failed: null,
      turn: findTurn(payload),
      waiting: null,
    }

    current.turn ??= findTurn(payload)

    if (event.type === 'tool.called') {
      current.called = event
    }

    if (event.type === 'tool.completed') {
      current.completed = event
    }

    if (event.type === 'tool.failed') {
      current.failed = event
    }

    if (event.type === 'tool.waiting') {
      current.waiting = event
    }

    if (event.type === 'tool.confirmation_requested') {
      current.confirmationRequested = event
    }

    grouped.set(callId, current)
  }

  const byTurn = new Map<number, ExportTool[]>()
  const unscoped: ExportTool[] = []

  for (const [callId, value] of grouped.entries()) {
    const calledPayload = value.called ? toEventPayload(value.called) : null
    const completedPayload = value.completed ? toEventPayload(value.completed) : null
    const confirmationRequestedPayload = value.confirmationRequested
      ? toEventPayload(value.confirmationRequested)
      : null
    const failedPayload = value.failed ? toEventPayload(value.failed) : null
    const waitingPayload = value.waiting ? toEventPayload(value.waiting) : null
    const waitPayload = confirmationRequestedPayload ?? waitingPayload
    const toolName =
      asString(calledPayload?.tool) ??
      asString(completedPayload?.tool) ??
      asString(confirmationRequestedPayload?.tool) ??
      asString(failedPayload?.tool) ??
      asString(waitingPayload?.tool) ??
      'tool'
    const startTime =
      value.called?.createdAt ??
      value.completed?.createdAt ??
      value.confirmationRequested?.createdAt ??
      value.failed?.createdAt ??
      value.waiting?.createdAt

    if (!startTime) {
      continue
    }

    const tool: ExportTool = {
      asType: LANGFUSE_OBSERVATION_TAXONOMY.current.toolCall.asType,
      childRuns: input.childRunsBySourceCallId.get(callId) ?? [],
      endTime:
        value.completed?.createdAt ??
        value.failed?.createdAt ??
        value.confirmationRequested?.createdAt ??
        value.waiting?.createdAt ??
        startTime,
      input: calledPayload?.args,
      key: `tool:${callId}`,
      level: value.failed ? 'ERROR' : waitPayload ? 'WARNING' : 'DEFAULT',
      metadata: toToolMetadata({
        childRuns: input.childRunsBySourceCallId.get(callId) ?? [],
        key: `tool:${callId}`,
        payload:
          calledPayload ??
          completedPayload ??
          confirmationRequestedPayload ??
          failedPayload ??
          waitingPayload,
      }),
      name: toolName,
      output: value.completed
        ? completedPayload?.outcome
        : value.failed
          ? toErrorOutput(failedPayload?.error)
          : waitPayload
            ? toToolWaitingOutput(waitPayload)
            : undefined,
      startTime,
      statusMessage:
        value.failed && failedPayload
          ? (toErrorMessage(failedPayload.error) ?? asString(failedPayload.tool) ?? undefined)
          : value.confirmationRequested
            ? 'tool.confirmation_requested'
            : value.waiting
              ? `tool.waiting${asString(waitPayload?.waitType) ? `:${waitPayload?.waitType}` : ''}`
              : undefined,
      success: value.completed ? true : value.failed ? false : null,
    }

    if (value.turn === null) {
      unscoped.push(tool)
      continue
    }

    const current = byTurn.get(value.turn) ?? []
    current.push(tool)
    byTurn.set(value.turn, current)
  }

  for (const [turn, tools] of byTurn.entries()) {
    byTurn.set(turn, sortByTimestamp(tools))
  }

  return {
    byTurn,
    unscoped: sortByTimestamp(unscoped),
  }
}

export const buildWebSearchSnapshots = (input: {
  runEvents: readonly (DomainEventEnvelope<unknown> & { eventNo: number })[]
}): { byTurn: Map<number, ExportTool[]>; unscoped: ExportTool[] } => {
  const grouped = new Map<
    string,
    {
      events: Array<DomainEventEnvelope<unknown> & { eventNo: number }>
      turn: number | null
    }
  >()

  for (const event of input.runEvents) {
    if (event.type !== 'web_search.progress') {
      continue
    }

    const payload = toEventPayload(event)
    const searchId = asString(payload?.searchId)

    if (!searchId) {
      continue
    }

    const current = grouped.get(searchId) ?? {
      events: [],
      turn: findTurn(payload),
    }

    current.events.push(event)
    current.turn ??= findTurn(payload)
    grouped.set(searchId, current)
  }

  const byTurn = new Map<number, ExportTool[]>()
  const unscoped: ExportTool[] = []

  for (const [searchId, value] of grouped.entries()) {
    const events = [...value.events].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    )
    const first = events[0]
    const latest = events[events.length - 1]

    if (!first || !latest) {
      continue
    }

    const latestPayload = toEventPayload(latest)
    const inputPayload: Record<string, unknown> = {}
    const outputPayload: Record<string, unknown> = {}

    if (Array.isArray(latestPayload?.queries) && latestPayload.queries.length > 0) {
      inputPayload.queries = latestPayload.queries
    }

    if (Array.isArray(latestPayload?.patterns) && latestPayload.patterns.length > 0) {
      inputPayload.patterns = latestPayload.patterns
    }

    if (Array.isArray(latestPayload?.targetUrls) && latestPayload.targetUrls.length > 0) {
      inputPayload.targetUrls = latestPayload.targetUrls
    }

    if (Array.isArray(latestPayload?.references) && latestPayload.references.length > 0) {
      outputPayload.references = latestPayload.references
    }

    const status = asString(latestPayload?.status)

    if (status) {
      outputPayload.status = status
    }

    const retriever: ExportTool = {
      asType: LANGFUSE_OBSERVATION_TAXONOMY.current.webSearch.asType,
      childRuns: [],
      endTime: latest.createdAt,
      input: Object.keys(inputPayload).length > 0 ? inputPayload : undefined,
      key: `retriever:web_search:${searchId}`,
      level: status === 'failed' ? 'ERROR' : 'DEFAULT',
      metadata: toWebSearchMetadata(latestPayload),
      name: 'web_search',
      output: Object.keys(outputPayload).length > 0 ? outputPayload : undefined,
      startTime: first.createdAt,
      statusMessage: status === 'failed' ? 'web_search.failed' : undefined,
      success: status === 'completed' ? true : status === 'failed' ? false : null,
    }

    if (value.turn === null) {
      unscoped.push(retriever)
      continue
    }

    const current = byTurn.get(value.turn) ?? []
    current.push(retriever)
    byTurn.set(value.turn, current)
  }

  for (const [turn, retrievers] of byTurn.entries()) {
    byTurn.set(turn, sortByTimestamp(retrievers))
  }

  return {
    byTurn,
    unscoped: sortByTimestamp(unscoped),
  }
}

export const mergeToolSnapshotsByTurn = (
  ...maps: ReadonlyArray<Map<number, ExportTool[]>>
): Map<number, ExportTool[]> => {
  const merged = new Map<number, ExportTool[]>()

  for (const source of maps) {
    for (const [turn, tools] of source.entries()) {
      const current = merged.get(turn) ?? []
      current.push(...tools)
      merged.set(turn, sortByTimestamp(current))
    }
  }

  return merged
}
