import type {
  MessageAttachment,
  MessageId,
  MessageStatus,
  RunId,
} from '@wonderlands/contracts/chat'
import { asMessageId } from '@wonderlands/contracts/chat'
import type { RunTranscriptSources, RunTranscriptState, UiMessage } from '../types'

interface RunTranscriptShellDependencies {
  cloneAttachments: (attachments: MessageAttachment[]) => MessageAttachment[]
  cloneUiMessage: (message: UiMessage) => UiMessage
  getIsWaiting: () => boolean
  getLiveAssistantLane: () => {
    resolveTranscriptProjectionMessageId: (runId: RunId) => MessageId
    syncLiveAssistantProjectionFromTranscript: (
      runId: RunId,
      createdAt: string,
      options?: { preferredId?: MessageId },
    ) => UiMessage | null
  } | null
  getLiveAssistantMessage: () => UiMessage | null
  getLiveAssistantMessageIdState: () => MessageId | null
  getRunId: () => RunId | null
  getRunStatus: () =>
    | 'pending'
    | 'running'
    | 'waiting'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | null
  runTranscripts: {
    clearTextBlocksForLiveResume: (runId: RunId) => void
    ensure: (
      runId: RunId,
      createdAt: string,
      context: {
        activeRunId: RunId | null
        activeRunStatus:
          | 'pending'
          | 'running'
          | 'waiting'
          | 'completed'
          | 'failed'
          | 'cancelled'
          | null
      },
      options: {
        seedMessage?: UiMessage | null
        source?: keyof RunTranscriptSources
        status?: MessageStatus
      },
    ) => RunTranscriptState
    projectAssistantMessage: (message: UiMessage) => UiMessage
    rememberFromMessage: (
      message: UiMessage,
      source: keyof RunTranscriptSources,
      context: {
        activeRunId: RunId | null
        activeRunStatus:
          | 'pending'
          | 'running'
          | 'waiting'
          | 'completed'
          | 'failed'
          | 'cancelled'
          | null
      },
    ) => void
    toMessage: (transcript: RunTranscriptState) => UiMessage
  }
  syncSandboxAttachmentsFromBlocks: (
    message: UiMessage,
    options?: { force?: boolean; reveal?: boolean },
  ) => void
}

export const createRunTranscriptShell = ({
  cloneAttachments,
  cloneUiMessage,
  getIsWaiting,
  getLiveAssistantLane,
  getLiveAssistantMessage,
  getLiveAssistantMessageIdState,
  getRunId,
  getRunStatus,
  runTranscripts,
  syncSandboxAttachmentsFromBlocks,
}: RunTranscriptShellDependencies) => {
  const rememberRunTranscriptFromMessage = (
    message: UiMessage,
    source: keyof RunTranscriptSources,
  ): void => {
    runTranscripts.rememberFromMessage(message, source, {
      activeRunId: getRunId(),
      activeRunStatus: getRunStatus(),
    })
  }

  const projectAssistantMessageFromRunTranscript = (message: UiMessage): UiMessage =>
    runTranscripts.projectAssistantMessage(message)

  const resolveTranscriptProjectionMessageId = (runId: RunId): MessageId =>
    getLiveAssistantLane()?.resolveTranscriptProjectionMessageId(runId) ??
    (getLiveAssistantMessage()?.runId === runId
      ? getLiveAssistantMessage()!.id
      : (getLiveAssistantMessageIdState() ?? asMessageId(`live:${String(runId)}`)))

  const syncLiveAssistantProjectionFromTranscript = (
    runId: RunId,
    createdAt: string,
    options: { preferredId?: MessageId } = {},
  ): UiMessage | null =>
    getLiveAssistantLane()?.syncLiveAssistantProjectionFromTranscript(runId, createdAt, options) ??
    null

  const ensureRunTranscript = (
    runId: RunId,
    createdAt: string,
    options: {
      preferredMessageId?: MessageId
      source?: keyof RunTranscriptSources
      status?: MessageStatus
    } = {},
  ): RunTranscriptState => {
    const liveAssistantMessage = getLiveAssistantMessage()
    const transcript = runTranscripts.ensure(
      runId,
      createdAt,
      {
        activeRunId: getRunId(),
        activeRunStatus: getRunStatus(),
      },
      {
        seedMessage:
          liveAssistantMessage?.role === 'assistant' && liveAssistantMessage.runId === runId
            ? cloneUiMessage(liveAssistantMessage)
            : null,
        source: options.source,
        status: options.status ?? (getIsWaiting() ? 'waiting' : 'streaming'),
      },
    )

    if (options.preferredMessageId) {
      syncLiveAssistantProjectionFromTranscript(runId, createdAt, {
        preferredId: options.preferredMessageId,
      })
    }

    return transcript
  }

  const clearTranscriptTextBlocksForLiveResume = (runId: RunId): void => {
    runTranscripts.clearTextBlocksForLiveResume(runId)
  }

  const syncSandboxAttachmentsFromTranscript = (
    transcript: RunTranscriptState,
    options: { force?: boolean; reveal?: boolean } = {},
  ): void => {
    const projectedMessage = runTranscripts.toMessage(transcript)
    syncSandboxAttachmentsFromBlocks(projectedMessage, options)
    transcript.attachments = cloneAttachments(projectedMessage.attachments)
  }

  return {
    clearTranscriptTextBlocksForLiveResume,
    ensureRunTranscript,
    projectAssistantMessageFromRunTranscript,
    rememberRunTranscriptFromMessage,
    resolveTranscriptProjectionMessageId,
    syncLiveAssistantProjectionFromTranscript,
    syncSandboxAttachmentsFromTranscript,
  }
}
