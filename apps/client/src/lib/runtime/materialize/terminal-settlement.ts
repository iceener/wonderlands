import type { Block } from '@wonderlands/contracts/chat'
import { updateTextRenderState } from './block-text'

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
