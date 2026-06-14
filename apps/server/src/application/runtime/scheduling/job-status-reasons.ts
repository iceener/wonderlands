import type { JobStatus } from '../../../domain/runtime/job-types'

export type StaleRunRecoveryReason = 'claim_expired' | 'process_restarted'

export type RunLinkedJobQueueReason =
  | 'dependencies_satisfied'
  | 'manual.execute'
  | StaleRunRecoveryReason

export type JobQueueReason =
  | RunLinkedJobQueueReason
  | 'delegate_to_agent'
  | 'new_user_message'
  | 'session.bootstrap'
  | 'thread.interaction'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const hasStringField = <TField extends string>(
  value: Record<string, unknown>,
  field: TField,
): value is Record<TField, string> & Record<string, unknown> =>
  typeof value[field] === 'string' && value[field].length > 0

export const buildRunLinkedJobQueueReason = (input: {
  reason: RunLinkedJobQueueReason
  runId: string
}) => ({
  reason: input.reason,
  runId: input.runId,
})

export const buildDelegatedChildJobQueueReason = (input: {
  delegationMode: string
  parentRunId: string
  runId: string
  sourceCallId: string
  targetAlias: string
}) => ({
  delegationMode: input.delegationMode,
  parentRunId: input.parentRunId,
  reason: 'delegate_to_agent' as const,
  runId: input.runId,
  source: 'delegate_to_agent' as const,
  sourceCallId: input.sourceCallId,
  targetAlias: input.targetAlias,
})

export const buildRunLinkedJobRunningReason = (input: { runId: string }) => ({
  runId: input.runId,
  stage: 'running' as const,
})

export const buildRunLinkedJobWaitingReason = (input: { runId: string; waitIds: string[] }) => ({
  reason: 'pending_waits' as const,
  runId: input.runId,
  waitIds: input.waitIds,
})

export const buildRunLinkedJobBlockedReason = (input: { error: unknown; runId: string }) => ({
  error: input.error,
  runId: input.runId,
})

export const buildRunLinkedJobTerminalReason = (input: {
  runId: string
  status: 'cancelled' | 'completed'
}) => ({
  runId: input.runId,
  status: input.status,
})

export const buildThreadInteractionJobQueueReason = (input: {
  inputMessageId: string
  previousStatus?: JobStatus
  runId: string
}) => ({
  inputMessageId: input.inputMessageId,
  ...(input.previousStatus ? { previousStatus: input.previousStatus } : {}),
  reason: 'thread.interaction' as const,
  runId: input.runId,
  source: 'thread.interaction' as const,
})

export const buildSessionBootstrapJobQueueReason = (input: { runId: string }) => ({
  reason: 'session.bootstrap' as const,
  runId: input.runId,
  source: 'session.bootstrap' as const,
})

export const buildNewUserMessageJobQueueReason = (input: {
  messageId: string
  previousStatus: JobStatus
  threadId: string
}) => ({
  messageId: input.messageId,
  previousStatus: input.previousStatus,
  reason: 'new_user_message' as const,
  threadId: input.threadId,
})

export type ParsedJobQueueReason =
  | ReturnType<typeof buildDelegatedChildJobQueueReason>
  | ReturnType<typeof buildNewUserMessageJobQueueReason>
  | ReturnType<typeof buildRunLinkedJobQueueReason>
  | ReturnType<typeof buildSessionBootstrapJobQueueReason>
  | ReturnType<typeof buildThreadInteractionJobQueueReason>

export const parseJobQueueReason = (statusReasonJson: unknown): ParsedJobQueueReason | null => {
  if (!isRecord(statusReasonJson) || !hasStringField(statusReasonJson, 'reason')) {
    return null
  }

  switch (statusReasonJson.reason) {
    case 'dependencies_satisfied':
    case 'claim_expired':
    case 'manual.execute':
    case 'process_restarted':
      return hasStringField(statusReasonJson, 'runId')
        ? {
            reason: statusReasonJson.reason,
            runId: statusReasonJson.runId,
          }
        : null
    case 'delegate_to_agent':
      return hasStringField(statusReasonJson, 'delegationMode') &&
        hasStringField(statusReasonJson, 'parentRunId') &&
        hasStringField(statusReasonJson, 'runId') &&
        hasStringField(statusReasonJson, 'source') &&
        hasStringField(statusReasonJson, 'sourceCallId') &&
        hasStringField(statusReasonJson, 'targetAlias')
        ? {
            delegationMode: statusReasonJson.delegationMode,
            parentRunId: statusReasonJson.parentRunId,
            reason: 'delegate_to_agent',
            runId: statusReasonJson.runId,
            source: statusReasonJson.source as 'delegate_to_agent',
            sourceCallId: statusReasonJson.sourceCallId,
            targetAlias: statusReasonJson.targetAlias,
          }
        : null
    case 'new_user_message':
      return hasStringField(statusReasonJson, 'messageId') &&
        hasStringField(statusReasonJson, 'previousStatus') &&
        hasStringField(statusReasonJson, 'threadId')
        ? {
            messageId: statusReasonJson.messageId,
            previousStatus: statusReasonJson.previousStatus as JobStatus,
            reason: 'new_user_message',
            threadId: statusReasonJson.threadId,
          }
        : null
    case 'session.bootstrap':
      return hasStringField(statusReasonJson, 'runId') && hasStringField(statusReasonJson, 'source')
        ? {
            reason: 'session.bootstrap',
            runId: statusReasonJson.runId,
            source: statusReasonJson.source as 'session.bootstrap',
          }
        : null
    case 'thread.interaction':
      return hasStringField(statusReasonJson, 'inputMessageId') &&
        hasStringField(statusReasonJson, 'runId') &&
        hasStringField(statusReasonJson, 'source')
        ? {
            inputMessageId: statusReasonJson.inputMessageId,
            ...(typeof statusReasonJson.previousStatus === 'string'
              ? { previousStatus: statusReasonJson.previousStatus as JobStatus }
              : {}),
            reason: 'thread.interaction',
            runId: statusReasonJson.runId,
            source: statusReasonJson.source as 'thread.interaction',
          }
        : null
    default:
      return null
  }
}

export const isAutoExecutableQueuedRootJobReason = (reason: ParsedJobQueueReason | null): boolean =>
  reason?.reason === 'manual.execute' ||
  reason?.reason === 'session.bootstrap' ||
  reason?.reason === 'thread.interaction' ||
  reason?.reason === 'claim_expired' ||
  reason?.reason === 'process_restarted'
