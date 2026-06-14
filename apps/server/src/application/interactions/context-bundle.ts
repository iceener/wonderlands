import { createHash } from 'node:crypto'

import type { AiInteractionRequest, AiMessage, AiMessageContent } from '../../domain/ai/types'
import type { MemoryRecordRecord } from '../../domain/memory/memory-record-repository'
import type { ContextSummaryRecord } from '../../domain/runtime/context-summary-repository'
import type { ItemRecord } from '../../domain/runtime/item-repository'
import type { RunDependencyRecord } from '../../domain/runtime/run-dependency-repository'
import type { RunRecord } from '../../domain/runtime/run-repository'
import type { SessionMessageRecord } from '../../domain/sessions/session-message-repository'
import { estimateDataUrlBytes } from '../../shared/data-url'
import type { AgentRevisionId } from '../../shared/ids'
import type { AttachmentRefDescriptor } from '../files/attachment-ref-context'
import type { VisibleFileContextEntry } from '../files/file-context'
import type { GardenAgentContext } from '../garden/garden-agent-context'

export interface AgentCapabilityContext {
  description: string | null
  kind: 'mcp' | 'native' | 'provider'
  name: string
  title: string | null
}

export type ContextLayerKind =
  | 'system_prompt'
  | 'agent_profile'
  | 'capability_guidance'
  | 'garden_context'
  | 'attachment_ref_rules'
  | 'attachment_ref_context'
  | 'tool_context'
  | 'session_metadata'
  | 'summary_memory'
  | 'run_transcript'
  | 'visible_message_history'
  | 'file_context'
  | 'pending_waits'
  | 'run_local_memory'

export type ContextLayerVolatility = 'stable' | 'volatile'

export interface AgentProfileContext {
  instructionsMd: string
  revisionId: AgentRevisionId
  subagents: Array<{
    alias: string
    childAgentId: string
    childDescription: string | null
    childName: string | null
    childSlug: string
    delegationMode: string
    tools: AgentCapabilityContext[]
  }>
}

export interface ThreadContextData {
  attachmentRefs: AttachmentRefDescriptor[]
  agentProfile: AgentProfileContext | null
  activeReflection: MemoryRecordRecord | null
  gardenContext: GardenAgentContext | null
  items: ItemRecord[]
  observations: MemoryRecordRecord[]
  pendingWaits: RunDependencyRecord[]
  run: RunRecord
  summary: ContextSummaryRecord | null
  visibleFiles: VisibleFileContextEntry[]
  visibleMessages: SessionMessageRecord[]
}

export interface ContextLayer {
  estimatedInputTokens: number
  kind: ContextLayerKind
  messages: AiMessage[]
  volatility: ContextLayerVolatility
}

export interface ContextLayerBudgetReport {
  estimatedInputTokens: number
  kind: ContextLayerKind
  messageCount: number
  volatility: ContextLayerVolatility
}

export interface ContextBudgetReport {
  calibratedEstimatedInputTokens: number | null
  estimatorVersion: 'calibrated_v1' | 'rough_v1'
  layerReports: ContextLayerBudgetReport[]
  rawEstimatedInputTokens: number
  requestOverheadTokens: number
  reservedOutputTokens: number | null
  stablePrefixHash: string
  stablePrefixTokens: number
  volatileSuffixTokens: number
}

export interface ThreadContextBundle extends ThreadContextData {
  budget: ContextBudgetReport
  layers: ContextLayer[]
}

export interface ContextBudgetCalibrationInput {
  latestActualInputTokens: number | null
  latestCachedTokens: number | null
  latestEstimatedInputTokens: number | null
}

const estimateTextTokens = (text: string): number => {
  const normalized = text.trim()

  if (normalized.length === 0) {
    return 0
  }

  return Math.max(1, Math.ceil(normalized.length / 4))
}

const estimateUnknownTokens = (value: unknown): number =>
  estimateTextTokens(JSON.stringify(value ?? null))

const estimateImageTokens = (
  detail: Extract<AiMessageContent, { type: 'image_url' | 'image_file' }>['detail'],
): number => {
  switch (detail) {
    case 'low':
      return 256
    case 'high':
      return 1024
    case 'original':
      return 1536
    case 'auto':
    case undefined:
      return 512
  }
}

const toBudgetRequestOverhead = (
  request:
    | Pick<AiInteractionRequest, 'nativeTools' | 'responseFormat' | 'toolChoice' | 'tools'>
    | undefined,
): Record<string, unknown> | null => {
  const responseFormat =
    request?.responseFormat?.type === 'json_schema' ? request.responseFormat : undefined
  const normalized = Object.fromEntries(
    Object.entries({
      nativeTools: request?.nativeTools?.length ? request.nativeTools : undefined,
      responseFormat,
      toolChoice: request?.toolChoice,
      tools: request?.tools?.length ? request.tools : undefined,
    }).filter(([, value]) => value !== undefined),
  )

  return Object.keys(normalized).length > 0 ? normalized : null
}

