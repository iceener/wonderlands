import { isRecord } from '../../../../../domain/ai/json-utils'
import type { RunRecord } from '../../../../../domain/runtime/run-repository'
import {
  hasNonMessageOutputItem,
  toStructuredGenerationOutputItems,
  toStructuredGenerationToolCalls,
  toStructuredGenerationTools,
  toStructuredMessages,
  toStructuredNativeTools,
} from '../content-normalization'
import { toObservationId } from '../ids'
import { asNumber, asString, toErrorOutput } from '../normalization'
import type { EventPayload, ExportTool } from '../types'
import { collectChildRunMetadata, toAgentMetadata } from './agent-metadata'
import { toRunIdsMetadata, toRuntimeMetadata } from './run-metadata'

export const toGenerationInput = (
  startedPayload: EventPayload | null,
  turnStartedPayload: EventPayload | null,
): Array<Record<string, unknown>> | Record<string, unknown> | undefined => {
  const structuredMessages = toStructuredMessages(startedPayload?.inputMessages)
  const tools = toStructuredGenerationTools(startedPayload?.tools)
  const nativeTools = toStructuredNativeTools(startedPayload?.nativeTools)

  if (structuredMessages && !tools && !nativeTools) {
    return structuredMessages
  }

  const input: Record<string, unknown> = {}

  if (structuredMessages) {
    input.messages = structuredMessages
  }

  if (tools) {
    input.tools = tools
  }

  if (nativeTools) {
    input.nativeTools = nativeTools
  }

  if (asString(startedPayload?.provider)) {
    input.provider = startedPayload?.provider
  }

  if (asString(startedPayload?.requestedModel)) {
    input.requestedModel = startedPayload?.requestedModel
  }

  if (asNumber(turnStartedPayload?.estimatedInputTokens) !== null) {
    input.estimatedInputTokens = turnStartedPayload?.estimatedInputTokens
  }

  if (asNumber(turnStartedPayload?.observationCount) !== null) {
    input.observationCount = turnStartedPayload?.observationCount
  }

  if (asNumber(turnStartedPayload?.pendingWaitCount) !== null) {
    input.pendingWaitCount = turnStartedPayload?.pendingWaitCount
  }

  return Object.keys(input).length > 0 ? input : undefined
}

export const toGenerationModelParameters = (
  payload: EventPayload | null,
): Record<string, number | string> | undefined => {
  const value = payload?.modelParameters

  if (!isRecord(value)) {
    return undefined
  }

  const modelParameters: Record<string, number | string> = {}

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      modelParameters[key] = entry
      continue
    }

    if (typeof entry === 'string' && entry.length > 0) {
      modelParameters[key] = entry
    }
  }

  return Object.keys(modelParameters).length > 0 ? modelParameters : undefined
}

export const toGenerationOutput = (
  completedPayload: EventPayload | null,
  failedPayload: EventPayload | null,
): unknown => {
  if (completedPayload) {
    const structuredMessages = toStructuredMessages(completedPayload.outputMessages)
    const outputItems = toStructuredGenerationOutputItems(completedPayload.outputItems)
    const toolCalls = toStructuredGenerationToolCalls(completedPayload.toolCalls)

    if (outputItems && hasNonMessageOutputItem(outputItems)) {
      return outputItems
    }

    if (structuredMessages) {
      return structuredMessages
    }

    if (outputItems) {
      return outputItems
    }

    if (toolCalls) {
      return toolCalls
    }

    const outputText = asString(completedPayload.outputText)

    if (outputText) {
      return outputText
    }

    const output: Record<string, unknown> = {}

    if (asString(completedPayload.status)) {
      output.status = completedPayload.status
    }

    if (asNumber(completedPayload.outputItemCount) !== null) {
      output.outputItemCount = completedPayload.outputItemCount
    }

    if (asNumber(completedPayload.toolCallCount) !== null) {
      output.toolCallCount = completedPayload.toolCallCount
    }

    return Object.keys(output).length > 0 ? output : undefined
  }

  if (failedPayload) {
    return toErrorOutput(failedPayload.error)
  }

  return undefined
}

