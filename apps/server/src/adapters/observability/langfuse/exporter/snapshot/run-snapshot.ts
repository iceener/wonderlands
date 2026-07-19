import type { DomainEventEnvelope } from '../../../../../domain/events/domain-event'
import type { RunRecord } from '../../../../../domain/runtime/run-repository'
import { toRunObservationName } from '../metadata/agent-metadata'
import {
  toRunInput,
  toRunMetadata,
  toRunOutput,
  toRunWaitingStatusMessage,
} from '../metadata/run-metadata'
import { sortByTimestamp, toErrorMessage, toEventPayload } from '../normalization'
import type { ExportRun } from '../types'
import { buildGenerationSnapshots } from './generation-snapshots'
import { findRunLifecycleEvent, pickLatestEvent, toRelevantRunEvents } from './run-events'
import {
  buildToolSnapshots,
  buildWebSearchSnapshots,
  mergeToolSnapshotsByTurn,
} from './tool-snapshots'

export const buildRunSnapshot = (input: {
  childRunsByParentId: Map<string, RunRecord[]>
  events: readonly (DomainEventEnvelope<unknown> & { eventNo: number })[]
  run: RunRecord
}): ExportRun => {
  const runEvents = toRelevantRunEvents(input.events, input.run.id)
  const runCreated = findRunLifecycleEvent(runEvents, 'run.created')
  const terminalEvent =
    pickLatestEvent(runEvents, 'run.completed') ??
    pickLatestEvent(runEvents, 'run.failed') ??
    pickLatestEvent(runEvents, 'run.waiting')
  const createdPayload = runCreated ? toEventPayload(runCreated) : null
  const childRuns = input.childRunsByParentId.get(input.run.id) ?? []
  const childSnapshots = childRuns.map((childRun) =>
    buildRunSnapshot({
      childRunsByParentId: input.childRunsByParentId,
      events: input.events,
      run: childRun,
    }),
  )
  const childRunsBySourceCallId = new Map<string, ExportRun[]>()

  for (let index = 0; index < childRuns.length; index += 1) {
    const childRun = childRuns[index]!
    const childSnapshot = childSnapshots[index]!

    if (!childRun.sourceCallId) {
      continue
    }

    const current = childRunsBySourceCallId.get(childRun.sourceCallId) ?? []
    current.push(childSnapshot)
    childRunsBySourceCallId.set(childRun.sourceCallId, current)
  }

  const { byTurn: toolsByTurn, unscoped: unscopedTools } = buildToolSnapshots({
    childRunsBySourceCallId,
    runEvents,
  })
  const { byTurn: retrieversByTurn, unscoped: unscopedRetrievers } = buildWebSearchSnapshots({
    runEvents,
  })
  const attachedSourceCallIds = new Set(
    childRuns.filter((run) => run.sourceCallId).map((run) => run.sourceCallId),
  )
  const terminalPayload = terminalEvent ? toEventPayload(terminalEvent) : null

  return {
    childRuns: childSnapshots.filter(
      (_, index) => !attachedSourceCallIds.has(childRuns[index]!.sourceCallId),
    ),
    endTime: input.run.completedAt ?? input.run.updatedAt,
    generations: buildGenerationSnapshots({
      createdPayload,
      runEvents,
      run: input.run,
      runId: input.run.id,
      toolsByTurn: mergeToolSnapshotsByTurn(toolsByTurn, retrieversByTurn),
    }),
    input: toRunInput(createdPayload, input.run.task),
    key: `run:${input.run.id}`,
    level:
      input.run.status === 'failed'
        ? 'ERROR'
        : input.run.status === 'waiting'
          ? 'WARNING'
          : 'DEFAULT',
    metadata: toRunMetadata(input.run, createdPayload, terminalPayload),
    name: toRunObservationName(input.run, createdPayload),
    output: toRunOutput(input.run, terminalPayload),
    startTime: input.run.startedAt ?? input.run.createdAt,
    statusMessage:
      input.run.status === 'failed'
        ? toErrorMessage(terminalPayload?.error)
        : input.run.status === 'waiting'
          ? toRunWaitingStatusMessage(terminalPayload)
          : undefined,
    success: input.run.status === 'completed' ? true : input.run.status === 'failed' ? false : null,
    taxonomyStage: input.run.parentRunId ? 'childRun' : 'rootRun',
    tools: sortByTimestamp([...unscopedTools, ...unscopedRetrievers]),
  }
}
