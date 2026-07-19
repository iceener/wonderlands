import type { UsageDetails } from '@langfuse/core'

import type { LANGFUSE_OBSERVATION_TAXONOMY } from '../observation-taxonomy'

export type EventPayload = Record<string, unknown>

export type ObservationLevel = 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR'

export interface ExportReasoningEvent {
  key: string
  metadata?: Record<string, unknown>
  output?: unknown
  timestamp: string
}

export interface ExportGeneration {
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

export interface ExportTool {
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

export interface ExportRun {
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

export interface ExportTrace {
  metadata?: Record<string, string>
  name: string
  rootRun: ExportRun
  sessionId?: string
  tags?: string[]
  traceKey: string
  userId?: string
}

export type OTelIdGenerator = {
  generateSpanId: () => string
  generateTraceId: () => string
}
