import type {
  BackendRun,
  Block,
  MessageAttachment,
  MessageStatus,
  RunId,
} from '@wonderlands/contracts/chat'
import { asMessageId } from '@wonderlands/contracts/chat'
import type { RunTranscriptSources, RunTranscriptState, UiMessage } from '../types'

const mergeAssistantToolBlocks = (blocks: Block[]): Block[] => {
  const merged: Block[] = []
  const toolIndexByCallId = new Map<string, number>()

  for (const block of blocks) {
    if (block?.type !== 'tool_interaction') {
      merged.push(block)
      continue
    }

    const existingIndex = toolIndexByCallId.get(block.toolCallId)
    if (existingIndex === undefined) {
      toolIndexByCallId.set(block.toolCallId, merged.length)
      merged.push(block)
      continue
    }

    const existing = merged[existingIndex]
    if (existing?.type !== 'tool_interaction') {
      merged[existingIndex] = block
      continue
    }

    merged[existingIndex] = {
      ...existing,
      ...block,
      args: block.args ?? existing.args ?? null,
      approval: block.approval ?? existing.approval,
      confirmation: block.confirmation ?? existing.confirmation,
      output: Object.hasOwn(block, 'output') ? block.output : existing.output,
    }
  }

  return merged
}

const hasRenderableAssistantTranscript = (
  message: Pick<UiMessage, 'blocks'> | Pick<RunTranscriptState, 'blocks'>,
): boolean =>
  message.blocks.some((block) => {
    if (block.type === 'text' || block.type === 'thinking' || block.type === 'web_search') {
      return true
    }

    return block.type === 'tool_interaction' && block.status !== 'awaiting_confirmation'
  })

const hasRichAssistantTranscript = (message: UiMessage): boolean =>
  message.blocks.some((block) => block.type !== 'text') || message.blocks.length > 1

const cloneRunTranscript = (
  transcript: RunTranscriptState,
  cloneAttachments: (attachments: MessageAttachment[]) => MessageAttachment[],
  cloneBlocks: (blocks: Block[]) => Block[],
): RunTranscriptState => ({
  attachments: cloneAttachments(transcript.attachments),
  blocks: cloneBlocks(transcript.blocks),
  createdAt: transcript.createdAt,
  finishReason: transcript.finishReason,
  messageId: transcript.messageId,
  runId: transcript.runId,
  sequence: transcript.sequence,
  sources: { ...transcript.sources },
  status: transcript.status,
  text: transcript.text,
})

interface ActiveRunContext {
  activeRunId: RunId | null
  activeRunStatus: BackendRun['status'] | null
}

interface EnsureTranscriptOptions {
  seedMessage?: UiMessage | null
  source?: keyof RunTranscriptSources
  status?: MessageStatus
}

interface CreateRunTranscriptStoreOptions {
  cloneAttachments: (attachments: MessageAttachment[]) => MessageAttachment[]
  cloneBlocks: (blocks: Block[]) => Block[]
  extractSandboxOutputAttachments: (blocks: Block[]) => MessageAttachment[]
  isTerminalRunStatus: (status: BackendRun['status'] | null) => boolean
  mergeAttachments: (
    existing: MessageAttachment[],
    incoming: MessageAttachment[],
  ) => MessageAttachment[]
  settleBlocksForRunTerminalState: (
    blocks: Block[],
    context: {
      createdAt: string
      runId: string | null
      status: Extract<BackendRun['status'], 'cancelled' | 'completed' | 'failed' | 'waiting'>
    },
  ) => void
  terminalRunStatusForFinishReason: (
    finishReason: UiMessage['finishReason'],
  ) => Extract<BackendRun['status'], 'cancelled' | 'completed' | 'failed' | 'waiting'> | null
}

