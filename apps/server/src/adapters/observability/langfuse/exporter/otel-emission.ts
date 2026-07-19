import { startObservation } from '@langfuse/tracing'

import { LANGFUSE_OBSERVATION_TAXONOMY } from '../observation-taxonomy'
import type { ExportRun, ExportTool } from './types'

export const endObservation = (endable: { end: (endTime?: Date) => void }, endTime: string) => {
  endable.end(new Date(endTime))
}

export const exportRunObservation = (
  run: ExportRun,
  parent?: { startObservation: (...args: any[]) => any },
) => {
  const parentObservation = parent as { startObservation: (...args: any[]) => any } | undefined
  const observation = parent
    ? parentObservation!.startObservation(
        run.name,
        {
          input: run.input,
          ...(run.level ? { level: run.level } : {}),
          ...(run.metadata ? { metadata: run.metadata } : {}),
          ...(run.output === undefined ? {} : { output: run.output }),
          ...(run.statusMessage ? { statusMessage: run.statusMessage } : {}),
        },
        {
          asType:
            run.taxonomyStage === 'childRun'
              ? LANGFUSE_OBSERVATION_TAXONOMY.current.childRun.asType
              : LANGFUSE_OBSERVATION_TAXONOMY.current.rootRun.asType,
          startTime: new Date(run.startTime),
        },
      )
    : startObservation(
        run.name,
        {
          input: run.input,
          ...(run.level ? { level: run.level } : {}),
          ...(run.metadata ? { metadata: run.metadata } : {}),
          ...(run.output === undefined ? {} : { output: run.output }),
          ...(run.statusMessage ? { statusMessage: run.statusMessage } : {}),
        },
        {
          asType:
            run.taxonomyStage === 'childRun'
              ? LANGFUSE_OBSERVATION_TAXONOMY.current.childRun.asType
              : LANGFUSE_OBSERVATION_TAXONOMY.current.rootRun.asType,
          startTime: new Date(run.startTime),
        },
      )

  for (const generation of run.generations) {
    const generationObservation = observation.startObservation(
      generation.name,
      {
        input: generation.input,
        ...(generation.level ? { level: generation.level } : {}),
        ...(generation.metadata ? { metadata: generation.metadata } : {}),
        ...(generation.model ? { model: generation.model } : {}),
        ...(generation.modelParameters ? { modelParameters: generation.modelParameters } : {}),
        ...(generation.output === undefined ? {} : { output: generation.output }),
        ...(generation.statusMessage ? { statusMessage: generation.statusMessage } : {}),
        ...(generation.usageDetails ? { usageDetails: generation.usageDetails } : {}),
      },
      {
        asType: LANGFUSE_OBSERVATION_TAXONOMY.current.turnGeneration.asType,
        startTime: new Date(generation.startTime),
      },
    )

    for (const reasoningEvent of generation.events) {
      generationObservation.startObservation(
        'reasoning',
        {
          ...(reasoningEvent.metadata ? { metadata: reasoningEvent.metadata } : {}),
          ...(reasoningEvent.output === undefined ? {} : { output: reasoningEvent.output }),
        },
        {
          asType: LANGFUSE_OBSERVATION_TAXONOMY.current.reasoningSummary.asType,
          startTime: new Date(reasoningEvent.timestamp),
        },
      )
    }

    for (const tool of generation.tools) {
      exportToolObservation(tool, generationObservation)
    }

    endObservation(generationObservation, generation.endTime)
  }

  for (const tool of run.tools) {
    exportToolObservation(tool, observation)
  }

  for (const childRun of run.childRuns) {
    exportRunObservation(childRun, observation)
  }

  endObservation(observation, run.endTime)
}

export const exportToolObservation = (
  tool: ExportTool,
  parent: { startObservation: (...args: any[]) => any },
) => {
  const observation = parent.startObservation(
    tool.name,
    {
      ...(tool.input === undefined ? {} : { input: tool.input }),
      ...(tool.level ? { level: tool.level } : {}),
      ...(tool.metadata ? { metadata: tool.metadata } : {}),
      ...(tool.output === undefined ? {} : { output: tool.output }),
      ...(tool.statusMessage ? { statusMessage: tool.statusMessage } : {}),
    },
    {
      asType: tool.asType ?? LANGFUSE_OBSERVATION_TAXONOMY.current.toolCall.asType,
      startTime: new Date(tool.startTime),
    },
  )

  for (const childRun of tool.childRuns) {
    exportRunObservation(childRun, observation)
  }

  endObservation(observation, tool.endTime)
}
