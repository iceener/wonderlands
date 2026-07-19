import type {
  BackendEvent,
  Block,
  ToolInteractionBlock,
  WebSearchBlock,
  WebSearchReference,
} from '@wonderlands/contracts/chat'
import { asToolCallId } from '@wonderlands/contracts/chat'
import {
  closeStreamingText,
  closeThinking,
  createTextBlock,
  updateTextRenderState,
  upsertThinkingBlock,
} from './materialize/block-text'
import { isRecord, parseProviderName } from './materialize/shared'
import { settleBlocksForRunTerminalState } from './materialize/terminal-settlement'

export {
  materializePendingWaitBlocks,
  mergePendingWaitBlocks,
} from './materialize/pending-wait-blocks'
export { materializePersistedAssistantBlocks } from './materialize/persisted-blocks'
export { settleBlocksForRunTerminalState } from './materialize/terminal-settlement'

const isFailedSandboxOutcome = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.sandboxExecutionId === 'string' &&
  (value.status === 'failed' || value.status === 'cancelled')

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
