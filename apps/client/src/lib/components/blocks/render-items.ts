import type { Block, MessageStatus, ToolInteractionBlock } from '@wonderlands/contracts/chat'

/** Any completed non-text block that can be collapsed into a chain. */
export type ChainableBlock = Block & { type: 'tool_interaction' | 'thinking' | 'web_search' }

export type RenderItem =
  | { kind: 'block'; block: Block; id: string }
  | { kind: 'chain'; blocks: ChainableBlock[]; id: string }
  | { kind: 'tool_group'; blocks: ToolInteractionBlock[]; id: string }
  | { kind: 'delegation'; parent: ToolInteractionBlock; children: Block[]; id: string }

export interface BuildBlockRenderItemsOptions {
  groupingEnabled?: boolean
}

const TOOL_GROUP_MIN_CONSECUTIVE_CALLS = 3

const isDelegationParentBlock = (block: Block): block is ToolInteractionBlock =>
  block.type === 'tool_interaction' &&
  block.name === 'delegate_to_agent' &&
  Boolean(block.childRunId)

const isCompleteToolBlock = (block: Block): block is ToolInteractionBlock =>
  block.type === 'tool_interaction' && block.status === 'complete'

const isChainableBlock = (block: Block): block is ChainableBlock =>
  isCompleteToolBlock(block) ||
  (block.type === 'thinking' && block.status === 'done') ||
  (block.type === 'web_search' && (block.status === 'completed' || block.status === 'failed'))

const buildToolGroupedItems = (blocks: Block[]): RenderItem[] => {
  const items: RenderItem[] = []
  let index = 0

  while (index < blocks.length) {
    const block = blocks[index]

    if (isCompleteToolBlock(block)) {
      const groupedBlocks: ToolInteractionBlock[] = [block]
      let nextIndex = index + 1

      while (nextIndex < blocks.length) {
        const nextBlock = blocks[nextIndex]

        if (!isCompleteToolBlock(nextBlock) || nextBlock.name !== block.name) {
          break
        }

        groupedBlocks.push(nextBlock)
        nextIndex += 1
      }

      if (groupedBlocks.length >= TOOL_GROUP_MIN_CONSECUTIVE_CALLS) {
        items.push({
          kind: 'tool_group',
          blocks: groupedBlocks,
          id: `tool-group-${groupedBlocks[0].id}`,
        })
        index = nextIndex
        continue
      }
    }

    items.push({ kind: 'block', block, id: block.id })
    index += 1
  }

  return items
}

const buildDelegationGroups = (
  blocks: Block[],
): {
  childrenByParentId: Map<string, Block[]>
  allChildBlockIds: Set<string>
} => {
  const childRunToParent = new Map<string, string>()
  for (const block of blocks) {
    if (isDelegationParentBlock(block) && block.childRunId) {
      childRunToParent.set(block.childRunId, block.id)
    }
  }

  const childrenByParentId = new Map<string, Block[]>()
  const allChildBlockIds = new Set<string>()
  if (childRunToParent.size === 0) {
    return { childrenByParentId, allChildBlockIds }
  }

  for (const block of blocks) {
    const sourceRunId = block.sourceRunId
    if (!sourceRunId) {
      continue
    }

    const parentId = childRunToParent.get(sourceRunId)
    if (!parentId || block.id === parentId) {
      continue
    }

    allChildBlockIds.add(block.id)

    // Skip child text blocks from rendered children — the delegation summary already shows the output.
    if (block.type === 'text') {
      continue
    }

    const children = childrenByParentId.get(parentId) ?? []
    children.push(block)
    childrenByParentId.set(parentId, children)
  }

  return { childrenByParentId, allChildBlockIds }
}

const buildChainItems = (inputItems: RenderItem[]): RenderItem[] => {
  const toChainableBlock = (item: RenderItem): ChainableBlock | null =>
    item.kind === 'block' && isChainableBlock(item.block) ? item.block : null

  const items: RenderItem[] = []
  let index = 0

  while (index < inputItems.length) {
    const block = toChainableBlock(inputItems[index]!)
    if (block) {
      const chain: ChainableBlock[] = [block]
      let nextIndex = index + 1

      while (nextIndex < inputItems.length) {
        const nextBlock = toChainableBlock(inputItems[nextIndex]!)
        if (!nextBlock) {
          break
        }

        chain.push(nextBlock)
        nextIndex += 1
      }

      if (chain.length >= 3) {
        items.push({ kind: 'chain', blocks: chain, id: `chain-${chain[0].id}` })
        index = nextIndex
        continue
      }
    }

    items.push(inputItems[index]!)
    index += 1
  }

  return items
}

const buildLinearItems = (blocks: Block[], groupingEnabled: boolean): RenderItem[] => {
  if (!groupingEnabled) {
    return blocks.map((block) => ({ kind: 'block', block, id: block.id }))
  }

  return buildChainItems(buildToolGroupedItems(blocks))
}

const resolveGroupingEnabled = (
  input: BuildBlockRenderItemsOptions | MessageStatus | undefined,
): boolean => {
  if (typeof input === 'string') {
    return input !== 'streaming'
  }

  return input?.groupingEnabled ?? true
}

export const buildBlockRenderItems = (
  blocks: Block[],
  optionsOrStatus: BuildBlockRenderItemsOptions | MessageStatus = 'complete',
): RenderItem[] => {
  const groupingEnabled = resolveGroupingEnabled(optionsOrStatus)
  const hasDelegations = blocks.some((block) => isDelegationParentBlock(block))

  if (!hasDelegations) {
    return buildLinearItems(blocks, groupingEnabled)
  }

  const { childrenByParentId, allChildBlockIds } = buildDelegationGroups(blocks)
  const collectDescendants = (parentId: string): Block[] => {
    const directChildren = childrenByParentId.get(parentId) ?? []
    const descendants: Block[] = []
    for (const child of directChildren) {
      descendants.push(child)
      if (isDelegationParentBlock(child)) {
        descendants.push(...collectDescendants(child.id))
      }
    }
    return descendants
  }

  const topLevelBlocks = blocks.filter((block) => !allChildBlockIds.has(block.id))
  const items: RenderItem[] = []
  let linearBlocks: Block[] = []

  const flushLinearBlocks = () => {
    if (linearBlocks.length === 0) {
      return
    }

    items.push(...buildLinearItems(linearBlocks, groupingEnabled))
    linearBlocks = []
  }

  for (const block of topLevelBlocks) {
    if (isDelegationParentBlock(block)) {
      flushLinearBlocks()
      items.push({
        kind: 'delegation',
        parent: block,
        children: collectDescendants(block.id),
        id: `deleg-${block.id}`,
      })
      continue
    }

    linearBlocks.push(block)
  }

  flushLinearBlocks()
  return items
}
