import type { Block } from '@wonderlands/contracts/chat'

export const buildVisibleBlocks = (
  blocks: readonly Block[],
  input: {
    completedTextIds: ReadonlySet<string>
    delegationChildIds: ReadonlySet<string>
    gatingActive: boolean
  },
): Block[] => {
  if (!input.gatingActive) {
    return [...blocks]
  }

  const visible: Block[] = []
  let revealedActiveTextBlock = false

  for (const block of blocks) {
    if (block.type !== 'text' || input.delegationChildIds.has(block.id)) {
      visible.push(block)
      continue
    }

    if (input.completedTextIds.has(block.id)) {
      visible.push(block)
      continue
    }

    if (!revealedActiveTextBlock) {
      visible.push(block)
      revealedActiveTextBlock = true
    }
  }

  return visible
}
