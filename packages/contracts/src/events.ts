import type { AgentId, EventId, FileId, MessageId, RunId, SessionId, ThreadId, ToolCallId, UploadId } from './ids'
import type { BackendPendingWait, BackendUsage } from './conversation'
import type {
  ProviderName,
  ThreadNamingTrigger,
  ThreadTitleSource,
  ToolAppsMeta,
  WebSearchReference,
  WebSearchStatus,
} from './shared'

interface BaseBackendEvent<TType extends string, TPayload> {
  actorAccountId?: string
  aggregateId: string
  aggregateType: string
  causationId?: string
  createdAt: string
  eventNo: number
  id: EventId
  payload: TPayload
  tenantId?: string
  traceId?: string
  type: TType
}

interface RunScopedPayload {
  runId: RunId | string
  sessionId: SessionId | string
  status?: string
  threadId: ThreadId | string | null
}

interface SessionScopedPayload {
  sessionId: SessionId | string
}

interface ThreadScopedPayload extends SessionScopedPayload {
  threadId: ThreadId | string
}

interface JobScopedPayload {
  currentRunId: RunId | string | null
  jobId: string
  kind: string
  parentJobId: string | null
  rootJobId: string | null
  runId: RunId | string | null
  sessionId: SessionId | string | null
  status: string
  threadId: ThreadId | string | null
}

interface WorkspaceScopedPayload {
  accountId: string | null
  kind: string
  parentRunId?: RunId | string | null
  reason: string
  rootRef: string
  rootRunId?: RunId | string | null
  runId?: RunId | string | null
  sessionId?: SessionId | string | null
  status: string
  threadId?: ThreadId | string | null
  workspaceId: string
  workspaceRef?: string | null
}

export type AgentCreatedEvent = BaseBackendEvent<
  'agent.created',
  {
    agentId: AgentId | string
    kind: string
    name: string
    ownerAccountId: string | null
    slug: string
    status: string
    visibility: string
  }
>

export type AgentRevisionCreatedEvent = BaseBackendEvent<
  'agent.revision.created',
  {
    agentId: AgentId | string
    checksumSha256: string
    revisionId: string
    slug: string
    version: number
  }
>

export type RunCreatedEvent = BaseBackendEvent<'run.created', RunScopedPayload>
export type RunStartedEvent = BaseBackendEvent<'run.started', RunScopedPayload>
export type RunResumedEvent = BaseBackendEvent<'run.resumed', RunScopedPayload & { waitId: string }>

export type TurnStartedEvent = BaseBackendEvent<
  'turn.started',
  RunScopedPayload & {
    estimatedInputTokens: number
    observationCount: number
    pendingWaitCount: number
    reservedOutputTokens: number | null
    stablePrefixTokens: number
    summaryId: string | null
    turn: number
    volatileSuffixTokens: number
  }
>

export type TurnCompletedEvent = BaseBackendEvent<
  'turn.completed',
  RunScopedPayload & {
    hasToolCalls: boolean
    outputItemCount: number
    outputTextLength: number
    turn: number
  }
>

export type ProgressReportedEvent = BaseBackendEvent<
  'progress.reported',
  RunScopedPayload & {
    detail?: string
    percent?: number
    stage: string
    turn: number
  }
>

export type StreamDeltaEvent = BaseBackendEvent<
  'stream.delta',
  RunScopedPayload & {
    delta: string
    model?: string
    provider?: string
    responseId?: string | null
    turn: number
  }
>

export type StreamDoneEvent = BaseBackendEvent<
  'stream.done',
  RunScopedPayload & {
    model: string
    provider: string
    responseId: string | null
    text: string
    turn: number
  }
>

export type ReasoningSummaryDeltaEvent = BaseBackendEvent<
  'reasoning.summary.delta',
  RunScopedPayload & {
    delta: string
    itemId: string
    text: string
    turn: number
  }
>

export type ReasoningSummaryDoneEvent = BaseBackendEvent<
  'reasoning.summary.done',
  RunScopedPayload & {
    itemId: string
    text: string
    turn: number
  }
>

export type GenerationStartedEvent = BaseBackendEvent<
  'generation.started',
  RunScopedPayload & {
    inputMessages: Array<Record<string, unknown>>
    modelParameters?: Record<string, number | string>
    nativeTools?: string[]
    provider: string
    requestedModel: string | null
    startedAt: string
    tools?: Array<Record<string, unknown>>
    turn: number
  }
>

export type GenerationCompletedEvent = BaseBackendEvent<
  'generation.completed',
  RunScopedPayload & {
    model: string
    outputItemCount: number
    outputText: string
    provider: string
    providerRequestId: string | null
    responseId: string | null
    status: string
    toolCallCount: number
    turn: number
    usage: BackendUsage | null
  }