const estimateContentTokens = (content: AiMessageContent): number => {
  switch (content.type) {
    case 'text':
      return estimateTextTokens(content.text)
    case 'image_url':
      if (content.url.startsWith('data:')) {
        return Math.max(
          estimateImageTokens(content.detail),
          Math.min(estimateDataUrlBytes(content.url) ?? 0, 256),
        )
      }

      return estimateImageTokens(content.detail)
    case 'image_file':
      return estimateImageTokens(content.detail)
    case 'file_url':
      return estimateTextTokens(content.url)
    case 'file_id':
      return estimateTextTokens(content.fileId)
    case 'function_call':
      return estimateTextTokens(content.name) + estimateTextTokens(content.argumentsJson)
    case 'function_result':
      return estimateTextTokens(content.name) + estimateTextTokens(content.outputJson)
    case 'reasoning':
      return estimateUnknownTokens(content.summary)
  }
}

export const estimateMessageTokens = (message: AiMessage): number =>
  message.content.reduce(
    (total, content) => total + estimateContentTokens(content),
    estimateTextTokens(message.role),
  )

export const createContextLayer = (
  kind: ContextLayerKind,
  volatility: ContextLayerVolatility,
  messages: AiMessage[],
): ContextLayer => ({
  estimatedInputTokens: messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  ),
  kind,
  messages,
  volatility,
})

export const createContextBudgetReport = (
  layers: ContextLayer[],
  reservedOutputTokens: number | null,
  request:
    | Pick<AiInteractionRequest, 'nativeTools' | 'responseFormat' | 'toolChoice' | 'tools'>
    | undefined = undefined,
): ContextBudgetReport => {
  const layerReports = layers.map((layer) => ({
    estimatedInputTokens: layer.estimatedInputTokens,
    kind: layer.kind,
    messageCount: layer.messages.length,
    volatility: layer.volatility,
  }))
  const requestOverhead = toBudgetRequestOverhead(request)
  const requestOverheadTokens = requestOverhead ? estimateUnknownTokens(requestOverhead) : 0

  const stableLayers = layers
    .filter((layer) => layer.volatility === 'stable')
    .map((layer) => ({
      kind: layer.kind,
      messages: layer.messages,
    }))
  const stablePrefixHash = createHash('sha256')
    .update(
      JSON.stringify({
        requestOverhead,
        stableLayers,
      }),
    )
    .digest('hex')
  const stablePrefixTokens = layerReports
    .filter((layer) => layer.volatility === 'stable')
    .reduce((total, layer) => total + layer.estimatedInputTokens, requestOverheadTokens)
  const volatileSuffixTokens = layerReports
    .filter((layer) => layer.volatility === 'volatile')
    .reduce((total, layer) => total + layer.estimatedInputTokens, 0)

  return {
    calibratedEstimatedInputTokens: null,
    estimatorVersion: 'rough_v1',
    layerReports,
    rawEstimatedInputTokens: stablePrefixTokens + volatileSuffixTokens,
    requestOverheadTokens,
    reservedOutputTokens,
    stablePrefixHash,
    stablePrefixTokens,
    volatileSuffixTokens,
  }
}

export const applyLatestBudgetCalibration = (
  report: ContextBudgetReport,
  input: ContextBudgetCalibrationInput | null,
): ContextBudgetReport => {
  if (!input) {
    return report
  }

  const originalEstimatedInputTokens = report.rawEstimatedInputTokens
  let calibratedEstimatedInputTokens = originalEstimatedInputTokens
  let calibratedStablePrefixTokens = report.stablePrefixTokens

  if (typeof input.latestCachedTokens === 'number' && input.latestCachedTokens > 0) {
    calibratedStablePrefixTokens = Math.max(calibratedStablePrefixTokens, input.latestCachedTokens)
    calibratedEstimatedInputTokens = Math.max(
      calibratedEstimatedInputTokens,
      calibratedStablePrefixTokens + report.volatileSuffixTokens,
    )
  }

  if (
    typeof input.latestActualInputTokens === 'number' &&
    typeof input.latestEstimatedInputTokens === 'number'
  ) {
    const missingDelta = input.latestActualInputTokens - input.latestEstimatedInputTokens

    if (missingDelta > 0) {
      calibratedEstimatedInputTokens = Math.max(
        calibratedEstimatedInputTokens,
        originalEstimatedInputTokens + missingDelta,
      )
      calibratedStablePrefixTokens = Math.max(
        calibratedStablePrefixTokens,
        calibratedEstimatedInputTokens - report.volatileSuffixTokens,
      )
    }
  }

  if (calibratedEstimatedInputTokens === originalEstimatedInputTokens) {
    return report
  }

  return {
    ...report,
    calibratedEstimatedInputTokens,
    estimatorVersion: 'calibrated_v1',
    rawEstimatedInputTokens: calibratedEstimatedInputTokens,
    stablePrefixTokens: calibratedStablePrefixTokens,
  }
}
