import { toObservationId } from '../ids'
import { asString, findTurn } from '../normalization'
import type { EventPayload, ExportRun } from '../types'
import { collectChildRunMetadata } from './agent-metadata'

export const toToolMetadata = (input: {
  childRuns: readonly ExportRun[]
  key: string
  payload: EventPayload | null
}): Record<string, unknown> => {
  const childRunMetadata = collectChildRunMetadata(input.childRuns)

  return {
    observationId: toObservationId(input.key),
    ...(asString(input.payload?.rootRunId) ? { rootRunId: input.payload?.rootRunId } : {}),
    ...(asString(input.payload?.runId) ? { runId: input.payload?.runId } : {}),
    ...(asString(input.payload?.sessionId) ? { sessionId: input.payload?.sessionId } : {}),
    ...(asString(input.payload?.threadId) ? { threadId: input.payload?.threadId } : {}),
    ...(asString(input.payload?.parentRunId) ? { parentRunId: input.payload?.parentRunId } : {}),
    ...(asString(input.payload?.callId) ? { callId: input.payload?.callId } : {}),
    ...(asString(input.payload?.description) ? { description: input.payload?.description } : {}),
    ...(asString(input.payload?.tool) ? { tool: input.payload?.tool } : {}),
    ...(asString(input.payload?.waitId) ? { waitId: input.payload?.waitId } : {}),
    ...(asString(input.payload?.waitTargetKind)
      ? { waitTargetKind: input.payload?.waitTargetKind }
      : {}),
    ...(asString(input.payload?.waitTargetRef)
      ? { waitTargetRef: input.payload?.waitTargetRef }
      : {}),
    ...(asString(input.payload?.waitTargetRunId)
      ? { waitTargetRunId: input.payload?.waitTargetRunId }
      : {}),
    ...(asString(input.payload?.waitType) ? { waitType: input.payload?.waitType } : {}),
    ...(findTurn(input.payload) !== null ? { turn: findTurn(input.payload) } : {}),
    ...(input.childRuns.length > 0
      ? {
          childAgentAliases: childRunMetadata.childAgentAliases,
          childAgentIds: childRunMetadata.childAgentIds,
          childAgentNames: childRunMetadata.childAgentNames,
          childAgentRevisionIds: childRunMetadata.childAgentRevisionIds,
          childObservationIds: childRunMetadata.childObservationIds,
          childRunCount: input.childRuns.length,
          childRunIds: childRunMetadata.childRunIds,
          childTraceIds: childRunMetadata.childTraceIds,
        }
      : {}),
  }
}

export const toWebSearchMetadata = (payload: EventPayload | null): Record<string, unknown> => ({
  ...(asString(payload?.provider) ? { provider: payload?.provider } : {}),
  ...(asString(payload?.responseId) ? { responseId: payload?.responseId } : {}),
  ...(asString(payload?.searchId) ? { searchId: payload?.searchId } : {}),
  ...(findTurn(payload) !== null ? { turn: findTurn(payload) } : {}),
})

export const toToolWaitingOutput = (
  payload: EventPayload | null,
): Record<string, unknown> | undefined => {
  if (!payload) {
    return undefined
  }

  const output: Record<string, unknown> = {}

  if (asString(payload.description)) {
    output.description = payload.description
  }

  if (asString(payload.waitId)) {
    output.waitId = payload.waitId
  }

  if (asString(payload.waitTargetKind)) {
    output.waitTargetKind = payload.waitTargetKind
  }

  if (asString(payload.waitTargetRef)) {
    output.waitTargetRef = payload.waitTargetRef
  }

  if (asString(payload.waitTargetRunId)) {
    output.waitTargetRunId = payload.waitTargetRunId
  }

  if (asString(payload.waitType)) {
    output.waitType = payload.waitType
  }

  return Object.keys(output).length > 0 ? output : undefined
}
