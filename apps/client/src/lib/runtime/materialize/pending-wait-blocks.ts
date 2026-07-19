import type {
  BackendPendingWait,
  Block,
  ThinkingBlock,
  ToolInteractionBlock,
} from '@wonderlands/contracts/chat'
import { asToolCallId } from '@wonderlands/contracts/chat'

export const isConfirmationPendingWait = (wait: BackendPendingWait): boolean =>
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
