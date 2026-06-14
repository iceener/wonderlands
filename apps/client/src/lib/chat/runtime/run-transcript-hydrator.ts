import type { BackendRun, MessageId } from '@wonderlands/contracts/chat'
import { asMessageId } from '@wonderlands/contracts/chat'
import type { PersistedRunTranscriptState, RunTranscriptState, UiMessage } from '../types'

interface RunTranscriptHydratorDependencies {
  cloneAttachments: (
    attachments: RunTranscriptState['attachments'],
  ) => RunTranscriptState['attachments']
  cloneBlocks: (blocks: RunTranscriptState['blocks']) => RunTranscriptState['blocks']
  durableHasAssistantForRun: (runId: BackendRun['id'] | null) => boolean
  finishReasonForRunStatus: (status: BackendRun['status']) => UiMessage['finishReason']
  getActiveRunId: () => BackendRun['id'] | null
  getLiveAssistantMessage: () => UiMessage | null
  getLiveAssistantMessageIdState: () => MessageId | null
  getRunTranscript: (runId: BackendRun['id']) => RunTranscriptState | null
  isResultRecord: (value: unknown) => value is Record<string, unknown>
  materializePersistedAssistantBlocks: (
    text: string,
    createdAt: string,
    resultJson: Record<string, unknown>,
  ) => RunTranscriptState['blocks']
  rememberRunTranscriptFromMessage: (message: UiMessage, source: 'durableSnapshot') => void
  setRunTranscript: (runId: BackendRun['id'], transcript: RunTranscriptState) => void
  syncLiveAssistantProjectionFromTranscript: (
    runId: BackendRun['id'],
    createdAt: string,
    options?: { preferredId?: MessageId },
  ) => UiMessage | null
  syncProjectedMessages: (options?: { pulse?: boolean }) => void
  syncSandboxAttachmentsFromBlocks: (
    message: UiMessage,
    options?: { force?: boolean; reveal?: boolean },
  ) => void
}

export const createRunTranscriptHydrator = ({
  cloneAttachments,
  cloneBlocks,
  durableHasAssistantForRun,
  finishReasonForRunStatus,
  getActiveRunId,
  getLiveAssistantMessage,
  getLiveAssistantMessageIdState,
  getRunTranscript,
  isResultRecord,
  materializePersistedAssistantBlocks,
  rememberRunTranscriptFromMessage,
  setRunTranscript,
  syncLiveAssistantProjectionFromTranscript,
  syncProjectedMessages,
  syncSandboxAttachmentsFromBlocks,
}: RunTranscriptHydratorDependencies) => {
  const hydrateAssistantTranscriptFromRunSnapshot = (run: BackendRun): boolean => {
    if (!isResultRecord(run.resultJson)) {
      return false
    }

    const canHydrate =
      run.status === 'waiting' || run.status === 'failed' || run.status === 'cancelled'
    if (!canHydrate) {
      return false
    }

    const shouldReplaceExistingBlocks = run.status === 'failed' || run.status === 'cancelled'
    const existingTranscript = getRunTranscript(run.id)

    if (
      !shouldReplaceExistingBlocks &&
      existingTranscript &&
      existingTranscript.blocks.length > 0
    ) {
      return false
    }

    const liveAssistantMessage = getLiveAssistantMessage()
    const snapshotMessageId =
      liveAssistantMessage?.runId === run.id
        ? liveAssistantMessage.id
        : (getLiveAssistantMessageIdState() ?? asMessageId(`live:${String(run.id)}`))

    const outputText =
      typeof run.resultJson.outputText === 'string' ? run.resultJson.outputText : ''
    const snapshotMessage: UiMessage = {
      attachments: [],
      blocks: materializePersistedAssistantBlocks(outputText, run.updatedAt, run.resultJson),
      createdAt: existingTranscript?.createdAt ?? run.updatedAt,
      finishReason: finishReasonForRunStatus(run.status),
      id: snapshotMessageId,
      role: 'assistant',
      runId: run.id,
      sequence: existingTranscript?.sequence ?? null,
      status: run.status === 'failed' ? 'error' : run.status === 'waiting' ? 'waiting' : 'complete',
      text: outputText,
      uiKey: snapshotMessageId,
    }

    syncSandboxAttachmentsFromBlocks(snapshotMessage, { force: true })
    rememberRunTranscriptFromMessage(snapshotMessage, 'durableSnapshot')
    syncLiveAssistantProjectionFromTranscript(run.id, run.updatedAt, {
      preferredId: snapshotMessageId,
    })
    syncProjectedMessages()
    return true
  }

  const restorePersistedRunTranscript = (transcript: PersistedRunTranscriptState | null) => {
    if (!transcript || durableHasAssistantForRun(transcript.runId)) {
      return
    }

    const activeRunId = getActiveRunId()
    if (activeRunId != null && transcript.runId !== activeRunId) {
      return
    }

    setRunTranscript(transcript.runId, {
      attachments: cloneAttachments(transcript.attachments),
      blocks: cloneBlocks(transcript.blocks),
      createdAt: transcript.createdAt,
      finishReason: transcript.finishReason,
      messageId: transcript.messageId,
      runId: transcript.runId,
      sequence: transcript.sequence,
      sources: {
        durableMessage: false,
        durableSnapshot: false,
        liveStream: false,
        localCache: true,
      },
      status: transcript.status,
      text: transcript.text,
    })

    const liveAssistantMessageId = transcript.messageId ?? asMessageId(`live:${transcript.runId}`)
    syncLiveAssistantProjectionFromTranscript(transcript.runId, transcript.createdAt, {
      preferredId: liveAssistantMessageId,
    })
    syncProjectedMessages({ pulse: true })
  }

  return {
    hydrateAssistantTranscriptFromRunSnapshot,
    restorePersistedRunTranscript,
  }
}
