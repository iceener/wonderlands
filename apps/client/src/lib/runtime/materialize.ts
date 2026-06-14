import type {
  BackendEvent,
  BackendPendingWait,
  Block,
  ProviderName,
  TextBlock,
  ThinkingBlock,
  ToolApprovalState,
  ToolInteractionBlock,
  WebSearchBlock,
  WebSearchReference,
} from '@wonderlands/contracts/chat'
import { asToolCallId } from '@wonderlands/contracts/chat'
import { rebuildIncrementalMarkdownView, syncIncrementalMarkdownView } from './streaming-markdown'

const findLatestOpenThinking = (blocks: Block[]): ThinkingBlock | null => {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block?.type === 'thinking' && block.status === 'thinking') {
      return block
    }
  }

  return null
}

const updateTextRenderState = (block: TextBlock): void => {
  block.renderState = syncIncrementalMarkdownView(block.renderState, {
    blockId: block.id,
    content: block.content,
    streaming: block.streaming,
    allowCompaction: true,
  })
}

const createTextBlock = (
  id: string,
  createdAt: string,
  content: string,
  streaming: boolean,
  sourceRunId?: string,
): TextBlock => ({
  id,
  ...(sourceRunId ? { sourceRunId } : {}),
  type: 'text',
  content,
  streaming,
  createdAt,
  renderState: rebuildIncrementalMarkdownView({
    blockId: id,
    content,
    streaming,
  }),
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFailedSandboxOutcome = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.sandboxExecutionId === 'string' &&
  (value.status === 'failed' || value.status === 'cancelled')

const parseProviderName = (value: unknown): ProviderName =>
  value === 'google' || value === 'openrouter' || value === 'openai' ? value : 'openai'

const readSourceRunId = (value: unknown): string | undefined =>
  isRecord(value) && typeof value.sourceRunId === 'string' ? value.sourceRunId : undefined

const dedupeStrings = (values: string[]): string[] => {
  const deduped: string[] = []

  for (const value of values) {
    if (value.length === 0 || deduped.includes(value)) {
      continue
    }

    deduped.push(value)
  }

  return deduped
}

const dedupeWebSearchReferences = (references: WebSearchReference[]): WebSearchReference[] => {
  const referencesByUrl: Record<string, WebSearchReference> = {}

  for (const reference of references) {
    const existing = referencesByUrl[reference.url]

    if (!existing) {
      referencesByUrl[reference.url] = reference
      continue
    }

    referencesByUrl[reference.url] = {
      domain: existing.domain ?? reference.domain,
      title: existing.title ?? reference.title,
      url: reference.url,
    }
  }

  return Object.values(referencesByUrl)
}

const mergeWebSearchStatus = (
  current: WebSearchBlock['status'],
  next: WebSearchBlock['status'],
): WebSearchBlock['status'] => {
  const rank: Record<WebSearchBlock['status'], number> = {
    in_progress: 0,
    searching: 1,
    completed: 2,
    failed: 3,
  }

  return rank[next] >= rank[current] ? next : current
}

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

const extractAppsMetaFromOutcome = (
  outcome: unknown,
): ToolInteractionBlock['appsMeta'] | undefined => {
  if (!isRecord(outcome)) return undefined
  const meta = outcome.meta
  if (!isRecord(meta)) return undefined
  const ui = meta.ui
  if (!isRecord(ui)) return undefined
  if (typeof ui.resourceUri !== 'string') return undefined
  if (typeof ui.serverId !== 'string' || ui.serverId.length === 0) return undefined
  return {
    resourceUri: ui.resourceUri,
    serverId: ui.serverId,
    permissions: isRecord(ui.permissions) ? ui.permissions : null,
    csp: isRecord(ui.csp) ? ui.csp : null,
  }
}

const extractAppsMetaFromPayload = (
  value: unknown,
): ToolInteractionBlock['appsMeta'] | undefined => {
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

const isConfirmationPendingWait = (wait: BackendPendingWait): boolean =>
  wait.requiresApproval === true

const createToolBlockFromPendingWait = (
  wait: BackendPendingWait,
): ToolInteractionBlock | ThinkingBlock =>
  isConfirmationPendingWait(wait)
    ? {
        args: wait.args,
        confirmation: {
          description: wait.description,
          ...(wait.ownerRunId ? { ownerRunId: wait.ownerRunId } : {}),
          targetRef: wait.targetRef,
          waitId: wait.waitId,
        },
        createdAt: wait.createdAt,
        id: `tool:${wait.callId}`,
        name: wait.tool,
        ...(wait.ownerRunId ? { sourceRunId: wait.ownerRunId } : {}),
        status: 'awaiting_confirmation',
        toolCallId: asToolCallId(String(wait.callId)),
        type: 'tool_interaction',
      }
    : {
        content: wait.description?.trim() || `Pending result: ${wait.waitId}`,
        createdAt: wait.createdAt,
        id: `waiting:${wait.waitId}`,
        status: 'done',
        title: wait.targetKind === 'human_response' ? 'Waiting for reply' : 'Waiting',
        type: 'thinking',
      }

export const materializePendingWaitBlocks = (pendingWaits: BackendPendingWait[]): Block[] =>
  pendingWaits.map((wait) => createToolBlockFromPendingWait(wait))

export const mergePendingWaitBlocks = (
  blocks: Block[],
  pendingWaits: BackendPendingWait[],
): Block[] => {
  const existingToolCallIds = new Set<string>()
  for (const block of blocks) {
    if (block.type === 'tool_interaction') {
      existingToolCallIds.add(block.toolCallId)
    }
  }

  const nextBlocks = [...blocks]

  for (const wait of pendingWaits) {
    if (!isConfirmationPendingWait(wait) && existingToolCallIds.has(String(wait.callId))) {
      continue
    }

    const pendingBlock = createToolBlockFromPendingWait(wait)
    const existingIndex = nextBlocks.findIndex((block) => block.id === pendingBlock.id)

    if (existingIndex === -1) {
      nextBlocks.push(pendingBlock)
      continue
    }

    nextBlocks[existingIndex] = pendingBlock
  }

  return nextBlocks
}

const closeStreamingText = (blocks: Block[]): void => {
  const lastBlock = blocks[blocks.length - 1]
  if (lastBlock?.type === 'text' && lastBlock.streaming) {
    lastBlock.streaming = false
    updateTextRenderState(lastBlock)
  }
}

const closeThinking = (blocks: Block[]): void => {
  const thinkingBlock = findLatestOpenThinking(blocks)
  if (thinkingBlock) {
    thinkingBlock.status = 'done'
  }
}

const blockBelongsToRun = (block: Block, runId: string | null): boolean => {
  if (runId == null || !('sourceRunId' in block)) {
    return true
  }

  if (typeof block.sourceRunId !== 'string' || block.sourceRunId.length === 0) {
    return true
  }

  return block.sourceRunId === runId
}

export const settleBlocksForRunTerminalState = (
  blocks: Block[],
  input: {
    createdAt: string
    runId: string | null
    status: 'cancelled' | 'completed' | 'failed' | 'waiting'
  },
): void => {
  const settledToolStatus =
    input.status === 'completed'
      ? 'complete'
      : input.status === 'failed' || input.status === 'cancelled'
        ? 'error'
        : null
  const settledWebSearchStatus =
    input.status === 'completed'
      ? 'completed'
      : input.status === 'failed' || input.status === 'cancelled'
        ? 'failed'
        : null

  for (const block of blocks) {
    if (!blockBelongsToRun(block, input.runId)) {
      continue
    }

    if (block.type === 'thinking' && block.status === 'thinking') {
      block.status = 'done'
      continue
    }

    if (block.type === 'text' && block.streaming) {
      block.streaming = false
      updateTextRenderState(block)
      continue
    }

    if (
      settledToolStatus !== null &&
      block.type === 'tool_interaction' &&
      (block.status === 'running' || block.status === 'awaiting_confirmation')
    ) {
      block.status = settledToolStatus
      block.confirmation = undefined
      block.finishedAt ??= input.createdAt
      continue
    }

    if (
      settledWebSearchStatus !== null &&
      block.type === 'web_search' &&
      (block.status === 'in_progress' || block.status === 'searching')
    ) {
      block.status = settledWebSearchStatus
      block.finishedAt ??= input.createdAt
    }
  }
}

const upsertThinkingBlock = (
  blocks: Block[],
  input: {
    content: string
    createdAt: string
    id: string
    sourceRunId?: string
    status: ThinkingBlock['status']
    title: string
  },
): void => {
  const existingIndex = blocks.findIndex(
    (block) => block.type === 'thinking' && block.id === input.id,
  )
  const nextBlock: ThinkingBlock = {
    content: input.content,
    createdAt: input.createdAt,
    id: input.id,
    ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
    status: input.status,
    title: input.title,
    type: 'thinking',
  }

  if (existingIndex === -1) {
    blocks.push(nextBlock)
    return
  }

  blocks[existingIndex] = nextBlock
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

export const materializeBlocks = (events: BackendEvent[]): Block[] => {
  const blocks: Block[] = []
  const toolIndexById = new Map<string, number>()
  const seenEventIds = new Set<string>()

  for (const event of events) {
    applyEvent(blocks, event, toolIndexById, seenEventIds)
  }

  return blocks
}

export const applyEvent = (
  blocks: Block[],
  event: BackendEvent,
  toolIndexById: Map<string, number>,
  seenEventIds?: Set<string>,
): boolean => {
  if (seenEventIds?.has(event.id)) {
    return false
  }

  seenEventIds?.add(event.id)

  switch (event.type) {
    case 'progress.reported': {
      // Backend progress events are internal lifecycle signals. The chat transcript
      // should stay focused on user-visible output, tool activity, and terminal run
      // states instead of leaking raw backend stage names like `context.loaded`.
      break
    }

    case 'stream.delta': {
      closeThinking(blocks)

      const lastBlock = blocks[blocks.length - 1]
      const eventSourceRunId = String(event.payload.runId)
      if (lastBlock?.type === 'text' && lastBlock.sourceRunId === eventSourceRunId) {
        lastBlock.content += event.payload.delta
        lastBlock.streaming = true
        updateTextRenderState(lastBlock)
        break
      }

      if (lastBlock?.type === 'text' && lastBlock.sourceRunId !== eventSourceRunId) {
        lastBlock.streaming = false
        updateTextRenderState(lastBlock)
      }

      blocks.push(
        createTextBlock(
          `text:${event.eventNo}`,
          event.createdAt,
          event.payload.delta,
          true,
          eventSourceRunId,
        ),
      )
      break
    }

    case 'reasoning.summary.delta': {
      upsertThinkingBlock(blocks, {
        content: event.payload.text,
        createdAt: event.createdAt,
        id: `thinking:${event.payload.itemId}`,
        sourceRunId: String(event.payload.runId),
        status: 'thinking',
        title: 'reasoning',
      })
      break
    }

    case 'reasoning.summary.done': {
      upsertThinkingBlock(blocks, {
        content: event.payload.text,
        createdAt: event.createdAt,
        id: `thinking:${event.payload.itemId}`,
        sourceRunId: String(event.payload.runId),
        status: 'done',
        title: 'reasoning',
      })
      break
    }

    case 'stream.done':
    case 'generation.completed':
      closeThinking(blocks)
      closeStreamingText(blocks)
      break

    case 'tool.called': {
      closeThinking(blocks)
      closeStreamingText(blocks)

      const toolCallId = String(event.payload.callId)
      const sourceRunId = String(event.payload.runId)
      const eventAppsMeta = isRecord((event.payload as Record<string, unknown>).appsMeta)
        ? extractAppsMetaFromPayload((event.payload as Record<string, unknown>).appsMeta)
        : undefined

      const existingCalledIndex = toolIndexById.get(toolCallId)
      const existingCalledBlock =
        existingCalledIndex != null ? blocks[existingCalledIndex] : undefined

      if (existingCalledBlock?.type === 'tool_interaction') {
        existingCalledBlock.args ??= event.payload.args
        existingCalledBlock.sourceRunId ??= sourceRunId
        if (eventAppsMeta && !existingCalledBlock.appsMeta) {
          existingCalledBlock.appsMeta = eventAppsMeta
        }
        break
      }

      const toolBlock: ToolInteractionBlock = {
        id: `tool:${toolCallId}`,
        type: 'tool_interaction',
        toolCallId: asToolCallId(toolCallId),
        name: event.payload.tool,
        args: event.payload.args,
        ...(eventAppsMeta ? { appsMeta: eventAppsMeta } : {}),
        sourceRunId,
        status: 'running',
        createdAt: event.createdAt,
      }

      toolIndexById.set(toolCallId, blocks.length)
      blocks.push(toolBlock)
      break
    }

    case 'tool.confirmation_requested': {
      closeThinking(blocks)
      closeStreamingText(blocks)

      const toolCallId = String(event.payload.callId)
      const existingIndex = toolIndexById.get(toolCallId)
      const nextBlock: ToolInteractionBlock = {
        args: event.payload.args,
        confirmation: {
          description: event.payload.description,
          ownerRunId: String(event.payload.runId),
          targetRef: event.payload.waitTargetRef,
          waitId: event.payload.waitId,
        },
        createdAt: event.createdAt,
        id: `tool:${toolCallId}`,
        name: event.payload.tool,
        sourceRunId: String(event.payload.runId),
        status: 'awaiting_confirmation',
        toolCallId: asToolCallId(toolCallId),
        type: 'tool_interaction',
      }

      if (existingIndex == null) {
        toolIndexById.set(toolCallId, blocks.length)
        blocks.push(nextBlock)
        break
      }

      const existingBlock = blocks[existingIndex]
      if (existingBlock?.type === 'tool_interaction') {
        existingBlock.args = event.payload.args
        existingBlock.confirmation = nextBlock.confirmation
        existingBlock.sourceRunId = nextBlock.sourceRunId
        existingBlock.status = 'awaiting_confirmation'
      }
      break
    }

    case 'tool.confirmation_granted': {
      const toolCallId = String(event.payload.callId)
      const existingIndex = toolIndexById.get(toolCallId)
      if (existingIndex == null) {
        break
      }

      const existingBlock = blocks[existingIndex]
      if (existingBlock?.type === 'tool_interaction') {
        const priorConfirmation = existingBlock.confirmation
        existingBlock.approval = {
          description: priorConfirmation?.description ?? null,
          remembered:
            typeof event.payload.remembered === 'boolean' ? event.payload.remembered : null,
          status: 'approved',
          targetRef: priorConfirmation?.targetRef ?? null,
          waitId: event.payload.waitId,
        }
        existingBlock.confirmation = undefined
        existingBlock.status = 'running'
      }
      break
    }

    case 'tool.confirmation_rejected': {
      const toolCallId = String(event.payload.callId)
      const existingIndex = toolIndexById.get(toolCallId)
      if (existingIndex == null) {
        break
      }

      const existingBlock = blocks[existingIndex]
      if (existingBlock?.type === 'tool_interaction') {
        const priorConfirmation = existingBlock.confirmation
        existingBlock.approval = {
          description: priorConfirmation?.description ?? null,
          remembered: null,
          status: 'rejected',
          targetRef: priorConfirmation?.targetRef ?? null,
          waitId: event.payload.waitId,
        }
        existingBlock.confirmation = undefined
        existingBlock.status = 'error'
      }
      break
    }

    case 'web_search.progress': {
      const searchBlockId = `web_search:${event.payload.searchId}`
      const existingIndex = blocks.findIndex(
        (block) => block.type === 'web_search' && block.searchId === event.payload.searchId,
      )

      if (existingIndex === -1) {
        closeThinking(blocks)
        closeStreamingText(blocks)
      }

      const nextBlock: WebSearchBlock = {
        createdAt: event.createdAt,
        ...(event.payload.status === 'completed' || event.payload.status === 'failed'
          ? { finishedAt: event.createdAt }
          : {}),
        id: searchBlockId,
        patterns: dedupeStrings(event.payload.patterns),
        provider: parseProviderName(event.payload.provider),
        queries: dedupeStrings(event.payload.queries),
        references: dedupeWebSearchReferences(event.payload.references),
        responseId: event.payload.responseId,
        searchId: event.payload.searchId,
        sourceRunId: String(event.payload.runId),
        status: event.payload.status,
        targetUrls: dedupeStrings(event.payload.targetUrls),
        type: 'web_search',
      }

      if (existingIndex === -1) {
        blocks.push(nextBlock)
        break
      }

      const existingBlock = blocks[existingIndex]
      if (existingBlock?.type === 'web_search') {
        existingBlock.patterns = dedupeStrings([...existingBlock.patterns, ...nextBlock.patterns])
        existingBlock.provider = nextBlock.provider
        existingBlock.queries = dedupeStrings([...existingBlock.queries, ...nextBlock.queries])
        existingBlock.references = dedupeWebSearchReferences([
          ...existingBlock.references,
          ...nextBlock.references,
        ])
        existingBlock.responseId = existingBlock.responseId ?? nextBlock.responseId
        existingBlock.status = mergeWebSearchStatus(existingBlock.status, nextBlock.status)
        existingBlock.targetUrls = dedupeStrings([
          ...existingBlock.targetUrls,
          ...nextBlock.targetUrls,
        ])
        existingBlock.finishedAt = nextBlock.finishedAt ?? existingBlock.finishedAt
      }
      break
    }

    case 'tool.completed': {
      const toolCallId = String(event.payload.callId)
      const eventAppsMeta = isRecord((event.payload as Record<string, unknown>).appsMeta)
        ? extractAppsMetaFromPayload((event.payload as Record<string, unknown>).appsMeta)
        : undefined
      const outcomeAppsMeta = extractAppsMetaFromOutcome(event.payload.outcome)
      const resolvedAppsMeta = eventAppsMeta ?? outcomeAppsMeta
      const existingIndex = toolIndexById.get(toolCallId)
      if (existingIndex == null) {
        blocks.push({
          id: `tool:${toolCallId}`,
          type: 'tool_interaction',
          toolCallId: asToolCallId(toolCallId),
          name: event.payload.tool,
          args: null,
          ...(resolvedAppsMeta ? { appsMeta: resolvedAppsMeta } : {}),
          sourceRunId: String(event.payload.runId),
          status: isFailedSandboxOutcome(event.payload.outcome) ? 'error' : 'complete',
          output: event.payload.outcome,
          finishedAt: event.createdAt,
          createdAt: event.createdAt,
        })
        break
      }

      const existingBlock = blocks[existingIndex]
      if (existingBlock?.type === 'tool_interaction') {
        existingBlock.confirmation = undefined
        existingBlock.status = isFailedSandboxOutcome(event.payload.outcome) ? 'error' : 'complete'
        existingBlock.output = event.payload.outcome
        existingBlock.finishedAt = event.createdAt
        if (resolvedAppsMeta && !existingBlock.appsMeta) {
          existingBlock.appsMeta = resolvedAppsMeta
        }
      }
      break
    }

    case 'tool.failed': {
      const toolCallId = String(event.payload.callId)
      const eventAppsMeta = isRecord((event.payload as Record<string, unknown>).appsMeta)
        ? extractAppsMetaFromPayload((event.payload as Record<string, unknown>).appsMeta)
        : undefined
      const existingIndex = toolIndexById.get(toolCallId)
      if (existingIndex == null) {
        blocks.push({
          id: `tool:${toolCallId}`,
          type: 'tool_interaction',
          toolCallId: asToolCallId(toolCallId),
          name: event.payload.tool,
          args: null,
          ...(eventAppsMeta ? { appsMeta: eventAppsMeta } : {}),
          sourceRunId: String(event.payload.runId),
          status: 'error',
          output: event.payload.error,
          finishedAt: event.createdAt,
          createdAt: event.createdAt,
        })
        break
      }

      const existingBlock = blocks[existingIndex]
      if (existingBlock?.type === 'tool_interaction') {
        existingBlock.confirmation = undefined
        existingBlock.status = 'error'
        existingBlock.output = event.payload.error
        existingBlock.finishedAt = event.createdAt
        if (eventAppsMeta && !existingBlock.appsMeta) {
          existingBlock.appsMeta = eventAppsMeta
        }
      }
      break
    }

    case 'tool.waiting': {
      const waitCallId = String(event.payload.callId)
      const waitTargetRunId = event.payload.waitTargetRunId
        ? String(event.payload.waitTargetRunId)
        : null
      if (waitTargetRunId) {
        const existingIndex = toolIndexById.get(waitCallId)
        if (existingIndex != null) {
          const existingBlock = blocks[existingIndex]
          if (existingBlock?.type === 'tool_interaction') {
            existingBlock.childRunId = waitTargetRunId
          }
        }
      }
      break
    }

    case 'wait.timed_out': {
      closeThinking(blocks)
      closeStreamingText(blocks)
      const timeoutMessage =
        typeof event.payload.error === 'string' && event.payload.error.trim().length > 0
          ? event.payload.error
          : 'Wait timed out'
      blocks.push({
        createdAt: event.createdAt,
        id: `error:wait_timed_out:${event.eventNo}`,
        message: timeoutMessage,
        sourceRunId: String(event.payload.runId),
        type: 'error',
      })
      break
    }

    // Parent-thread UI does not render child run summaries; backend still emits this for auditing.
    case 'child_run.completed':
      break

    // Operational recovery signal for projectors / workers, not user-visible chat content.
    case 'run.requeued':
      break

    case 'run.waiting':
      settleBlocksForRunTerminalState(blocks, {
        createdAt: event.createdAt,
        runId: String(event.payload.runId),
        status: 'waiting',
      })
      // Confirmation waits are materialized as tool blocks by ensurePendingWaitBlocks.
      // Non-confirmation waits are communicated by the message footer ("Waiting for a
      // pending tool result.") so we no longer push a redundant "Waiting" thinking block.
      break

    case 'run.failed':
      settleBlocksForRunTerminalState(blocks, {
        createdAt: event.createdAt,
        runId: String(event.payload.runId),
        status: 'failed',
      })
      blocks.push({
        id: `error:${event.eventNo}`,
        type: 'error',
        message:
          event.payload.error != null &&
          typeof event.payload.error === 'object' &&
          'message' in event.payload.error &&
          typeof (event.payload.error as { message: unknown }).message === 'string'
            ? (event.payload.error as { message: string }).message
            : 'Run failed',
        createdAt: event.createdAt,
        sourceRunId: String(event.payload.runId),
      })
      break

    case 'run.cancelled':
      settleBlocksForRunTerminalState(blocks, {
        createdAt: event.createdAt,
        runId: String(event.payload.runId),
        status: 'cancelled',
      })
      break

    case 'run.completed':
      settleBlocksForRunTerminalState(blocks, {
        createdAt: event.createdAt,
        runId: String(event.payload.runId),
        status: 'completed',
      })
      break
  }

  return true
}
