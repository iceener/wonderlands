import type { Block, TextBlock, ThinkingBlock } from '@wonderlands/contracts/chat'
import { rebuildIncrementalMarkdownView, syncIncrementalMarkdownView } from '../streaming-markdown'

export const findLatestOpenThinking = (blocks: Block[]): ThinkingBlock | null => {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block?.type === 'thinking' && block.status === 'thinking') {
      return block
    }
  }

  return null
}

export const updateTextRenderState = (block: TextBlock): void => {
  block.renderState = syncIncrementalMarkdownView(block.renderState, {
    blockId: block.id,
    content: block.content,
    streaming: block.streaming,
    allowCompaction: true,
  })
}

export const createTextBlock = (
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

export const closeStreamingText = (blocks: Block[]): void => {
  const lastBlock = blocks[blocks.length - 1]
  if (lastBlock?.type === 'text' && lastBlock.streaming) {
    lastBlock.streaming = false
    updateTextRenderState(lastBlock)
  }
}

export const closeThinking = (blocks: Block[]): void => {
  const thinkingBlock = findLatestOpenThinking(blocks)
  if (thinkingBlock) {
    thinkingBlock.status = 'done'
  }
}

export const upsertThinkingBlock = (
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
