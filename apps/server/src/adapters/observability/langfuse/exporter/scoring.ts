import { type LangfuseAPIClient, LangfuseAPIError } from '@langfuse/core'

import type { DomainError } from '../../../../shared/errors'
import { err, ok, type Result } from '../../../../shared/result'
import { toLangfuseProviderError } from './errors'
import { toObservationId, toScoreId, toTraceId } from './ids'
import type { ExportRun, ExportTrace } from './types'

export const appendScores = async (input: {
  apiClient: LangfuseAPIClient
  environment: string
  timeoutMs: number
  trace: ExportTrace
}): Promise<Result<null, DomainError>> => {
  const traceId = toTraceId(input.trace.traceKey)
  const requests: Array<{
    id: string
    name: string
    observationId?: string
    value: 0 | 1
  }> = []

  if (input.trace.rootRun.success !== null) {
    requests.push({
      id: toScoreId(traceId, 'run.success', 'trace'),
      name: 'run.success',
      value: input.trace.rootRun.success ? 1 : 0,
    })
  }

  const appendToolScores = (run: ExportRun) => {
    for (const generation of run.generations) {
      for (const tool of generation.tools) {
        if (tool.success !== null) {
          requests.push({
            id: toScoreId(traceId, 'tool.success', toObservationId(tool.key)),
            name: 'tool.success',
            observationId: toObservationId(tool.key),
            value: tool.success ? 1 : 0,
          })
        }

        for (const childRun of tool.childRuns) {
          appendToolScores(childRun)
        }
      }
    }

    for (const tool of run.tools) {
      if (tool.success !== null) {
        requests.push({
          id: toScoreId(traceId, 'tool.success', toObservationId(tool.key)),
          name: 'tool.success',
          observationId: toObservationId(tool.key),
          value: tool.success ? 1 : 0,
        })
      }

      for (const childRun of tool.childRuns) {
        appendToolScores(childRun)
      }
    }

    for (const childRun of run.childRuns) {
      appendToolScores(childRun)
    }
  }

  appendToolScores(input.trace.rootRun)

  for (const request of requests) {
    try {
      await input.apiClient.legacy.scoreV1.create(
        {
          dataType: 'BOOLEAN',
          environment: input.environment,
          id: request.id,
          name: request.name,
          traceId,
          ...(request.observationId ? { observationId: request.observationId } : {}),
          value: request.value,
        },
        {
          timeoutInSeconds: Math.max(1, Math.ceil(input.timeoutMs / 1000)),
        },
      )
    } catch (error) {
      if (error instanceof LangfuseAPIError && error.statusCode === 409) {
        continue
      }

      return err(toLangfuseProviderError('Langfuse score request failed', error))
    }
  }

  return ok(null)
}