export const toGenerationToolSummaryMetadata = (
  tools: readonly ExportTool[],
): Record<string, unknown> => {
  const toolNames: string[] = []
  const toolCallIds: string[] = []
  const toolStatuses: string[] = []
  const toolObservationIds: string[] = []
  const toolLevels: string[] = []
  const toolSummaries: string[] = []
  const delegatedChildAgentAliases = new Set<string>()
  const delegatedChildAgentIds = new Set<string>()
  const delegatedChildAgentNames = new Set<string>()
  const delegatedChildAgentRevisionIds = new Set<string>()
  const delegatedChildObservationIds = new Set<string>()
  const delegatedChildRunIds = new Set<string>()
  const delegatedChildTraceIds = new Set<string>()

  for (const tool of tools) {
    const metadata = tool.metadata ?? {}
    const callId = typeof metadata.callId === 'string' ? metadata.callId : null
    const status =
      tool.success === true
        ? 'completed'
        : tool.success === false
          ? 'failed'
          : tool.statusMessage?.startsWith('tool.waiting') ||
              tool.statusMessage === 'tool.confirmation_requested'
            ? 'waiting'
            : 'running'

    toolNames.push(tool.name)
    toolStatuses.push(status)
    toolObservationIds.push(toObservationId(tool.key))

    if (tool.level) {
      toolLevels.push(tool.level)
    }

    if (callId) {
      toolCallIds.push(callId)
    }

    const childRunMetadata = collectChildRunMetadata(tool.childRuns)

    for (const childRunId of childRunMetadata.childRunIds) {
      delegatedChildRunIds.add(childRunId)
    }

    for (const childAgentName of childRunMetadata.childAgentNames) {
      delegatedChildAgentNames.add(childAgentName)
    }

    for (const childAgentAlias of childRunMetadata.childAgentAliases) {
      delegatedChildAgentAliases.add(childAgentAlias)
    }

    for (const childAgentId of childRunMetadata.childAgentIds) {
      delegatedChildAgentIds.add(childAgentId)
    }

    for (const childAgentRevisionId of childRunMetadata.childAgentRevisionIds) {
      delegatedChildAgentRevisionIds.add(childAgentRevisionId)
    }

    for (const childObservationId of childRunMetadata.childObservationIds) {
      delegatedChildObservationIds.add(childObservationId)
    }

    for (const childTraceId of childRunMetadata.childTraceIds) {
      delegatedChildTraceIds.add(childTraceId)
    }

    toolSummaries.push(
      [
        tool.name,
        callId ? `#${callId}` : null,
        status,
        tool.childRuns.length > 0
          ? `child:${tool.childRuns.map((childRun) => childRun.name).join(',')}`
          : null,
      ]
        .filter((segment): segment is string => Boolean(segment))
        .join(' '),
    )
  }

  return {
    ...(toolNames.length > 0 ? { toolNames } : {}),
    ...(toolCallIds.length > 0 ? { toolCallIds } : {}),
    ...(toolStatuses.length > 0 ? { toolStatuses } : {}),
    ...(toolObservationIds.length > 0 ? { toolObservationIds } : {}),
    ...(toolLevels.length > 0 ? { toolLevels } : {}),
    ...(toolSummaries.length > 0 ? { toolSummaries } : {}),
    ...(toolSummaries.length > 0 ? { toolSummary: toolSummaries.join(' | ') } : {}),
    ...(delegatedChildRunIds.size > 0 ? { delegatedChildRunIds: [...delegatedChildRunIds] } : {}),
    ...(delegatedChildObservationIds.size > 0
      ? { delegatedChildObservationIds: [...delegatedChildObservationIds] }
      : {}),
    ...(delegatedChildTraceIds.size > 0
      ? { delegatedChildTraceIds: [...delegatedChildTraceIds] }
      : {}),
    ...(delegatedChildAgentNames.size > 0
      ? { delegatedChildAgentNames: [...delegatedChildAgentNames] }
      : {}),
    ...(delegatedChildAgentAliases.size > 0
      ? { delegatedChildAgentAliases: [...delegatedChildAgentAliases] }
      : {}),
    ...(delegatedChildAgentIds.size > 0
      ? { delegatedChildAgentIds: [...delegatedChildAgentIds] }
      : {}),
    ...(delegatedChildAgentRevisionIds.size > 0
      ? { delegatedChildAgentRevisionIds: [...delegatedChildAgentRevisionIds] }
      : {}),
    ...(delegatedChildAgentNames.size > 0
      ? { delegationSummary: [...delegatedChildAgentNames].join(', ') }
      : {}),
  }
}

export const toGenerationMetadata = (input: {
  completedPayload: EventPayload | null
  createdPayload: EventPayload | null
  generationKey: string
  run: RunRecord
  startedPayload: EventPayload | null
  tools: readonly ExportTool[]
  turn: number
  turnStartedPayload: EventPayload | null
}): Record<string, unknown> => {
  const agent = toAgentMetadata(input.run, input.createdPayload)

  return {
    ...(agent ?? {}),
    ...toRunIdsMetadata(input.run, input.generationKey),
    ...toRuntimeMetadata(input.run),
    targetKind: input.run.targetKind,
    turn: input.turn,
    ...(asNumber(input.turnStartedPayload?.estimatedInputTokens) !== null
      ? { estimatedInputTokens: input.turnStartedPayload?.estimatedInputTokens }
      : {}),
    ...(asNumber(input.turnStartedPayload?.observationCount) !== null
      ? { observationCount: input.turnStartedPayload?.observationCount }
      : {}),
    ...(asNumber(input.turnStartedPayload?.pendingWaitCount) !== null
      ? { pendingWaitCount: input.turnStartedPayload?.pendingWaitCount }
      : {}),
    ...(asString(input.startedPayload?.provider)
      ? { provider: input.startedPayload?.provider }
      : {}),
    ...(asString(input.startedPayload?.requestedModel)
      ? { requestedModel: input.startedPayload?.requestedModel }
      : {}),
    ...(asString(input.completedPayload?.providerRequestId)
      ? { providerRequestId: input.completedPayload?.providerRequestId }
      : {}),
    ...(asString(input.completedPayload?.responseId)
      ? { responseId: input.completedPayload?.responseId }
      : {}),
    ...(asString(input.completedPayload?.assistantMessageId)
      ? { assistantMessageId: input.completedPayload?.assistantMessageId }
      : {}),
    ...(asString(input.completedPayload?.status) ? { status: input.completedPayload?.status } : {}),
    ...(asNumber(input.completedPayload?.outputItemCount) !== null
      ? { outputItemCount: input.completedPayload?.outputItemCount }
      : {}),
    ...(asNumber(input.completedPayload?.toolCallCount) !== null
      ? { toolCallCount: input.completedPayload?.toolCallCount }
      : {}),
    ...(input.tools.length > 0 ? toGenerationToolSummaryMetadata(input.tools) : {}),
  }
}
