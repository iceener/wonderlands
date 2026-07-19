import { isRecord } from '../../../../../domain/ai/json-utils'
import type { RunRecord } from '../../../../../domain/runtime/run-repository'
import { asString, toTag, truncateText } from '../normalization'
import type { EventPayload } from '../types'

export const toRootTraceMetadata = (input: {
  createdPayload: EventPayload | null
  run: RunRecord
  terminalPayload: EventPayload | null
}): Record<string, string> => {
  const agentId = asString(input.createdPayload?.agentId)
  const agentName = asString(input.createdPayload?.agentName)
  const provider = asString(input.terminalPayload?.provider)
  const model = asString(input.terminalPayload?.model)
  const runtimeApiBasePath = isRecord(input.run.configSnapshot)
    ? asString(input.run.configSnapshot.apiBasePath)
    : null
  const runtimeModelAlias = isRecord(input.run.configSnapshot)
    ? asString(input.run.configSnapshot.modelAlias)
    : null
  const runtimeProvider = isRecord(input.run.configSnapshot)
    ? asString(input.run.configSnapshot.provider)
    : null
  const runtimeVersion = isRecord(input.run.configSnapshot)
    ? asString(input.run.configSnapshot.version)
    : null
  const runtimeReasoningEffort =
    isRecord(input.run.configSnapshot) && isRecord(input.run.configSnapshot.reasoning)
      ? asString(input.run.configSnapshot.reasoning.effort)
      : null

  return {
    appSessionId: input.run.sessionId,
    ...(input.run.actorAccountId ? { actorAccountId: input.run.actorAccountId } : {}),
    rootRunId: input.run.id,
    source: '05_04_api',
    status: input.run.status,
    targetKind: input.run.targetKind,
    tenantId: input.run.tenantId,
    ...(input.run.toolProfileId ? { toolProfileId: input.run.toolProfileId } : {}),
    ...(input.run.workspaceId ? { workspaceId: input.run.workspaceId } : {}),
    ...(input.run.workspaceRef ? { workspaceRef: input.run.workspaceRef } : {}),
    ...(input.run.threadId ? { threadId: input.run.threadId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(agentName ? { agentName } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(runtimeApiBasePath ? { runtimeApiBasePath } : {}),
    ...(runtimeModelAlias ? { runtimeModelAlias } : {}),
    ...(runtimeProvider ? { runtimeProvider } : {}),
    ...(runtimeVersion ? { runtimeVersion } : {}),
    ...(runtimeReasoningEffort ? { runtimeReasoningEffort } : {}),
  }
}

export const toRootTraceName = (input: {
  createdPayload: EventPayload | null
  rootRun: RunRecord
  rootRunName: string
}): string => {
  const agentName = asString(input.createdPayload?.agentName) ?? input.rootRunName
  const task = asString(input.createdPayload?.task) ?? input.rootRun.task

  if (agentName && task) {
    return truncateText(`${agentName}: ${task}`, 200)
  }

  if (task) {
    return truncateText(task, 200)
  }

  return truncateText(agentName, 200)
}

export const toRootTraceTags = (input: {
  createdPayload: EventPayload | null
  rootRun: RunRecord
  terminalPayload: EventPayload | null
}): string[] => {
  const alias = asString(input.createdPayload?.agentAlias) ?? asString(input.createdPayload?.alias)

  return [
    ...new Set(
      [
        '05_04_api',
        toTag('target', input.rootRun.targetKind),
        toTag('status', input.rootRun.status),
        toTag('agent', alias),
        toTag('provider', asString(input.terminalPayload?.provider)),
        toTag('model', asString(input.terminalPayload?.model)),
      ].filter((value): value is string => Boolean(value)),
    ),
  ]
}
