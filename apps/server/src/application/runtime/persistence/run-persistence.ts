import type { AiProviderName, AiUsage } from '../../../domain/ai/types'
import type { ItemId, RunId, SessionMessageId } from '../../../shared/ids'
import type { PendingRunWaitSummary } from '../execution/run-tool-execution'

export { persistAssistantSnapshotMessageInTransaction } from './output/assistant-message'
export { persistOutputItems } from './output/persist-output-items'
export { completeRunWithAssistantMessage } from './state/complete-run'
export { failRun } from './state/fail-run'
export { markRunWaiting } from './state/mark-run-waiting'
export { refreshWaitingRunSnapshot } from './state/refresh-waiting-snapshot'
export { buildRunTranscriptSnapshot } from './state/run-state-support'
export { persistUsageEntry } from './usage/persist-usage-entry'

export interface WaitingRunPendingWait extends PendingRunWaitSummary {}

export interface CompletedRunExecutionOutput {
  assistantItemId: ItemId | null
  assistantMessageId: SessionMessageId | null
  model: string
  outputText: string
  provider: AiProviderName
  responseId: string | null
  runId: RunId
  status: 'completed'
  usage: AiUsage | null
}

export interface WaitingRunExecutionOutput {
  assistantItemId: null
  assistantMessageId: null
  model: string
  outputText: string
  pendingWaits: WaitingRunPendingWait[]
  provider: AiProviderName
  responseId: string | null
  runId: RunId
  status: 'waiting'
  usage: AiUsage | null
  waitIds: string[]
}

export type RunExecutionOutput = CompletedRunExecutionOutput | WaitingRunExecutionOutput

export interface AcceptedRunResumeOutput {
  runId: RunId
  status: 'accepted'
}

export type ResumeRunOutput = AcceptedRunResumeOutput | RunExecutionOutput
