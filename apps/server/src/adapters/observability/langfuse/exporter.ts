import { randomBytes } from 'node:crypto'
import { LangfuseAPIClient, LangfuseAPIError, type UsageDetails } from '@langfuse/core'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { propagateAttributes, setLangfuseTracerProvider, startObservation } from '@langfuse/tracing'
import type { TracerProvider } from '@opentelemetry/api'
import { NodeSDK } from '@opentelemetry/sdk-node'
import type { SpanExporter } from '@opentelemetry/sdk-trace-base'

import { isRecord } from '../../../domain/ai/json-utils'
import type { RepositoryDatabase } from '../../../db/repository-database'
import type { DomainEventEnvelope } from '../../../domain/events/domain-event'
import { createDomainEventRepository } from '../../persistence/sqlite/events/domain-event-repository'
import type { EventOutboxRecord } from '../../../domain/events/event-outbox-repository'
import type { RunRecord } from '../../../domain/runtime/run-repository'
import { createRunRepository } from '../../persistence/sqlite/runtime/run-repository'
import type { DomainError } from '../../../shared/errors'
import { asAccountId, asRunId } from '../../../shared/ids'
import type { AppLogger } from '../../../shared/logger'
import { err, ok, type Result } from '../../../shared/result'
import type { TenantScope } from '../../../shared/scope'
import { LANGFUSE_OBSERVATION_TAXONOMY } from './observation-taxonomy'
import { toLangfuseObservationId, toLangfuseTraceId } from './trace-identity'

export interface LangfuseExporterConfig {
  baseUrl: string | null
  enabled: boolean
  environment: string
  publicKey: string | null
  secretKey: string | null
  timeoutMs: number
}

export interface LangfuseExporter {
  enabled: boolean
  environment: string
  exportOutboxEntry: (entry: EventOutboxRecord) => Promise<Result<null, DomainError>>
  shutdown: () => Promise<void>
}

type EventPayload = Record<string, unknown>

type ObservationLevel = 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR'

interface ExportReasoningEvent {
  key: string
  metadata?: Record<string, unknown>
  output?: unknown
  timestamp: string
}

interface ExportGeneration {
  endTime: string
  events: ExportReasoningEvent[]
  input?: unknown
  key: string
  level?: ObservationLevel
  metadata?: Record<string, unknown>
  model?: string
  modelParameters?: Record<string, number | string>
  name: string
  output?: unknown
  startTime: string
  statusMessage?: string
  tools: ExportTool[]
  usageDetails?: UsageDetails
}

interface ExportTool {
  asType?:
    | typeof LANGFUSE_OBSERVATION_TAXONOMY.current.toolCall.asType
    | typeof LANGFUSE_OBSERVATION_TAXONOMY.current.webSearch.asType
  childRuns: ExportRun[]
  endTime: string
  input?: unknown
  key: string
  level?: ObservationLevel
  metadata?: Record<string, unknown>
  name: string
  output?: unknown
  startTime: string
  statusMessage?: string
  success: boolean | null
}

interface ExportRun {
  childRuns: ExportRun[]
  endTime: string
  generations: ExportGeneration[]
  input?: unknown
  key: string
  level?: ObservationLevel
  metadata?: Record<string, unknown>
  name: string
  output?: unknown
  startTime: string
  statusMessage?: string
  success: boolean | null
  taxonomyStage: 'childRun' | 'rootRun'
  tools: ExportTool[]
}

interface ExportTrace {
  metadata?: Record<string, string>
  name: string
  rootRun: ExportRun
  sessionId?: string
  tags?: string[]
  traceKey: string
  userId?: string
}

type OTelIdGenerator = {
  generateSpanId: () => string
  generateTraceId: () => string
}

const isTerminalRootRunEvent = (entry: EventOutboxRecord): boolean => {
  if (entry.event.type !== 'run.completed' && entry.event.type !== 'run.failed') {
    return false
  }

  if (!isRecord(entry.event.payload)) {
    return false
  }

  const runId = asString(entry.event.payload.runId)
  const rootRunId = asString(entry.event.payload.rootRunId) ?? runId

  return runId !== null && rootRunId !== null && runId === rootRunId
}

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '')

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const toDisplayNameFromAlias = (value: string | null): string | null => {
  if (!value) {
    return null
  }

  return value
    .split(/[-_\s]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
    .join(' ')
}

const toEventPayload = (event: DomainEventEnvelope<unknown>): EventPayload | null =>
  isRecord(event.payload) ? event.payload : null

const toRunInput = (payload: EventPayload | null, taskFallback: string): string | undefined => {
  const task = asString(payload?.task) ?? taskFallback
  const instructions = asString(payload?.instructions)

  if (instructions && instructions !== task) {
    return `Task: ${task}\n\nInstructions:\n${instructions}`
  }

  return task || undefined
}

const toErrorOutput = (value: unknown): Record<string, unknown> | string | undefined => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  if (isRecord(value)) {
    return value
  }

  return value === undefined ? undefined : { error: value }
}

const toErrorMessage = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  if (isRecord(value)) {
    return asString(value.message) ?? undefined
  }

  return undefined
}