>

export type GenerationFailedEvent = BaseBackendEvent<
  'generation.failed',
  RunScopedPayload & {
    error: {
      message: string
      type: string
    }
    provider: string
    startedAt: string
    turn: number
  }
>

export type WebSearchProgressEvent = BaseBackendEvent<
  'web_search.progress',
  RunScopedPayload & {
    patterns: string[]
    provider: ProviderName
    queries: string[]
    references: WebSearchReference[]
    responseId: string | null
    searchId: string
    status: WebSearchStatus
    targetUrls: string[]
    turn: number
  }
>

export type ToolCalledEvent = BaseBackendEvent<
  'tool.called',
  {
    appsMeta?: ToolAppsMeta | null
    args: Record<string, unknown> | null
    callId: ToolCallId | string
    runId: RunId | string
    sessionId: SessionId | string
    threadId: ThreadId | string | null
    tool: string
  }
>

export type ToolConfirmationRequestedEvent = BaseBackendEvent<
  'tool.confirmation_requested',
  {
    args: Record<string, unknown> | null
    callId: ToolCallId | string
    description: string | null
    runId: RunId | string
    sessionId: SessionId | string
    threadId: ThreadId | string | null
    tool: string
    waitId: string
    waitTargetKind: string
    waitTargetRef: string | null
    waitType: string
  }
>

export type ToolConfirmationGrantedEvent = BaseBackendEvent<
  'tool.confirmation_granted',
  {
    callId: ToolCallId | string
    fingerprint?: string
    remembered: boolean
    runId: RunId | string
    sessionId: SessionId | string
    threadId: ThreadId | string | null
    tool: string
    waitId: string
  }
>

export type ToolConfirmationRejectedEvent = BaseBackendEvent<
  'tool.confirmation_rejected',
  {
    callId: ToolCallId | string
    runId: RunId | string
    sessionId: SessionId | string
    threadId: ThreadId | string | null
    tool: string
    waitId: string
  }
>

export type ToolCompletedEvent = BaseBackendEvent<
  'tool.completed',
  {
    appsMeta?: ToolAppsMeta | null
    callId: ToolCallId | string
    outcome: unknown
    runId: RunId | string
    sessionId: SessionId | string
    threadId: ThreadId | string | null
    tool: string
  }
>

export type ToolFailedEvent = BaseBackendEvent<
  'tool.failed',
  {
    appsMeta?: ToolAppsMeta | null
    callId: ToolCallId | string
    error: unknown
    runId: RunId | string
    sessionId: SessionId | string
    threadId: ThreadId | string | null
    tool: string
  }
>

export type FileLinkedEvent = BaseBackendEvent<
  'file.linked',
  {
    fileId: FileId | string
    linkType: string
    sessionId: SessionId | string | null
    targetId: string
  }
>

export type FileUploadedEvent = BaseBackendEvent<
  'file.uploaded',
  {
    accessScope: string
    fileId: FileId | string
    mimeType: string | null
    sessionId: SessionId | string | null
    uploadId: UploadId | string
  }
>

export type MessagePostedEvent = BaseBackendEvent<
  'message.posted',
  {
    messageId: MessageId | string
    runId?: RunId | string
    sessionId: SessionId | string
    threadId: ThreadId | string
  }
>

export type ThreadUpdatedEvent = BaseBackendEvent<
  'thread.updated',
  {
    sessionId: SessionId | string
    threadId: ThreadId | string
    title: string | null
    titleSource?: ThreadTitleSource | null
    updatedAt?: string
  }
>

export type SessionCreatedEvent = BaseBackendEvent<
  'session.created',
  SessionScopedPayload & {
    title: string | null
  }
>

export type ThreadCreatedEvent = BaseBackendEvent<
  'thread.created',
  ThreadScopedPayload & {
    branchFromMessageId?: MessageId | string | null
    branchFromSequence?: number | null
    parentThreadId?: ThreadId | string | null
  }
>

export type ThreadNamingRequestedEvent = BaseBackendEvent<
  'thread.naming.requested',
  {
    requestId: string
    requestedAt: string
    sessionId: SessionId | string
    sourceRunId: RunId | string
    threadId: ThreadId | string
    trigger: ThreadNamingTrigger
  }
>

export type ThreadNamingStartedEvent = BaseBackendEvent<
  'thread.naming.started',
  {
    requestId: string
    sessionId: SessionId | string
    sourceRunId: RunId | string
    threadId: ThreadId | string
    trigger: ThreadNamingTrigger
  }
>

