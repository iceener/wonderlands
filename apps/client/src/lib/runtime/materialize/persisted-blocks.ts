import type {
  Block,
  TextBlock,
  ThinkingBlock,
  ToolApprovalState,
  ToolInteractionBlock,
  WebSearchBlock,
} from '@wonderlands/contracts/chat'
import { asToolCallId } from '@wonderlands/contracts/chat'
import { createTextBlock } from './block-text'
import { isRecord, parseProviderName } from './shared'

const readSourceRunId = (value: unknown): string | undefined =>
  isRecord(value) && typeof value.sourceRunId === 'string' ? value.sourceRunId : undefined

const isToolStatus = (value: unknown): value is ToolInteractionBlock['status'] =>
  value === 'running' ||
  value === 'awaiting_confirmation' ||
  value === 'complete' ||
  value === 'error'

const parsePersistedApproval = (value: unknown): ToolApprovalState | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  if (value.status !== 'approved' && value.status !== 'rejected') {
    return undefined
  }

  if (typeof value.waitId !== 'string') {
    return undefined
  }

  return {
    description: typeof value.description === 'string' ? value.description : null,
    remembered: typeof value.remembered === 'boolean' ? value.remembered : null,
    status: value.status,
    targetRef: typeof value.targetRef === 'string' ? value.targetRef : null,
    waitId: value.waitId,
  }
}

const parsePersistedConfirmation = (
  value: unknown,
): ToolInteractionBlock['confirmation'] | undefined => {
  if (!isRecord(value) || typeof value.waitId !== 'string') {
    return undefined
  }

  return {
    description: typeof value.description === 'string' ? value.description : null,
    ...(typeof value.ownerRunId === 'string' ? { ownerRunId: value.ownerRunId } : {}),
    targetRef: typeof value.targetRef === 'string' ? value.targetRef : null,
    waitId: value.waitId,
  }
}

const parsePersistedAppsMeta = (value: unknown): ToolInteractionBlock['appsMeta'] | undefined => {
  if (!isRecord(value)) return undefined
  if (typeof value.resourceUri !== 'string' || typeof value.serverId !== 'string') return undefined
  return {
    resourceUri: value.resourceUri,
    serverId: value.serverId,
    permissions: isRecord(value.permissions) ? value.permissions : null,
    csp: isRecord(value.csp) ? value.csp : null,
  }
}

const parsePersistedToolBlock = (value: unknown): ToolInteractionBlock | null => {
  if (!isRecord(value) || value.type !== 'tool_interaction') {
    return null
  }

  if (
    typeof value.name !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.toolCallId !== 'string' ||
    !isToolStatus(value.status)
  ) {
    return null
  }

  // Derive childRunId from the tool output if not explicitly persisted (backend Issue 2).
  const persistedChildRunId = typeof value.childRunId === 'string' ? value.childRunId : null
  const outputChildRunId =
    !persistedChildRunId &&
    value.name === 'delegate_to_agent' &&
    isRecord(value.output) &&
    typeof (value.output as Record<string, unknown>).childRunId === 'string'
      ? ((value.output as Record<string, unknown>).childRunId as string)
      : null
  const childRunId = persistedChildRunId ?? outputChildRunId

  const appsMeta = parsePersistedAppsMeta(value.appsMeta)

  return {
    args: isRecord(value.args) ? value.args : null,
    approval: parsePersistedApproval(value.approval),
    ...(appsMeta ? { appsMeta } : {}),
    ...(childRunId ? { childRunId } : {}),
    confirmation: parsePersistedConfirmation(value.confirmation),
    createdAt: value.createdAt,
    ...(typeof value.finishedAt === 'string' ? { finishedAt: value.finishedAt } : {}),
    id: typeof value.id === 'string' ? value.id : `tool:${value.toolCallId}`,
    name: value.name,
    ...(Object.hasOwn(value, 'output') ? { output: value.output } : {}),
    ...(typeof value.sourceRunId === 'string' ? { sourceRunId: value.sourceRunId } : {}),
    status: value.status,
    toolCallId: asToolCallId(value.toolCallId),
    type: 'tool_interaction',
  }
}

