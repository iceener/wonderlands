import { isRecord } from '../../../../../domain/ai/json-utils'
import type { RunRecord } from '../../../../../domain/runtime/run-repository'
import { toObservationId, toTraceId } from '../ids'
import { asNumber, asString } from '../normalization'
import type { EventPayload } from '../types'
import { toAgentMetadata } from './agent-metadata'

export const toRunInput = (
  payload: EventPayload | null,
  taskFallback: string,
): string | undefined => {
  const task = asString(payload?.task) ?? taskFallback
  const instructions = asString(payload?.instructions)

  if (instructions && instructions !== task) {
    return `Task: ${task}\n\nInstructions:\n${instructions}`
  }

  return task || undefined
}

export const toRunOutput = (run: RunRecord, terminalPayload: EventPayload | null): unknown => {
  const payload = terminalPayload
  const outputText =
    asString(payload?.outputText) ??
    (isRecord(run.resultJson) ? asString(run.resultJson.outputText) : null)

  if (run.status === 'failed') {
    return outputText
      ? { error: payload?.error ?? run.errorJson ?? { message: outputText }, outputText }
      : (payload?.error ?? run.errorJson ?? undefined)
  }

  if (outputText) {
    return outputText
  }

  return isRecord(run.resultJson) ? run.resultJson : undefined
}

export const toRunIdsMetadata = (
  run: RunRecord,
  observationKey: string,
): Record<string, unknown> => ({
  observationId: toObservationId(observationKey),
  traceId: toTraceId(run.rootRunId),
  ...(run.actorAccountId ? { actorAccountId: run.actorAccountId } : {}),
  ...(run.jobId ? { jobId: run.jobId } : {}),
  ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
  rootRunId: run.rootRunId,
  runId: run.id,
  sessionId: run.sessionId,
  ...(run.sourceCallId ? { sourceCallId: run.sourceCallId } : {}),
  tenantId: run.tenantId,
  ...(run.threadId ? { threadId: run.threadId } : {}),
})

export const toRuntimeMetadata = (run: RunRecord): Record<string, unknown> => {
  const runtime: Record<string, unknown> = {
    ...(run.toolProfileId ? { toolProfileId: run.toolProfileId } : {}),
    ...(run.workspaceId ? { workspaceId: run.workspaceId } : {}),
    ...(run.workspaceRef ? { workspaceRef: run.workspaceRef } : {}),
  }

  if (isRecord(run.configSnapshot)) {
    if (asString(run.configSnapshot.apiBasePath)) {
      runtime.runtimeApiBasePath = run.configSnapshot.apiBasePath
    }

    if (asString(run.configSnapshot.model)) {
      runtime.runtimeModel = run.configSnapshot.model
    }

    if (asString(run.configSnapshot.modelAlias)) {
      runtime.runtimeModelAlias = run.configSnapshot.modelAlias
    }

    if (asString(run.configSnapshot.provider)) {
      runtime.runtimeProvider = run.configSnapshot.provider
    }

    if (asNumber(run.configSnapshot.maxOutputTokens) !== null) {
      runtime.runtimeMaxOutputTokens = run.configSnapshot.maxOutputTokens
    }

    if (asNumber(run.configSnapshot.temperature) !== null) {
      runtime.runtimeTemperature = run.configSnapshot.temperature
    }

    if (asString(run.configSnapshot.version)) {
      runtime.runtimeVersion = run.configSnapshot.version
    }

    if (isRecord(run.configSnapshot.reasoning)) {
      if (asString(run.configSnapshot.reasoning.effort)) {
        runtime.runtimeReasoningEffort = run.configSnapshot.reasoning.effort
      }

      if (asString(run.configSnapshot.reasoning.summary)) {
        runtime.runtimeReasoningSummary = run.configSnapshot.reasoning.summary
      }
    }
  }

  return runtime
}

export const toRunMetadata = (
  run: RunRecord,
  createdPayload: EventPayload | null,
  terminalPayload: EventPayload | null,
): Record<string, unknown> => {
  const agent = toAgentMetadata(run, createdPayload)

  return {
    ...(agent ?? {}),
    ...toRunIdsMetadata(run, `run:${run.id}`),
    ...toRuntimeMetadata(run),
    rootRunId: run.rootRunId,
    runId: run.id,
    status: run.status,
    targetKind: run.targetKind,
    ...(asString(terminalPayload?.assistantMessageId)
      ? { assistantMessageId: terminalPayload?.assistantMessageId }
      : {}),
    ...(asString(terminalPayload?.provider) ? { provider: terminalPayload?.provider } : {}),
    ...(asString(terminalPayload?.providerRequestId)
      ? { providerRequestId: terminalPayload?.providerRequestId }
      : {}),
    ...(asString(terminalPayload?.responseId) ? { responseId: terminalPayload?.responseId } : {}),
    ...(asString(terminalPayload?.model) ? { model: terminalPayload?.model } : {}),
    ...(run.sourceCallId ? { sourceCallId: run.sourceCallId } : {}),
  }
}

export const toRunWaitingStatusMessage = (payload: EventPayload | null): string | undefined => {
  if (!payload) {
    return undefined
  }

  if (Array.isArray(payload.pendingWaits) && payload.pendingWaits.length > 0) {
    return `run.waiting:${payload.pendingWaits.length}`
  }

  if (Array.isArray(payload.waitIds) && payload.waitIds.length > 0) {
    return `run.waiting:${payload.waitIds.length}`
  }

  return 'run.waiting'
}