export type ThreadNamingCompletedEvent = BaseBackendEvent<
  'thread.naming.completed',
  {
    applied: boolean
    requestId: string
    sessionId: SessionId | string
    sourceRunId: RunId | string
    threadId: ThreadId | string
    title: string | null
    titleSource?: ThreadTitleSource | null
    trigger: ThreadNamingTrigger
  }
>

export type ThreadNamingFailedEvent = BaseBackendEvent<
  'thread.naming.failed',
  {
    error: {
      message: string
      type: string
    }
    requestId: string
    sessionId: SessionId | string
    sourceRunId: RunId | string
    threadId: ThreadId | string
    trigger: ThreadNamingTrigger
  }
>

export type RunCompletedEvent = BaseBackendEvent<
  'run.completed',
  RunScopedPayload & {
    outputText: string
  }
>

export type RunWaitingEvent = BaseBackendEvent<
  'run.waiting',
  RunScopedPayload & {
    pendingWaits: BackendPendingWait[]
    waitIds: string[]
  }
>

export type RunFailedEvent = BaseBackendEvent<
  'run.failed',
  RunScopedPayload & {
    error: {
      message: string
      type: string
    }
  }
>

export type RunCancellingEvent = BaseBackendEvent<
  'run.cancelling',
  RunScopedPayload & {
    reason: string | null
  }
>

export type RunCancelledEvent = BaseBackendEvent<
  'run.cancelled',
  RunScopedPayload & {
    reason: string | null
  }
>

export type ToolWaitingEvent = BaseBackendEvent<
  'tool.waiting',
  RunScopedPayload & {
    args?: Record<string, unknown> | null
    callId: ToolCallId | string
    description: string | null
    tool: string
    waitId: string
    waitTargetKind: string
    waitTargetRef: string | null
    waitTargetRunId?: RunId | string
    waitType: string
  }
>

export type WaitTimedOutEvent = BaseBackendEvent<
  'wait.timed_out',
  RunScopedPayload & {
    callId: ToolCallId | string
    error: string
    timedOutAt: string
    timeoutAt: string | null
    tool: string
    waitId: string
    waitTargetKind: string
    waitTargetRef: string | null
    waitTargetRunId?: RunId | string
    waitType: string
  }
>

export type ChildRunCompletedEvent = BaseBackendEvent<
  'child_run.completed',
  RunScopedPayload & {
    childRunId: RunId | string
    parentRunId: RunId | string
    resultKind: string
    rootRunId: RunId | string
    summary?: unknown
    waitId: string
  }
>

export type ChildRunCreatedEvent = BaseBackendEvent<
  'child_run.created',
  RunScopedPayload & {
    alias: string
    childAgentId: AgentId | string
    childAgentName: string
    childAgentRevisionId: string
    parentRunId: RunId | string
    rootRunId: RunId | string
    sourceCallId: ToolCallId | string
  }
>

export type DelegationStartedEvent = BaseBackendEvent<
  'delegation.started',
  RunScopedPayload & {
    alias: string
    callId: ToolCallId | string
    childAgentId: AgentId | string
    childAgentName: string
    childAgentRevisionId: string
    childRunId: RunId | string
    rootRunId: RunId | string
    sourceCallId: ToolCallId | string
  }
>

export type RunRequeuedEvent = BaseBackendEvent<
  'run.requeued',
  RunScopedPayload & {
    reason: string
    recoveredFromStatus: string
  }
>

export type MemoryObservationStartedEvent = BaseBackendEvent<
  'memory.observation.started',
  RunScopedPayload & { summaryId: string }
>

export type MemoryObservationCompletedEvent = BaseBackendEvent<
  'memory.observation.completed',
  RunScopedPayload & {
    memoryRecordId: string
    observationCount: number
    source: string
    summaryId: string
    tokenCount: number
  }
>

export type MemoryReflectionStartedEvent = BaseBackendEvent<
  'memory.reflection.started',
  RunScopedPayload & {
    latestReflectionId: string | null
    observationCount: number
  }
>

export type MemoryReflectionCompletedEvent = BaseBackendEvent<
  'memory.reflection.completed',
  RunScopedPayload & {
    generation: number
    latestReflectionId: string | null
    memoryRecordId: string
    observationCount: number
    source: string
    tokenCount: number
  }
>

export type UploadFailedEvent = BaseBackendEvent<
  'upload.failed',
  {
    errorText: string
    uploadId: UploadId | string
  }
>

export type JobCreatedEvent = BaseBackendEvent<
  'job.created',
  JobScopedPayload & {
    assignedAgentId: AgentId | string | null
    assignedAgentRevisionId: string | null
    createdAt: string
    title: string
  }
>

export type JobQueuedEvent = BaseBackendEvent<
  'job.queued',
  JobScopedPayload & {
    createdAt?: string
    title?: string
    updatedAt?: string
  }
>