const parsePersistedWebSearchBlock = (value: unknown): WebSearchBlock | null => {
  if (!isRecord(value) || value.type !== 'web_search') {
    return null
  }

  if (
    typeof value.createdAt !== 'string' ||
    typeof value.id !== 'string' ||
    typeof value.provider !== 'string' ||
    typeof value.searchId !== 'string' ||
    typeof value.status !== 'string' ||
    !Array.isArray(value.patterns) ||
    !Array.isArray(value.queries) ||
    !Array.isArray(value.references) ||
    !Array.isArray(value.targetUrls)
  ) {
    return null
  }

  return {
    createdAt: value.createdAt,
    ...(typeof value.finishedAt === 'string' ? { finishedAt: value.finishedAt } : {}),
    id: value.id,
    patterns: value.patterns.filter((entry): entry is string => typeof entry === 'string'),
    provider: parseProviderName(value.provider),
    queries: value.queries.filter((entry): entry is string => typeof entry === 'string'),
    references: value.references.flatMap((entry) => {
      if (
        !isRecord(entry) ||
        typeof entry.url !== 'string' ||
        (entry.title !== null && entry.title !== undefined && typeof entry.title !== 'string') ||
        (entry.domain !== null && entry.domain !== undefined && typeof entry.domain !== 'string')
      ) {
        return []
      }

      return [
        {
          domain: typeof entry.domain === 'string' ? entry.domain : null,
          title: typeof entry.title === 'string' ? entry.title : null,
          url: entry.url,
        },
      ]
    }),
    responseId: typeof value.responseId === 'string' ? value.responseId : null,
    searchId: value.searchId,
    ...(readSourceRunId(value) ? { sourceRunId: readSourceRunId(value) } : {}),
    status:
      value.status === 'failed' ||
      value.status === 'completed' ||
      value.status === 'searching' ||
      value.status === 'in_progress'
        ? value.status
        : 'in_progress',
    targetUrls: value.targetUrls.filter((entry): entry is string => typeof entry === 'string'),
    type: 'web_search',
  }
}

const parsePersistedThinkingBlock = (value: unknown): ThinkingBlock | null => {
  if (!isRecord(value) || value.type !== 'thinking') {
    return null
  }

  if (
    typeof value.content !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    (value.status !== 'thinking' && value.status !== 'done')
  ) {
    return null
  }

  return {
    content: value.content,
    createdAt: value.createdAt,
    id: value.id,
    ...(readSourceRunId(value) ? { sourceRunId: readSourceRunId(value) } : {}),
    status: value.status,
    title: value.title.toLowerCase(),
    type: 'thinking',
  }
}

const parsePersistedTextBlock = (value: unknown): TextBlock | null => {
  if (!isRecord(value) || value.type !== 'text') {
    return null
  }

  if (
    typeof value.content !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.id !== 'string'
  ) {
    return null
  }

  return createTextBlock(value.id, value.createdAt, value.content, false, readSourceRunId(value))
}

const parsePersistedTranscriptBlock = (value: unknown): Block | null =>
  parsePersistedThinkingBlock(value) ??
  parsePersistedTextBlock(value) ??
  parsePersistedToolBlock(value) ??
  parsePersistedWebSearchBlock(value)

const readPersistedTranscript = (metadata: unknown): Record<string, unknown> | null => {
  if (!isRecord(metadata)) {
    return null
  }

  if (isRecord(metadata.transcript)) {
    return metadata.transcript
  }

  if (metadata.version === 1 || metadata.version === 2) {
    return metadata
  }

  return null
}

const parseLegacyPersistedAssistantTranscript = (
  transcript: Record<string, unknown>,
): Array<ToolInteractionBlock | WebSearchBlock> => {
  const toolBlocks = Array.isArray(transcript.toolBlocks)
    ? transcript.toolBlocks
        .map((block) => parsePersistedToolBlock(block))
        .filter((block): block is ToolInteractionBlock => block !== null)
    : []
  const webSearchBlocks = Array.isArray(transcript.webSearchBlocks)
    ? transcript.webSearchBlocks
        .map((block) => parsePersistedWebSearchBlock(block))
        .filter((block): block is WebSearchBlock => block !== null)
    : []

  return [...toolBlocks, ...webSearchBlocks].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt)
    const rightTime = Date.parse(right.createdAt)

    if (Number.isNaN(leftTime) || Number.isNaN(rightTime) || leftTime === rightTime) {
      return left.id.localeCompare(right.id)
    }

    return leftTime - rightTime
  })
}

const parsePersistedAssistantTranscript = (metadata: unknown): Block[] => {
  const transcript = readPersistedTranscript(metadata)

  if (!transcript) {
    return []
  }

  if (transcript.version === 2 && Array.isArray(transcript.blocks)) {
    return transcript.blocks
      .map((block) => parsePersistedTranscriptBlock(block))
      .filter((block): block is Block => block !== null)
  }

  if (transcript.version !== 1) {
    return []
  }

  return parseLegacyPersistedAssistantTranscript(transcript)
}

export const materializePersistedAssistantBlocks = (
  text: string,
  createdAt: string,
  metadata?: unknown,
): Block[] => {
  const blocks: Block[] = parsePersistedAssistantTranscript(metadata)
  const trimmedText = text.trim()

  if (trimmedText) {
    blocks.push(createTextBlock(`text:persisted:${createdAt}`, createdAt, text, false))
  }

  return blocks
}