const truncateText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

const normalizeTagValue = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')

const toTag = (prefix: string, value: string | null): string | null => {
  if (!value) {
    return null
  }

  const normalized = normalizeTagValue(value)

  if (normalized.length === 0) {
    return null
  }

  return truncateText(`${prefix}:${normalized}`, 200)
}

const tryParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const toStructuredContentPart = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) {
    return null
  }

  const type = asString(value.type)

  if (!type) {
    return null
  }

  if (type === 'text') {
    const text = asString(value.text)

    if (!text) {
      return null
    }

    return {
      ...(value.thought === true ? { thought: true } : {}),
      ...(asString(value.thoughtSignature) ? { thoughtSignature: value.thoughtSignature } : {}),
      text,
      type,
    }
  }

  if (type === 'image_url') {
    const url = asString(value.url)

    if (!url) {
      return null
    }

    return {
      ...(asString(value.mimeType) ? { mimeType: value.mimeType } : {}),
      image_url: {
        ...(asString(value.detail) ? { detail: value.detail } : {}),
        url,
      },
      type,
    }
  }

  if (type === 'image_file') {
    const fileId = asString(value.fileId)

    if (!fileId) {
      return null
    }

    return {
      ...(asString(value.detail) ? { detail: value.detail } : {}),
      ...(asString(value.mimeType) ? { mimeType: value.mimeType } : {}),
      fileId,
      type,
    }
  }

  if (type === 'file_url') {
    const url = asString(value.url)

    if (!url) {
      return null
    }

    return {
      ...(asString(value.filename) ? { filename: value.filename } : {}),
      ...(asString(value.mimeType) ? { mimeType: value.mimeType } : {}),
      type,
      url,
    }
  }

  if (type === 'file_id') {
    const fileId = asString(value.fileId)

    if (!fileId) {
      return null
    }

    return {
      ...(asString(value.filename) ? { filename: value.filename } : {}),
      ...(asString(value.mimeType) ? { mimeType: value.mimeType } : {}),
      fileId,
      type,
    }
  }

  if (type === 'function_call') {
    const callId = asString(value.callId)
    const name = asString(value.name)
    const argumentsJson = asString(value.argumentsJson)

    if (!callId || !name || !argumentsJson) {
      return null
    }

    return {
      arguments: tryParseJson(argumentsJson),
      argumentsJson,
      callId,
      name,
      ...(asString(value.thoughtSignature) ? { thoughtSignature: value.thoughtSignature } : {}),
      type,
    }
  }

  if (type === 'function_result') {
    const callId = asString(value.callId)
    const name = asString(value.name)
    const outputJson = asString(value.outputJson)

    if (!callId || !name || !outputJson) {
      return null
    }

    return {
      callId,
      ...(value.isError === true ? { isError: true } : {}),
      name,
      output: tryParseJson(outputJson),
      outputJson,
      type,
    }
  }

  if (type === 'reasoning') {
    const id = asString(value.id)

    if (!id) {
      return null
    }

    return {
      ...(value.encryptedContent !== undefined ? { encryptedContent: value.encryptedContent } : {}),
      id,
      summary: value.summary ?? null,
      ...(asString(value.text) ? { text: value.text } : {}),
      ...(value.thought === true ? { thought: true } : {}),
      type,
    }
  }

  return { ...value, type }
}

const toStructuredMessages = (value: unknown): Array<Record<string, unknown>> | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const messages: Array<Record<string, unknown>> = []

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue
    }

    const role = asString(entry.role)

    if (!role) {
      continue
    }

    if (Array.isArray(entry.content)) {
      const content = entry.content.flatMap((part) => {
        const normalized = toStructuredContentPart(part)
        return normalized ? [normalized] : []
      })

      if (content.length === 0) {
        continue
      }

      const phase = asString(entry.phase)
      const providerMessageId = asString(entry.providerMessageId)
      messages.push({
        content,
        ...(phase ? { phase } : {}),
        ...(providerMessageId ? { providerMessageId } : {}),
        role,
      })
      continue
    }

    const content = asString(entry.content)

    if (!content) {
      continue
    }

    const phase = asString(entry.phase)
    const providerMessageId = asString(entry.providerMessageId)
    messages.push({
      content,
      ...(phase ? { phase } : {}),
      ...(providerMessageId ? { providerMessageId } : {}),
      role,
    })
  }

  return messages.length > 0 ? messages : undefined
}

const toStructuredGenerationTools = (
  value: unknown,
): Array<Record<string, unknown>> | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const tools: Array<Record<string, unknown>> = []

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue
    }

    const kind = asString(entry.kind) ?? asString(entry.type)
    const name = asString(entry.name)

    if (!kind || !name) {
      continue
    }

    tools.push({
      ...(asString(entry.description) ? { description: entry.description } : {}),
      kind,
      name,
      ...(isRecord(entry.parameters) ? { parameters: entry.parameters } : {}),
      ...(typeof entry.strict === 'boolean' ? { strict: entry.strict } : {}),
      type: kind,
    })
  }

  return tools.length > 0 ? tools : undefined
}