export type JobWaitingEvent = BaseBackendEvent<
  'job.waiting',
  JobScopedPayload & {
    updatedAt: string
  }
>

export type JobBlockedEvent = BaseBackendEvent<
  'job.blocked',
  JobScopedPayload & {
    updatedAt: string
  }
>

export type JobCompletedEvent = BaseBackendEvent<
  'job.completed',
  JobScopedPayload & {
    completedAt: string | null
  }
>

export type JobCancelledEvent = BaseBackendEvent<
  'job.cancelled',
  JobScopedPayload & {
    completedAt: string | null
  }
>

export type JobSupersededEvent = BaseBackendEvent<
  'job.superseded',
  JobScopedPayload & {
    updatedAt: string
  }
>

export type JobRequeuedEvent = BaseBackendEvent<
  'job.requeued',
  JobScopedPayload & {
    updatedAt: string
  }
>

export type WorkspaceCreatedEvent = BaseBackendEvent<'workspace.created', WorkspaceScopedPayload>
export type WorkspaceResolvedEvent = BaseBackendEvent<'workspace.resolved', WorkspaceScopedPayload>

export type BackendEvent =
  | AgentCreatedEvent
  | AgentRevisionCreatedEvent
  | ChildRunCreatedEvent
  | ChildRunCompletedEvent
  | DelegationStartedEvent
  | FileLinkedEvent
  | FileUploadedEvent
  | GenerationFailedEvent
  | GenerationStartedEvent
  | GenerationCompletedEvent
  | JobBlockedEvent
  | JobCancelledEvent
  | JobCompletedEvent
  | JobCreatedEvent
  | JobQueuedEvent
  | JobRequeuedEvent
  | JobSupersededEvent
  | JobWaitingEvent
  | MemoryObservationStartedEvent
  | MemoryObservationCompletedEvent
  | MemoryReflectionStartedEvent
  | MemoryReflectionCompletedEvent
  | MessagePostedEvent
  | ProgressReportedEvent
  | RunCancellingEvent
  | ReasoningSummaryDeltaEvent
  | ReasoningSummaryDoneEvent
  | RunCancelledEvent
  | RunCompletedEvent
  | RunCreatedEvent
  | RunFailedEvent
  | RunRequeuedEvent
  | RunResumedEvent
  | RunStartedEvent
  | RunWaitingEvent
  | SessionCreatedEvent
  | StreamDeltaEvent
  | StreamDoneEvent
  | ThreadCreatedEvent
  | ThreadNamingCompletedEvent
  | ThreadNamingFailedEvent
  | ThreadNamingRequestedEvent
  | ThreadNamingStartedEvent
  | ThreadUpdatedEvent
  | ToolCalledEvent
  | ToolCompletedEvent
  | ToolConfirmationGrantedEvent
  | ToolConfirmationRejectedEvent
  | ToolConfirmationRequestedEvent
  | ToolFailedEvent
  | ToolWaitingEvent
  | TurnCompletedEvent
  | TurnStartedEvent
  | UploadFailedEvent
  | WaitTimedOutEvent
  | WebSearchProgressEvent
  | WorkspaceCreatedEvent
  | WorkspaceResolvedEvent

export type BackendEventType = BackendEvent['type']

export const BACKEND_EVENT_TYPES = [
  'agent.created',
  'agent.revision.created',
  'child_run.completed',
  'child_run.created',
  'delegation.started',
  'file.linked',
  'file.uploaded',
  'generation.completed',
  'generation.failed',
  'generation.started',
  'job.blocked',
  'job.cancelled',
  'job.completed',
  'job.created',
  'job.queued',
  'job.requeued',
  'job.superseded',
  'job.waiting',
  'memory.observation.completed',
  'memory.observation.started',
  'memory.reflection.completed',
  'memory.reflection.started',
  'message.posted',
  'progress.reported',
  'reasoning.summary.delta',
  'reasoning.summary.done',
  'run.cancelling',
  'run.cancelled',
  'run.completed',
  'run.created',
  'run.failed',
  'run.requeued',
  'run.resumed',
  'run.started',
  'run.waiting',
  'session.created',
  'stream.delta',
  'stream.done',
  'thread.created',
  'thread.naming.completed',
  'thread.naming.failed',
  'thread.naming.requested',
  'thread.naming.started',
  'thread.updated',
  'tool.called',
  'tool.completed',
  'tool.confirmation_granted',
  'tool.confirmation_rejected',
  'tool.confirmation_requested',
  'tool.failed',
  'tool.waiting',
  'turn.completed',
  'turn.started',
  'upload.failed',
  'wait.timed_out',
  'web_search.progress',
  'workspace.created',
  'workspace.resolved',
] as const satisfies readonly BackendEventType[]
