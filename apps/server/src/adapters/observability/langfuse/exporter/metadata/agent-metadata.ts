import type { RunRecord } from '../../../../../domain/runtime/run-repository'
import { asString, toDisplayNameFromAlias } from '../normalization'
import type { EventPayload, ExportRun } from '../types'

export const toRunObservationName = (
  run: RunRecord,
  createdPayload: EventPayload | null,
): string => {
  const agentName = asString(createdPayload?.agentName) ?? asString(createdPayload?.childAgentName)

  if (agentName) {
    return agentName
  }

  const alias = asString(createdPayload?.agentAlias) ?? asString(createdPayload?.alias)
  const aliasDisplay = toDisplayNameFromAlias(alias)

  if (aliasDisplay) {
    return aliasDisplay
  }

  return run.parentRunId ? 'agent-run.child' : 'agent-run.root'
}

export const toAgentMetadata = (
  run: RunRecord,
  createdPayload: EventPayload | null,
): Record<string, unknown> | undefined => {
  const agentId = run.agentId ?? asString(createdPayload?.agentId)
  const agentRevisionId = run.agentRevisionId ?? asString(createdPayload?.agentRevisionId)
  const alias = asString(createdPayload?.agentAlias) ?? asString(createdPayload?.alias)
  const name =
    asString(createdPayload?.agentName) ??
    asString(createdPayload?.childAgentName) ??
    toRunObservationName(run, createdPayload)

  const agent: Record<string, unknown> = {
    ...(agentId ? { agentId } : {}),
    ...(agentRevisionId ? { agentRevisionId } : {}),
    ...(alias ? { agentAlias: alias } : {}),
    ...(name ? { agentName: name } : {}),
  }

  return Object.keys(agent).length > 0 ? agent : undefined
}

export const collectChildRunMetadata = (childRuns: readonly ExportRun[]) => {
  const childAgentAliases = new Set<string>()
  const childAgentIds = new Set<string>()
  const childAgentNames = new Set<string>()
  const childAgentRevisionIds = new Set<string>()
  const childObservationIds = new Set<string>()
  const childRunIds = new Set<string>()
  const childTraceIds = new Set<string>()

  for (const childRun of childRuns) {
    childAgentNames.add(childRun.name)

    if (typeof childRun.metadata?.agentAlias === 'string') {
      childAgentAliases.add(childRun.metadata.agentAlias)
    }

    if (typeof childRun.metadata?.agentId === 'string') {
      childAgentIds.add(childRun.metadata.agentId)
    }

    if (typeof childRun.metadata?.agentRevisionId === 'string') {
      childAgentRevisionIds.add(childRun.metadata.agentRevisionId)
    }

    if (typeof childRun.metadata?.observationId === 'string') {
      childObservationIds.add(childRun.metadata.observationId)
    }

    if (typeof childRun.metadata?.runId === 'string') {
      childRunIds.add(childRun.metadata.runId)
    }

    if (typeof childRun.metadata?.traceId === 'string') {
      childTraceIds.add(childRun.metadata.traceId)
    }
  }

  return {
    childAgentAliases: [...childAgentAliases],
    childAgentIds: [...childAgentIds],
    childAgentNames: [...childAgentNames],
    childAgentRevisionIds: [...childAgentRevisionIds],
    childObservationIds: [...childObservationIds],
    childRunIds: [...childRunIds],
    childTraceIds: [...childTraceIds],
  }
}