const toStructuredNativeTools = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const nativeTools = value.flatMap((entry) =>
    typeof entry === 'string' && entry.trim().length > 0 ? [entry] : [],
  )

  return nativeTools.length > 0 ? nativeTools : undefined
}

const toStructuredGenerationOutputItems = (
  value: unknown,
): Array<Record<string, unknown>> | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const outputItems: Array<Record<string, unknown>> = []

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue
    }

    const type = asString(entry.type)

    if (!type) {
      continue
    }

    if (type === 'message') {
      const role = asString(entry.role)
      const content = Array.isArray(entry.content)
        ? entry.content.flatMap((part) => {
            const normalized = toStructuredContentPart(part)
            return normalized ? [normalized] : []
          })
        : []

      if (!role || content.length === 0) {
        continue
      }

      outputItems.push({
        content,
        ...(asString(entry.phase) ? { phase: entry.phase } : {}),
        ...(asString(entry.providerMessageId)
          ? { providerMessageId: entry.providerMessageId }
          : {}),
        role,
        type,
      })
      continue
    }

    if (type === 'function_call') {
      const callId = asString(entry.callId)
      const name = asString(entry.name)
      const argumentsJson = asString(entry.argumentsJson)

      if (!callId || !name || !argumentsJson) {
        continue
      }

      outputItems.push({
        ...(entry.arguments !== undefined ? { arguments: entry.arguments } : {}),
        argumentsJson,
        callId,
        name,
        ...(asString(entry.providerItemId) ? { providerItemId: entry.providerItemId } : {}),
        ...(asString(entry.thoughtSignature) ? { thoughtSignature: entry.thoughtSignature } : {}),
        type,
      })
      continue
    }

    if (type === 'reasoning') {
      const id = asString(entry.id)

      if (!id) {
        continue
      }

      outputItems.push({
        ...(entry.encryptedContent !== undefined
          ? { encryptedContent: entry.encryptedContent }
          : {}),
        id,
        summary: entry.summary ?? null,
        ...(asString(entry.text) ? { text: entry.text } : {}),
        ...(entry.thought === true ? { thought: true } : {}),
        type,
      })
    }
  }

  return outputItems.length > 0 ? outputItems : undefined
}

const hasNonMessageOutputItem = (items: readonly Record<string, unknown>[]): boolean =>
  items.some((item) => item.type !== 'message')

const toStructuredGenerationToolCalls = (
  value: unknown,
): Array<Record<string, unknown>> | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const toolCalls: Array<Record<string, unknown>> = []

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue
    }

    const callId = asString(entry.callId)
    const name = asString(entry.name)
    const argumentsJson = asString(entry.argumentsJson)

    if (!callId || !name || !argumentsJson) {
      continue
    }

    toolCalls.push({
      ...(entry.arguments !== undefined ? { arguments: entry.arguments } : {}),
      argumentsJson,
      callId,
      name,
      ...(asString(entry.providerItemId) ? { providerItemId: entry.providerItemId } : {}),
      ...(asString(entry.thoughtSignature) ? { thoughtSignature: entry.thoughtSignature } : {}),
      type: 'function_call',
    })
  }

  return toolCalls.length > 0 ? toolCalls : undefined
}

const toNumericRecord = (value: unknown): Record<string, number> | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const usageDetails: Record<string, number> = {}

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      usageDetails[key] = entry
    }
  }

  return Object.keys(usageDetails).length > 0 ? usageDetails : undefined
}

const normalizeUsageKey = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')

const findUsageValue = (usage: EventPayload, candidates: readonly string[]): number | null => {
  for (const key of candidates) {
    const entry = asNumber(usage[key])

    if (entry !== null) {
      return entry
    }
  }

  return null
}

const collectUsageDetails = (
  usage: EventPayload,
  prefix: 'input' | 'output',
  candidates: readonly string[],
): Record<string, number> => {
  const details: Record<string, number> = {}

  for (const key of candidates) {
    const value = usage[key]

    if (!isRecord(value)) {
      continue
    }

    for (const [detailKey, detailValue] of Object.entries(value)) {
      const numericValue = asNumber(detailValue)

      if (numericValue === null) {
        continue
      }

      const normalizedDetailKey = normalizeUsageKey(detailKey)

      if (normalizedDetailKey.length === 0) {
        continue
      }

      details[`${prefix}_${normalizedDetailKey}`] = numericValue
    }
  }

  return details
}

const toCanonicalUsageKey = (key: string): string | null => {
  const normalizedKey = normalizeUsageKey(key)

  if (normalizedKey.length === 0) {
    return null
  }

  if (
    normalizedKey === 'input' ||
    normalizedKey === 'input_tokens' ||
    normalizedKey === 'prompt_tokens'
  ) {
    return 'input'
  }

  if (
    normalizedKey === 'output' ||
    normalizedKey === 'output_tokens' ||
    normalizedKey === 'completion_tokens'
  ) {
    return 'output'
  }

  if (normalizedKey === 'total' || normalizedKey === 'total_tokens') {
    return 'total'
  }

  if (normalizedKey === 'cached_tokens') {
    return 'input_cached_tokens'
  }

  if (normalizedKey === 'reasoning_tokens') {
    return 'output_reasoning_tokens'
  }

  if (
    normalizedKey === 'input_tokens_details' ||
    normalizedKey === 'output_tokens_details' ||
    normalizedKey === 'prompt_tokens_details' ||
    normalizedKey === 'completion_tokens_details'
  ) {
    return null
  }

  return normalizedKey
}

