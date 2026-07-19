import type { DomainEventEnvelope } from '../../../../../domain/events/domain-event'
import type { RunRecord } from '../../../../../domain/runtime/run-repository'
import {
  toGenerationInput,
  toGenerationMetadata,
  toGenerationModelParameters,
  toGenerationOutput,
} from '../metadata/generation-metadata'
import { asString, findTurn, toErrorMessage, toEventPayload } from '../normalization'
import type { EventPayload, ExportGeneration, ExportTool } from '../types'
import { toGenerationUsageDetails } from '../usage'
import { pickLatestEvent } from './run-events'

export const buildGenerationSnapshots = (input: {
  createdPayload: EventPayload | null
  runEvents: readonly (DomainEventEnvelope<unknown> & { eventNo: number })[]
  run: RunRecord
  runId: string
  toolsByTurn: Map<number, ExportTool[]>
}): ExportGeneration[] => {
  const turns = new Set<number>()

  for (const event of input.runEvents) {
    if (
      event.type === 'generation.started' ||
      event.type === 'generation.completed' ||
      event.type === 'generation.failed' ||
      event.type === 'reasoning.summary.done' ||
      event.type === 'turn.started'
    ) {
      const turn = findTurn(toEventPayload(event))

      if (turn !== null) {
        turns.add(turn)
      }
    }
  }

  for (const turn of input.toolsByTurn.keys()) {
    turns.add(turn)
  }

  return [...turns]
    .sort((left, right) => left - right)
    .map((turn) => {
      const turnEvents = input.runEvents.filter((event) => findTurn(toEventPayload(event)) === turn)
      const started = pickLatestEvent(turnEvents, 'generation.started')
      const completed = pickLatestEvent(turnEvents, 'generation.completed')
      const failed = pickLatestEvent(turnEvents, 'generation.failed')
      const turnStarted = pickLatestEvent(turnEvents, 'turn.started')
      const reasoningDone = pickLatestEvent(turnEvents, 'reasoning.summary.done')
      const startedPayload = started ? toEventPayload(started) : null
      const completedPayload = completed ? toEventPayload(completed) : null
      const failedPayload = failed ? toEventPayload(failed) : null
      const turnStartedPayload = turnStarted ? toEventPayload(turnStarted) : null
      const startTime =
        asString(startedPayload?.startedAt) ?? started?.createdAt ?? turnStarted?.createdAt
      const endTime =
        completed?.createdAt ?? failed?.createdAt ?? startTime ?? new Date(0).toISOString()
      const requestedModel = asString(startedPayload?.requestedModel)
      const completedModel = asString(completedPayload?.model)
      const reasoningPayload = reasoningDone ? toEventPayload(reasoningDone) : null
      const reasoningText = asString(reasoningPayload?.text)
      const tools = input.toolsByTurn.get(turn) ?? []

      return {
        endTime,
        events:
          reasoningDone && reasoningText
            ? [
                {
                  key: `event:reasoning:${input.runId}:turn:${turn}`,
                  metadata: {
                    itemId: asString(reasoningPayload?.itemId) ?? null,
                    turn,
                  },
                  output: reasoningText,
                  timestamp: reasoningDone.createdAt,
                },
              ]
            : [],
        input: toGenerationInput(startedPayload, turnStartedPayload),
        key: `generation:${input.runId}:turn:${turn}`,
        level: failed ? 'ERROR' : 'DEFAULT',
        metadata: toGenerationMetadata({
          completedPayload,
          createdPayload: input.createdPayload,
          generationKey: `generation:${input.runId}:turn:${turn}`,
          run: input.run,
          startedPayload,
          tools,
          turn,
          turnStartedPayload,
        }),
        model: completedModel ?? requestedModel ?? undefined,
        modelParameters: toGenerationModelParameters(startedPayload),
        name: `turn-${turn}`,
        output: toGenerationOutput(completedPayload, failedPayload),
        startTime: startTime ?? endTime,
        statusMessage: failed && failedPayload ? toErrorMessage(failedPayload.error) : undefined,
        tools,
        usageDetails: toGenerationUsageDetails(completedPayload),
      }
    })
}
