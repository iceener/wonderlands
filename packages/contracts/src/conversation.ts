import type { ConversationTargetInput } from './agents'
import type {
  AcceptedRunResumeOutputContract,
  AcceptedThreadInteractionOutputContract,
  BackendPendingWaitContract,
  BackendSessionContract,
  BackendThreadContract,
  BackendThreadRootJobContract,
  BackendUsageContract,
  BootstrapSessionAcceptedOutputContract,
  CancelRunOutputContract,
  CompletedRunExecutionOutputContract,
  PostThreadMessageOutputContract,
  WaitingRunExecutionOutputContract,
} from './conversation-schemas'
import type {
  FileId,
  MessageId,
  RunId,
  SessionId,
  ThreadId,
  ToolCallId,
  ToolProfileId,
} from './ids'
import type { MessageRole, ProviderName, ReasoningOptions } from './shared'

type Replace<TValue, TOverrides> = Omit<TValue, keyof TOverrides> & TOverrides

export interface ThreadMessageContentPart {
  text: string
  type: 'text'
}

export interface BackendThreadMessage {
  authorAccountId: string | null
  authorKind: MessageRole
  content: ThreadMessageContentPart[]
  createdAt: string
  id: MessageId
  metadata: unknown | null
  runId: RunId | null
  sequence: number
  sessionId: SessionId
  tenantId: string
  threadId: ThreadId
}

export type ThreadActivityState =
  | 'idle'
  | 'pending'
  | 'running'
  | 'waiting'
  | 'approval'
  | 'failed'
  | 'completed'

export type BackendThreadRootJob = Replace<
  BackendThreadRootJobContract,
  {
    currentRunId: RunId | null
  }
>

export type BackendThread = Replace<
  BackendThreadContract,
  {
    branchFromMessageId?: MessageId | null
    id: ThreadId
    parentThreadId: ThreadId | null
    rootJob?: BackendThreadRootJob | null
    sessionId: SessionId
  }
>

export type BackendSession = Replace<
  BackendSessionContract,
  {
    id: SessionId
    rootRunId: RunId | null
  }
>

export interface BackendRun {
  actorAccountId?: string | null
  completedAt: string | null
  configSnapshot: Record<string, unknown>
  createdAt: string
  errorJson: unknown | null
  id: RunId
  lastProgressAt: string | null
  parentRunId: RunId | null
  resultJson: unknown | null
  rootRunId: RunId
  sessionId: SessionId
  sourceCallId: string | null
  startedAt: string | null
  status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
  task: string
  targetKind?: 'assistant' | 'agent'
  tenantId: string
  threadId: ThreadId | null
  toolProfileId?: ToolProfileId | null
  turnCount: number
  updatedAt: string
  version: number
  workspaceRef: string | null
}

export interface CreateSessionInput {
  metadata?: Record<string, unknown> | null
  title?: string | null
  workspaceRef?: string | null
}

export type CreateSessionOutput = BackendSession

export interface CreateSessionThreadInput {
  parentThreadId?: ThreadId | string | null
  title?: string | null
}

export type CreateSessionThreadOutput = BackendThread

export interface BranchThreadInput {
  sourceMessageId: MessageId | string
  title?: string | null
}

export type BranchThreadOutput = BackendThread

export interface ExecuteRunInput {
  maxOutputTokens?: number
  model?: string
  modelAlias?: string
  provider?: ProviderName
  reasoning?: ReasoningOptions
  temperature?: number
}

export interface BootstrapSessionInput extends ExecuteRunInput {
  initialMessage: string
  metadata?: Record<string, unknown> | null
  target?: ConversationTargetInput
  task?: string
  threadTitle?: string | null
  title?: string | null
  workspaceRef?: string | null
}

export type BackendUsage = BackendUsageContract
export type CompletedRunExecutionOutput = Replace<
  CompletedRunExecutionOutputContract,
  {
    assistantMessageId: MessageId | null
    runId: RunId
  }
>

export type BackendPendingWait = Replace<
  BackendPendingWaitContract,
  {
    callId: ToolCallId | string
  }
>

export type WaitingRunExecutionOutput = Replace<
  WaitingRunExecutionOutputContract,
  {
    pendingWaits: BackendPendingWait[]
    runId: RunId
  }
>

export type RunExecutionOutput = CompletedRunExecutionOutput | WaitingRunExecutionOutput

export type AcceptedRunResumeOutput = Replace<
  AcceptedRunResumeOutputContract,
  {
    runId: RunId
  }
>

export type ResumeRunOutput = AcceptedRunResumeOutput | RunExecutionOutput

export type BootstrapSessionAcceptedOutput = Replace<
  BootstrapSessionAcceptedOutputContract,
  {
    messageId: MessageId
    runId: RunId
    sessionId: SessionId
    threadId: ThreadId
  }
>

export type BootstrapSessionOutput = RunExecutionOutput & {
  inputMessageId: MessageId
  sessionId: SessionId
  threadId: ThreadId
}

export type BootstrapSessionRouteOutput =
  | BootstrapSessionAcceptedOutput
  | BootstrapSessionOutput

export interface StartThreadInteractionInput extends ExecuteRunInput {
  content?: ThreadMessageContentPart[]
  fileIds?: Array<FileId | string>
  messageId?: MessageId | string
  metadata?: Record<string, unknown> | null
  target?: ConversationTargetInput
  task?: string
  text?: string
}

export interface EditThreadMessageInput {
  content?: ThreadMessageContentPart[]
  fileIds: Array<FileId | string>
  metadata?: Record<string, unknown> | null
  text?: string
}

export interface EditThreadMessageOutput {
  attachedFileIds: FileId[]
  messageId: MessageId
  sessionId: SessionId
  threadId: ThreadId
}

export interface PostThreadMessageInput {
  content?: ThreadMessageContentPart[]
  metadata?: Record<string, unknown> | null
  text?: string
}

export type PostThreadMessageOutput = Replace<
  PostThreadMessageOutputContract,
  {
    messageId: MessageId
    sessionId: SessionId
    threadId: ThreadId
  }
>

export type AcceptedThreadInteractionOutput = Replace<
  AcceptedThreadInteractionOutputContract,
  {
    attachedFileIds: FileId[]
    inputMessageId: MessageId
    runId: RunId
    sessionId: SessionId
    threadId: ThreadId
  }
>

export type CancelRunOutput = Replace<
  CancelRunOutputContract,
  {
    runId: RunId
  }
>

export type StartThreadInteractionOutput =
  | AcceptedThreadInteractionOutput
  | (RunExecutionOutput & {
      attachedFileIds: FileId[]
      inputMessageId: MessageId
      sessionId: SessionId
      threadId: ThreadId
    })