const toRunOutput = (
  run: RunRecord,
  terminalEvent: (DomainEventEnvelope<unknown> & { eventNo: number }) | null,
): unknown => {
  const payload = terminalEvent ? toEventPayload(terminalEvent) : null
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

const toGenerationInput = (
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

const toGenerationModelParameters = (
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

const toGenerationOutput = (
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

const toGenerationUsageDetails = (payload: EventPayload | null): UsageDetails | undefined => {
  const usage = payload?.usage

  if (!isRecord(usage)) {
    return undefined
  }

  const input = findUsageValue(usage, [
    'input',
    'inputTokens',
    'input_tokens',
    'promptTokens',
    'prompt_tokens',
  ])
  const output = findUsageValue(usage, [
    'output',
    'outputTokens',
    'output_tokens',
    'completionTokens',
    'completion_tokens',
  ])
  const total = findUsageValue(usage, ['total', 'totalTokens', 'total_tokens'])
  const normalizedUsage: Record<string, number> = {
    ...collectUsageDetails(usage, 'input', ['input_tokens_details', 'prompt_tokens_details']),
    ...collectUsageDetails(usage, 'output', ['output_tokens_details', 'completion_tokens_details']),
  }

  for (const [key, value] of Object.entries(usage)) {
    const numericValue = asNumber(value)

    if (numericValue === null) {
      continue
    }

    const canonicalKey = toCanonicalUsageKey(key)

    if (!canonicalKey) {
      continue
    }

    normalizedUsage[canonicalKey] = numericValue
  }

  if (input !== null) {
    normalizedUsage.input = input
  }

  if (output !== null) {
    normalizedUsage.output = output
  }

  if (total !== null) {
    normalizedUsage.total = total
  }

  if (
    normalizedUsage.total === undefined &&
    (normalizedUsage.input !== undefined || normalizedUsage.output !== undefined)
  ) {
    normalizedUsage.total = (normalizedUsage.input ?? 0) + (normalizedUsage.output ?? 0)
  }

  if (normalizedUsage.total === undefined && Object.keys(normalizedUsage).length > 0) {
    normalizedUsage.total = Object.entries(normalizedUsage).reduce(
      (sum, [key, value]) => (key === 'total' ? sum : sum + value),
      0,
    )
  }

  if (Object.keys(normalizedUsage).length > 0) {
    return normalizedUsage
  }

  return toNumericRecord(usage)
}

const toObservationId = (key: string): string => toLangfuseObservationId(key)

const toTraceId = (traceKey: string): string => toLangfuseTraceId(traceKey)

const toScoreId = (traceId: string, name: string, target: string): string =>
  `${traceId}:${name}:${target}`

const createRandomHex = (bytes: number): string => randomBytes(bytes).toString('hex')

class DeterministicIdGenerator implements OTelIdGenerator {
  private activeSpanIds: string[] = []
  private activeTraceIds: string[] = []

  begin(traceKey: string, observationKeys: readonly string[]) {
    this.activeTraceIds = [toTraceId(traceKey)]
    this.activeSpanIds = observationKeys.map(toObservationId)
  }

  end() {
    this.activeTraceIds = []
    this.activeSpanIds = []
  }

  generateTraceId(): string {
    return this.activeTraceIds.shift() ?? createRandomHex(16)
  }

  generateSpanId(): string {
    return this.activeSpanIds.shift() ?? createRandomHex(8)
  }
}

const collectObservationKeys = (run: ExportRun): string[] => [
  run.key,
  ...run.generations.flatMap((generation) => [
    generation.key,
    ...generation.events.map((event) => event.key),
    ...generation.tools.flatMap(collectToolObservationKeys),
  ]),
  ...run.tools.flatMap(collectToolObservationKeys),
  ...run.childRuns.flatMap(collectObservationKeys),
]

const collectToolObservationKeys = (tool: ExportTool): string[] => [
  tool.key,
  ...tool.childRuns.flatMap(collectObservationKeys),
]

const toRunScope = (entry: EventOutboxRecord): TenantScope | null => {
  if (!entry.tenantId) {
    return null
  }

  return {
    accountId: entry.event.actorAccountId ?? asAccountId('acc_system'),
    role: 'service',
    tenantId: entry.tenantId,
  }
}

const findRunLifecycleEvent = (
  events: readonly (DomainEventEnvelope<unknown> & { eventNo: number })[],
  type: string,
): (DomainEventEnvelope<unknown> & { eventNo: number }) | null =>
  events.find((event) => event.type === type) ?? null

const findTurn = (payload: EventPayload | null): number | null => {
  const turn = asNumber(payload?.turn)
  return turn === null ? null : turn
}

const toRunObservationName = (run: RunRecord, createdPayload: EventPayload | null): string => {
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

const toAgentMetadata = (
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

const toRunIdsMetadata = (run: RunRecord, observationKey: string): Record<string, unknown> => ({
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

const toRuntimeMetadata = (run: RunRecord): Record<string, unknown> => {
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

const collectChildRunMetadata = (childRuns: readonly ExportRun[]) => {
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

const toGenerationToolSummaryMetadata = (tools: readonly ExportTool[]): Record<string, unknown> => {
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

const toRunMetadata = (
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

const toGenerationMetadata = (input: {
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

const toToolMetadata = (input: {
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

const toWebSearchMetadata = (payload: EventPayload | null): Record<string, unknown> => ({
  ...(asString(payload?.provider) ? { provider: payload?.provider } : {}),
  ...(asString(payload?.responseId) ? { responseId: payload?.responseId } : {}),
  ...(asString(payload?.searchId) ? { searchId: payload?.searchId } : {}),
  ...(findTurn(payload) !== null ? { turn: findTurn(payload) } : {}),
})

const toRootTraceMetadata = (input: {
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

const toRootTraceName = (input: {
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

const toRootTraceTags = (input: {
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

const toToolWaitingOutput = (payload: EventPayload | null): Record<string, unknown> | undefined => {
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

const toRunWaitingStatusMessage = (payload: EventPayload | null): string | undefined => {
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

const toRelevantRunEvents = (
  events: readonly (DomainEventEnvelope<unknown> & { eventNo: number })[],
  runId: string,
): Array<DomainEventEnvelope<unknown> & { eventNo: number }> =>
  events.filter((event) => {
    const payload = toEventPayload(event)
    const payloadRunId = asString(payload?.runId)

    return payloadRunId === runId || (event.aggregateType === 'run' && event.aggregateId === runId)
  })

const sortByTimestamp = <TValue extends { createdAt?: string; startTime?: string }>(
  values: readonly TValue[],
): TValue[] =>
  [...values].sort((left, right) => {
    const leftTimestamp = left.startTime ?? left.createdAt ?? ''
    const rightTimestamp = right.startTime ?? right.createdAt ?? ''
    return leftTimestamp.localeCompare(rightTimestamp)
  })

const pickLatestEvent = (
  events: readonly (DomainEventEnvelope<unknown> & { eventNo: number })[],
  type: string,
): (DomainEventEnvelope<unknown> & { eventNo: number }) | null => {
  const matches = events.filter((event) => event.type === type)
  return matches.length > 0 ? matches[matches.length - 1]! : null
}

const buildRunTree = (
  runRepository: ReturnType<typeof createRunRepository>,
  scope: TenantScope,
  run: RunRecord,
): Result<RunRecord[], DomainError> => {
  const children = runRepository.listByParentRunId(scope, run.id)

  if (!children.ok) {
    return children
  }

  const descendants: RunRecord[] = [run]

  for (const child of children.value) {
    const childTree = buildRunTree(runRepository, scope, child)

    if (!childTree.ok) {
      return childTree
    }

    descendants.push(...childTree.value)
  }

  return ok(descendants)
}

const buildToolSnapshots = (input: {
  childRunsBySourceCallId: Map<string, ExportRun[]>
  runEvents: readonly (DomainEventEnvelope<unknown> & { eventNo: number })[]
}): { byTurn: Map<number, ExportTool[]>; unscoped: ExportTool[] } => {
  const grouped = new Map<
    string,
    {
      called: (DomainEventEnvelope<unknown> & { eventNo: number }) | null
      completed: (DomainEventEnvelope<unknown> & { eventNo: number }) | null
      confirmationRequested: (DomainEventEnvelope<unknown> & { eventNo: number }) | null
      failed: (DomainEventEnvelope<unknown> & { eventNo: number }) | null
      turn: number | null
      waiting: (DomainEventEnvelope<unknown> & { eventNo: number }) | null
    }
  >()

  for (const event of input.runEvents) {
    if (
      event.type !== 'tool.called' &&
      event.type !== 'tool.completed' &&
      event.type !== 'tool.confirmation_requested' &&
      event.type !== 'tool.failed' &&
      event.type !== 'tool.waiting'
    ) {
      continue
    }

    const payload = toEventPayload(event)
    const callId = asString(payload?.callId) ?? event.aggregateId

    if (!callId) {
      continue
    }

    const current = grouped.get(callId) ?? {
      called: null,
      completed: null,
      confirmationRequested: null,
      failed: null,
      turn: findTurn(payload),
      waiting: null,
    }

    current.turn ??= findTurn(payload)

    if (event.type === 'tool.called') {
      current.called = event
    }

    if (event.type === 'tool.completed') {
      current.completed = event
    }

    if (event.type === 'tool.failed') {
      current.failed = event
    }

    if (event.type === 'tool.waiting') {
      current.waiting = event
    }

    if (event.type === 'tool.confirmation_requested') {
      current.confirmationRequested = event
    }

    grouped.set(callId, current)
  }

  const byTurn = new Map<number, ExportTool[]>()
  const unscoped: ExportTool[] = []

  for (const [callId, value] of grouped.entries()) {
    const calledPayload = value.called ? toEventPayload(value.called) : null
    const completedPayload = value.completed ? toEventPayload(value.completed) : null
    const confirmationRequestedPayload = value.confirmationRequested
      ? toEventPayload(value.confirmationRequested)
      : null
    const failedPayload = value.failed ? toEventPayload(value.failed) : null
    const waitingPayload = value.waiting ? toEventPayload(value.waiting) : null
    const waitPayload = confirmationRequestedPayload ?? waitingPayload
    const toolName =
      asString(calledPayload?.tool) ??
      asString(completedPayload?.tool) ??
      asString(confirmationRequestedPayload?.tool) ??
      asString(failedPayload?.tool) ??
      asString(waitingPayload?.tool) ??
      'tool'
    const startTime =
      value.called?.createdAt ??
      value.completed?.createdAt ??
      value.confirmationRequested?.createdAt ??
      value.failed?.createdAt ??
      value.waiting?.createdAt

    if (!startTime) {
      continue
    }

    const tool: ExportTool = {
      asType: LANGFUSE_OBSERVATION_TAXONOMY.current.toolCall.asType,
      childRuns: input.childRunsBySourceCallId.get(callId) ?? [],
      endTime:
        value.completed?.createdAt ??
        value.failed?.createdAt ??
        value.confirmationRequested?.createdAt ??
        value.waiting?.createdAt ??
        startTime,
      input: calledPayload?.args,
      key: `tool:${callId}`,
      level: value.failed ? 'ERROR' : waitPayload ? 'WARNING' : 'DEFAULT',
      metadata: toToolMetadata({
        childRuns: input.childRunsBySourceCallId.get(callId) ?? [],
        key: `tool:${callId}`,
        payload:
          calledPayload ??
          completedPayload ??
          confirmationRequestedPayload ??
          failedPayload ??
          waitingPayload,
      }),
      name: toolName,
      output: value.completed
        ? completedPayload?.outcome
        : value.failed
          ? toErrorOutput(failedPayload?.error)
          : waitPayload
            ? toToolWaitingOutput(waitPayload)
            : undefined,
      startTime,
      statusMessage:
        value.failed && failedPayload
          ? (toErrorMessage(failedPayload.error) ?? asString(failedPayload.tool) ?? undefined)
          : value.confirmationRequested
            ? 'tool.confirmation_requested'
            : value.waiting
              ? `tool.waiting${asString(waitPayload?.waitType) ? `:${waitPayload?.waitType}` : ''}`
              : undefined,
      success: value.completed ? true : value.failed ? false : null,
    }

    if (value.turn === null) {
      unscoped.push(tool)
      continue
    }

    const current = byTurn.get(value.turn) ?? []
    current.push(tool)
    byTurn.set(value.turn, current)
  }

  for (const [turn, tools] of byTurn.entries()) {
    byTurn.set(turn, sortByTimestamp(tools))
  }

  return {
    byTurn,
    unscoped: sortByTimestamp(unscoped),
  }
}

const buildWebSearchSnapshots = (input: {
  runEvents: readonly (DomainEventEnvelope<unknown> & { eventNo: number })[]
}): { byTurn: Map<number, ExportTool[]>; unscoped: ExportTool[] } => {
  const grouped = new Map<
    string,
    {
      events: Array<DomainEventEnvelope<unknown> & { eventNo: number }>
      turn: number | null
    }
  >()

  for (const event of input.runEvents) {
    if (event.type !== 'web_search.progress') {
      continue
    }

    const payload = toEventPayload(event)
    const searchId = asString(payload?.searchId)

    if (!searchId) {
      continue
    }

    const current = grouped.get(searchId) ?? {
      events: [],
      turn: findTurn(payload),
    }

    current.events.push(event)
    current.turn ??= findTurn(payload)
    grouped.set(searchId, current)
  }

  const byTurn = new Map<number, ExportTool[]>()
  const unscoped: ExportTool[] = []

  for (const [searchId, value] of grouped.entries()) {
    const events = [...value.events].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    )
    const first = events[0]
    const latest = events[events.length - 1]

    if (!first || !latest) {
      continue
    }

    const latestPayload = toEventPayload(latest)
    const inputPayload: Record<string, unknown> = {}
    const outputPayload: Record<string, unknown> = {}

    if (Array.isArray(latestPayload?.queries) && latestPayload.queries.length > 0) {
      inputPayload.queries = latestPayload.queries
    }

    if (Array.isArray(latestPayload?.patterns) && latestPayload.patterns.length > 0) {
      inputPayload.patterns = latestPayload.patterns
    }

    if (Array.isArray(latestPayload?.targetUrls) && latestPayload.targetUrls.length > 0) {
      inputPayload.targetUrls = latestPayload.targetUrls
    }

    if (Array.isArray(latestPayload?.references) && latestPayload.references.length > 0) {
      outputPayload.references = latestPayload.references
    }

    const status = asString(latestPayload?.status)

    if (status) {
      outputPayload.status = status
    }

    const retriever: ExportTool = {
      asType: LANGFUSE_OBSERVATION_TAXONOMY.current.webSearch.asType,
      childRuns: [],
      endTime: latest.createdAt,
      input: Object.keys(inputPayload).length > 0 ? inputPayload : undefined,
      key: `retriever:web_search:${searchId}`,
      level: status === 'failed' ? 'ERROR' : 'DEFAULT',
      metadata: toWebSearchMetadata(latestPayload),
      name: 'web_search',
      output: Object.keys(outputPayload).length > 0 ? outputPayload : undefined,
      startTime: first.createdAt,
      statusMessage: status === 'failed' ? 'web_search.failed' : undefined,
      success: status === 'completed' ? true : status === 'failed' ? false : null,
    }

    if (value.turn === null) {
      unscoped.push(retriever)
      continue
    }

    const current = byTurn.get(value.turn) ?? []
    current.push(retriever)
    byTurn.set(value.turn, current)
  }

  for (const [turn, retrievers] of byTurn.entries()) {
    byTurn.set(turn, sortByTimestamp(retrievers))
  }

  return {
    byTurn,
    unscoped: sortByTimestamp(unscoped),
  }
}

const mergeToolSnapshotsByTurn = (
  ...maps: ReadonlyArray<Map<number, ExportTool[]>>
): Map<number, ExportTool[]> => {
  const merged = new Map<number, ExportTool[]>()

  for (const source of maps) {
    for (const [turn, tools] of source.entries()) {
      const current = merged.get(turn) ?? []
      current.push(...tools)
      merged.set(turn, sortByTimestamp(current))
    }
  }

  return merged
}

const buildGenerationSnapshots = (input: {
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

const buildRunSnapshot = (input: {
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
    output: toRunOutput(input.run, terminalEvent),
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

const loadTraceSnapshot = (
  db: RepositoryDatabase,
  entry: EventOutboxRecord,
  logger: AppLogger,
): Result<ExportTrace, DomainError> => {
  const scope = toRunScope(entry)

  if (!scope) {
    return err({
      message: 'Langfuse export requires an outbox entry with tenant scope',
      type: 'validation',
    })
  }

  const payload = toEventPayload(entry.event)
  const rootRunId = asString(payload?.rootRunId) ?? asString(payload?.runId)

  if (!rootRunId) {
    return err({
      message: 'Langfuse export requires a root run id',
      type: 'validation',
    })
  }

  const runRepository = createRunRepository(db)
  const rootRun = runRepository.getById(scope, asRunId(rootRunId))

  if (!rootRun.ok) {
    return rootRun
  }

  const runTree = buildRunTree(runRepository, scope, rootRun.value)

  if (!runTree.ok) {
    return runTree
  }

  const runIds = new Set(runTree.value.map((run) => String(run.id)))
  const childRunsByParentId = new Map<string, RunRecord[]>()

  for (const run of runTree.value) {
    if (!run.parentRunId) {
      continue
    }

    const parentRunId = String(run.parentRunId)
    const current = childRunsByParentId.get(parentRunId) ?? []
    current.push(run)
    childRunsByParentId.set(parentRunId, current)
  }

  const eventRepository = createDomainEventRepository(db)
  const sessionEvents = eventRepository.listAfterCursor(scope, {
    category: 'all',
    sessionId: rootRun.value.sessionId,
  })

  if (!sessionEvents.ok) {
    return sessionEvents
  }

  const relevantEvents = sessionEvents.value.filter((event) => {
    const eventPayload = toEventPayload(event)
    const payloadRootRunId = asString(eventPayload?.rootRunId)
    const payloadRunId = asString(eventPayload?.runId)

    return (
      payloadRootRunId === rootRun.value.id ||
      (payloadRunId !== null && runIds.has(payloadRunId)) ||
      (event.aggregateType === 'run' && runIds.has(event.aggregateId))
    )
  })

  if (relevantEvents.length === 0) {
    logger.warn('No persisted run events were found for Langfuse export', {
      rootRunId: rootRun.value.id,
    })
  }

  const rootRunEvents = toRelevantRunEvents(relevantEvents, rootRun.value.id)
  const rootRunCreated = findRunLifecycleEvent(rootRunEvents, 'run.created')
  const rootTerminalEvent =
    pickLatestEvent(rootRunEvents, 'run.completed') ??
    pickLatestEvent(rootRunEvents, 'run.failed') ??
    pickLatestEvent(rootRunEvents, 'run.waiting')
  const rootCreatedPayload = rootRunCreated ? toEventPayload(rootRunCreated) : null
  const rootTerminalPayload = rootTerminalEvent ? toEventPayload(rootTerminalEvent) : null
  const rootRunSnapshot = buildRunSnapshot({
    childRunsByParentId,
    events: relevantEvents,
    run: rootRun.value,
  })

  return ok({
    metadata: toRootTraceMetadata({
      createdPayload: rootCreatedPayload,
      run: rootRun.value,
      terminalPayload: rootTerminalPayload,
    }),
    name: toRootTraceName({
      createdPayload: rootCreatedPayload,
      rootRun: rootRun.value,
      rootRunName: rootRunSnapshot.name,
    }),
    rootRun: rootRunSnapshot,
    sessionId: rootRun.value.threadId ?? rootRun.value.sessionId,
    tags: toRootTraceTags({
      createdPayload: rootCreatedPayload,
      rootRun: rootRun.value,
      terminalPayload: rootTerminalPayload,
    }),
    traceKey: rootRun.value.id,
    userId: rootRun.value.actorAccountId ?? undefined,
  })
}

const endObservation = (endable: { end: (endTime?: Date) => void }, endTime: string) => {
  endable.end(new Date(endTime))
}

const isRetryableLangfuseStatusCode = (statusCode: number | undefined): boolean => {
  if (statusCode === undefined) {
    return true
  }

  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500
}

const toLangfuseProviderError = (
  prefix: string,
  error: unknown,
): Extract<DomainError, { type: 'provider' }> => {
  if (error instanceof LangfuseAPIError) {
    return {
      message: `${prefix}: ${error.message}`,
      provider: 'langfuse',
      retryable: isRetryableLangfuseStatusCode(error.statusCode),
      statusCode: error.statusCode,
      type: 'provider',
    }
  }

  return {
    message: error instanceof Error ? `${prefix}: ${error.message}` : prefix,
    provider: 'langfuse',
    retryable: true,
    type: 'provider',
  }
}

const exportRunObservation = (
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

const exportToolObservation = (
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

const appendScores = async (input: {
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

export const createLangfuseExporter = (input: {
  config: LangfuseExporterConfig
  db: RepositoryDatabase
  logger: AppLogger
  spanExporter?: SpanExporter
}): LangfuseExporter => {
  if (
    !input.config.enabled ||
    !input.config.baseUrl ||
    !input.config.publicKey ||
    !input.config.secretKey
  ) {
    return {
      enabled: false,
      environment: input.config.environment,
      exportOutboxEntry: async () => ok(null),
      shutdown: async () => {},
    }
  }

  const logger = input.logger.child({
    subsystem: 'langfuse_exporter',
  })
  const idGenerator = new DeterministicIdGenerator()
  const processor = new LangfuseSpanProcessor({
    baseUrl: normalizeBaseUrl(input.config.baseUrl),
    environment: input.config.environment,
    ...(input.spanExporter ? { exporter: input.spanExporter } : {}),
    exportMode: 'immediate',
    publicKey: input.config.publicKey,
    secretKey: input.config.secretKey,
    timeout: Math.max(1, Math.ceil(input.config.timeoutMs / 1000)),
  })
  const sdk = new NodeSDK({
    autoDetectResources: false,
    idGenerator,
    instrumentations: [],
    serviceName: '05_04_api',
    spanProcessors: [processor],
  })

  sdk.start()
  const tracerProvider = Reflect.get(sdk, '_tracerProvider') as TracerProvider | null
  setLangfuseTracerProvider(tracerProvider)

  const apiClient = new LangfuseAPIClient({
    baseUrl: () => normalizeBaseUrl(input.config.baseUrl!),
    environment: () => input.config.environment,
    password: () => input.config.secretKey!,
    username: () => input.config.publicKey!,
    xLangfuseSdkName: () => '05_04_api',
    xLangfuseSdkVersion: () => 'local',
  })

  let exportQueue = Promise.resolve()

  const serializeExport = async <TValue>(fn: () => Promise<TValue>): Promise<TValue> => {
    const next = exportQueue.then(fn, fn)
    exportQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  return {
    enabled: true,
    environment: input.config.environment,
    exportOutboxEntry: async (entry) =>
      serializeExport(async () => {
        if (!isTerminalRootRunEvent(entry)) {
          return ok(null)
        }

        const trace = loadTraceSnapshot(input.db, entry, logger)

        if (!trace.ok) {
          return trace
        }

        const observationKeys = collectObservationKeys(trace.value.rootRun)

        idGenerator.begin(trace.value.traceKey, observationKeys)

        try {
          await propagateAttributes(
            {
              ...(trace.value.metadata ? { metadata: trace.value.metadata } : {}),
              ...(trace.value.name ? { traceName: trace.value.name } : {}),
              ...(trace.value.sessionId ? { sessionId: trace.value.sessionId } : {}),
              ...(trace.value.tags ? { tags: trace.value.tags } : {}),
              ...(trace.value.userId ? { userId: trace.value.userId } : {}),
            },
            async () => {
              exportRunObservation(trace.value.rootRun)
            },
          )

          await processor.forceFlush()

          const scores = await appendScores({
            apiClient,
            environment: input.config.environment,
            timeoutMs: input.config.timeoutMs,
            trace: trace.value,
          })

          if (!scores.ok) {
            return scores
          }

          return ok(null)
        } catch (error) {
          return err(toLangfuseProviderError('Langfuse OTEL export failed', error))
        } finally {
          idGenerator.end()
        }
      }),
    shutdown: async () => {
      await serializeExport(async () => {
        await processor.forceFlush()
        await sdk.shutdown()
        setLangfuseTracerProvider(null)
      })
    },
  }
}