export const createRunTranscriptStore = ({
  cloneAttachments,
  cloneBlocks,
  extractSandboxOutputAttachments,
  isTerminalRunStatus,
  mergeAttachments,
  settleBlocksForRunTerminalState,
  terminalRunStatusForFinishReason,
}: CreateRunTranscriptStoreOptions) => {
  const transcriptsByRunId = new Map<RunId, RunTranscriptState>()

  const toMessage = (transcript: RunTranscriptState): UiMessage => ({
    attachments: cloneAttachments(transcript.attachments),
    blocks: cloneBlocks(transcript.blocks),
    createdAt: transcript.createdAt,
    finishReason: transcript.finishReason,
    id: transcript.messageId ?? asMessageId(`live:${transcript.runId}`),
    role: 'assistant',
    runId: transcript.runId,
    sequence: transcript.sequence,
    status: transcript.status,
    text: transcript.text,
    uiKey: transcript.messageId ?? asMessageId(`live:${transcript.runId}`),
  })

  const mergeDurableAssistantIntoTranscript = (
    transcriptMessage: UiMessage,
    message: UiMessage,
    context: ActiveRunContext,
  ): UiMessage => {
    if (
      message.role !== 'assistant' ||
      message.runId == null ||
      transcriptMessage.runId !== message.runId ||
      transcriptMessage.blocks.length === 0
    ) {
      return message
    }

    if (!hasRenderableAssistantTranscript(transcriptMessage)) {
      return message
    }

    const normalizedTranscriptBlocks = mergeAssistantToolBlocks(
      cloneBlocks(transcriptMessage.blocks),
    )
    const durableTerminalStatus = terminalRunStatusForFinishReason(message.finishReason)

    if (durableTerminalStatus) {
      settleBlocksForRunTerminalState(normalizedTranscriptBlocks, {
        createdAt: message.createdAt,
        runId: message.runId ? String(message.runId) : null,
        status: durableTerminalStatus,
      })
    }

    const normalizedTranscriptAttachments = mergeAttachments(
      transcriptMessage.attachments,
      extractSandboxOutputAttachments(normalizedTranscriptBlocks),
    )

    if (
      isTerminalRunStatus(context.activeRunStatus) &&
      context.activeRunId !== transcriptMessage.runId
    ) {
      const transcriptHasAdditionalAttachments =
        normalizedTranscriptAttachments.length > message.attachments.length
      const transcriptHasRicherTranscript =
        hasRichAssistantTranscript({ ...transcriptMessage, blocks: normalizedTranscriptBlocks }) &&
        !hasRichAssistantTranscript(message)
      const transcriptHasLongerText =
        transcriptMessage.text.trim().length > message.text.trim().length

      if (
        !transcriptHasAdditionalAttachments &&
        !transcriptHasRicherTranscript &&
        !transcriptHasLongerText
      ) {
        return message
      }
    }

    return {
      ...message,
      attachments: mergeAttachments(message.attachments, normalizedTranscriptAttachments),
      blocks: normalizedTranscriptBlocks,
      finishReason: durableTerminalStatus
        ? message.finishReason
        : transcriptMessage.finishReason === 'waiting' && message.finishReason === 'stop'
          ? message.finishReason
          : (transcriptMessage.finishReason ?? message.finishReason),
      status: durableTerminalStatus ? message.status : transcriptMessage.status,
      text: transcriptMessage.text.trim().length > 0 ? transcriptMessage.text : message.text,
    }
  }

  const rememberFromMessage = (
    message: UiMessage,
    source: keyof RunTranscriptSources,
    context: ActiveRunContext,
  ): void => {
    if (message.role !== 'assistant' || message.runId == null) {
      return
    }

    const runId = message.runId
    const existing = transcriptsByRunId.get(runId) ?? null
    const nextSources: RunTranscriptSources = {
      durableMessage: source === 'durableMessage' || existing?.sources.durableMessage === true,
      durableSnapshot: source === 'durableSnapshot' || existing?.sources.durableSnapshot === true,
      liveStream: source === 'liveStream' || existing?.sources.liveStream === true,
      localCache: source === 'localCache' || existing?.sources.localCache === true,
    }

    if (
      source === 'localCache' &&
      existing &&
      (existing.sources.liveStream ||
        existing.sources.durableSnapshot ||
        existing.sources.durableMessage)
    ) {
      transcriptsByRunId.set(runId, {
        ...cloneRunTranscript(existing, cloneAttachments, cloneBlocks),
        sources: nextSources,
      })
      return
    }

    if (
      source === 'durableMessage' &&
      existing &&
      (existing.sources.liveStream ||
        existing.sources.durableSnapshot ||
        existing.sources.localCache)
    ) {
      const merged = mergeDurableAssistantIntoTranscript(toMessage(existing), message, context)
      transcriptsByRunId.set(runId, {
        attachments: cloneAttachments(merged.attachments),
        blocks: cloneBlocks(merged.blocks),
        createdAt: existing.createdAt,
        finishReason: merged.finishReason,
        messageId: message.id,
        runId,
        sequence: message.sequence ?? existing.sequence,
        sources: nextSources,
        status: merged.status,
        text: merged.text,
      })
      return
    }

    transcriptsByRunId.set(runId, {
      attachments: cloneAttachments(message.attachments),
      blocks: mergeAssistantToolBlocks(cloneBlocks(message.blocks)),
      createdAt: existing?.createdAt ?? message.createdAt,
      finishReason: message.finishReason,
      messageId: source === 'durableMessage' ? message.id : (existing?.messageId ?? null),
      runId,
      sequence:
        source === 'durableMessage' ? message.sequence : (existing?.sequence ?? message.sequence),
      sources: nextSources,
      status: message.status,
      text: message.text,
    })
  }

  const ensure = (
    runId: RunId,
    createdAt: string,
    context: ActiveRunContext,
    options: EnsureTranscriptOptions = {},
  ): RunTranscriptState => {
    const existing = transcriptsByRunId.get(runId)
    if (existing) {
      existing.sources[options.source ?? 'liveStream'] = true
      existing.status = options.status ?? existing.status
      if (existing.createdAt.trim().length === 0) {
        existing.createdAt = createdAt
      }
      return existing
    }

    if (
      options.seedMessage?.role === 'assistant' &&
      options.seedMessage.runId != null &&
      options.seedMessage.runId === runId
    ) {
      rememberFromMessage(options.seedMessage, options.source ?? 'liveStream', context)
      const seeded = transcriptsByRunId.get(runId)
      if (seeded) {
        seeded.status = options.status ?? seeded.status
        return seeded
      }
    }

    const sources: RunTranscriptSources = {
      durableMessage: false,
      durableSnapshot: false,
      liveStream: false,
      localCache: false,
    }
    sources[options.source ?? 'liveStream'] = true

    const transcript: RunTranscriptState = {
      attachments: [],
      blocks: [],
      createdAt,
      finishReason: null,
      messageId: null,
      runId,
      sequence: null,
      sources,
      status: options.status ?? 'streaming',
      text: '',
    }

    transcriptsByRunId.set(runId, transcript)
    return transcript
  }

  const projectAssistantMessage = (message: UiMessage): UiMessage => {
    if (message.role !== 'assistant' || message.runId == null) {
      return message
    }

    const transcript = transcriptsByRunId.get(message.runId)
    if (!transcript) {
      return message
    }

    return {
      ...message,
      attachments: mergeAttachments(message.attachments, transcript.attachments),
      blocks: cloneBlocks(transcript.blocks),
      finishReason: transcript.finishReason ?? message.finishReason,
      sequence: message.sequence ?? transcript.sequence,
      status: transcript.status,
      text: transcript.text.trim().length > 0 ? transcript.text : message.text,
    }
  }

  const toDurableThreadMessageRow = (message: UiMessage): UiMessage => {
    if (message.role !== 'assistant' || message.runId == null) {
      return message
    }

    if (!transcriptsByRunId.has(message.runId)) {
      return message
    }

    return {
      ...message,
      blocks: [],
      text: '',
    }
  }

  const clearTextBlocksForLiveResume = (runId: RunId): void => {
    const transcript = transcriptsByRunId.get(runId)
    if (!transcript) {
      return
    }

    const nextBlocks = transcript.blocks.filter((block) => block.type !== 'text')
    if (nextBlocks.length === transcript.blocks.length) {
      return
    }

    transcript.blocks = nextBlocks
    transcript.text = ''
  }

  const set = (runId: RunId, transcript: RunTranscriptState): void => {
    transcriptsByRunId.set(runId, {
      attachments: cloneAttachments(transcript.attachments),
      blocks: cloneBlocks(transcript.blocks),
      createdAt: transcript.createdAt,
      finishReason: transcript.finishReason,
      messageId: transcript.messageId,
      runId: transcript.runId,
      sequence: transcript.sequence,
      sources: { ...transcript.sources },
      status: transcript.status,
      text: transcript.text,
    })
  }

  return {
    clear(): void {
      transcriptsByRunId.clear()
    },
    clearTextBlocksForLiveResume,
    ensure,
    get(runId: RunId): RunTranscriptState | null {
      return transcriptsByRunId.get(runId) ?? null
    },
    has(runId: RunId): boolean {
      return transcriptsByRunId.has(runId)
    },
    projectAssistantMessage,
    rememberFromMessage,
    set,
    toDurableThreadMessageRow,
    toMessage,
    values(): IterableIterator<RunTranscriptState> {
      return transcriptsByRunId.values()
    },
  }
}
