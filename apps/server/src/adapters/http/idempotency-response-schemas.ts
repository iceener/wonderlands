import {
  acceptedRunResumeOutputSchema as sharedAcceptedRunResumeOutputSchema,
  acceptedThreadInteractionOutputSchema as sharedAcceptedThreadInteractionOutputSchema,
  backendSessionSchema as sharedBackendSessionSchema,
  backendThreadSchema as sharedBackendThreadSchema,
  bootstrapSessionAcceptedOutputSchema as sharedBootstrapSessionAcceptedOutputSchema,
  bootstrapSessionExecutionOutputSchema as sharedBootstrapSessionExecutionOutputSchema,
  bootstrapSessionRouteOutputSchema as sharedBootstrapSessionRouteOutputSchema,
  cancelRunOutputSchema as sharedCancelRunOutputSchema,
  completedRunExecutionOutputSchema as sharedCompletedRunExecutionOutputSchema,
  postThreadMessageOutputSchema as sharedPostThreadMessageOutputSchema,
  resumeRunOutputSchema as sharedResumeRunOutputSchema,
  runExecutionOutputSchema as sharedRunExecutionOutputSchema,
  startThreadInteractionOutputSchema as sharedStartThreadInteractionOutputSchema,
  waitingRunExecutionOutputSchema as sharedWaitingRunExecutionOutputSchema,
} from '@wonderlands/contracts'
import type { z } from 'zod'
import type { BootstrapSessionOutput as BootstrapSessionAcceptedOutput } from '../../application/commands/bootstrap-session'
import type { CancelRunOutput } from '../../application/commands/cancel-run'
import type { PostThreadMessageOutput } from '../../application/commands/post-thread-message'
import type {
  AcceptedRunResumeOutput,
  CompletedRunExecutionOutput,
  ResumeRunOutput,
  RunExecutionOutput,
  WaitingRunExecutionOutput,
} from '../../application/runtime/persistence/run-persistence'
import type { SessionThreadRecord } from '../../domain/sessions/session-thread-repository'
import type { WorkSessionRecord } from '../../domain/sessions/work-session-repository'
import type {
  FileId,
  RunId,
  SessionMessageId,
  SessionThreadId,
  WorkSessionId,
} from '../../shared/ids'

// Shared external payloads come from packages/contracts.
// Keep only server-private recovery snapshots local to the route modules.
const typedSchema = <TValue>(schema: z.ZodTypeAny): z.ZodType<TValue> => schema as z.ZodType<TValue>

type BootstrapSessionExecutionOutput = RunExecutionOutput & {
  inputMessageId: SessionMessageId
  sessionId: WorkSessionId
  threadId: SessionThreadId
}

type BootstrapSessionRouteOutput = BootstrapSessionAcceptedOutput | BootstrapSessionExecutionOutput

type AcceptedThreadInteractionOutput = {
  attachedFileIds: FileId[]
  inputMessageId: SessionMessageId
  runId: RunId
  sessionId: WorkSessionId
  status: 'accepted'
  threadId: SessionThreadId
}

type StartThreadInteractionOutput =
  | AcceptedThreadInteractionOutput
  | (RunExecutionOutput & {
      attachedFileIds: FileId[]
      inputMessageId: SessionMessageId
      sessionId: WorkSessionId
      threadId: SessionThreadId
    })

export const workSessionRecordSchema = typedSchema<WorkSessionRecord>(sharedBackendSessionSchema)
export const sessionThreadRecordSchema = typedSchema<SessionThreadRecord>(sharedBackendThreadSchema)
export const bootstrapSessionOutputSchema = typedSchema<BootstrapSessionAcceptedOutput>(
  sharedBootstrapSessionAcceptedOutputSchema,
)
export const bootstrapSessionExecutionOutputSchema = typedSchema<BootstrapSessionExecutionOutput>(
  sharedBootstrapSessionExecutionOutputSchema,
)
export const bootstrapSessionRouteOutputSchema = typedSchema<BootstrapSessionRouteOutput>(
  sharedBootstrapSessionRouteOutputSchema,
)
export const cancelRunOutputSchema = typedSchema<CancelRunOutput>(sharedCancelRunOutputSchema)
export const acceptedRunResumeOutputSchema = typedSchema<AcceptedRunResumeOutput>(
  sharedAcceptedRunResumeOutputSchema,
)
export const completedRunExecutionOutputSchema = typedSchema<CompletedRunExecutionOutput>(
  sharedCompletedRunExecutionOutputSchema,
)
export const postThreadMessageOutputSchema = typedSchema<PostThreadMessageOutput>(
  sharedPostThreadMessageOutputSchema,
)
export const resumeRunOutputSchema = typedSchema<ResumeRunOutput>(sharedResumeRunOutputSchema)
export const runExecutionOutputSchema = typedSchema<RunExecutionOutput>(
  sharedRunExecutionOutputSchema,
)
export const waitingRunExecutionOutputSchema = typedSchema<WaitingRunExecutionOutput>(
  sharedWaitingRunExecutionOutputSchema,
)
export const acceptedThreadInteractionOutputSchema = typedSchema<AcceptedThreadInteractionOutput>(
  sharedAcceptedThreadInteractionOutputSchema,
)
export const startThreadInteractionOutputSchema = typedSchema<StartThreadInteractionOutput>(
  sharedStartThreadInteractionOutputSchema,
)
