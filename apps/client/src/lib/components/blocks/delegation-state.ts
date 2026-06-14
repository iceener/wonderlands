import type { Block, ToolInteractionBlock } from '@wonderlands/contracts/chat'

export type DelegationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'awaiting'
  | 'suspended'
export type WaitingFooterStateKind = 'reply' | 'suspended' | 'pending'

export interface WaitingFooterState {
  kind: WaitingFooterStateKind
  label: string
}

type SuspendedWait = {
  targetKind?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readSuspendedWaits = (value: unknown): SuspendedWait[] => {
  if (!isRecord(value) || value.kind !== 'suspended' || !Array.isArray(value.waits)) {
    return []
  }

  return value.waits.filter((wait): wait is SuspendedWait => isRecord(wait))
}

const readSuspendTargetKind = (block: ToolInteractionBlock): string | null => {
  const argTargetKind =
    isRecord(block.args) && typeof block.args.targetKind === 'string' ? block.args.targetKind : null

  if (argTargetKind) {
    return argTargetKind
  }

  const outputTargetKind = readSuspendedWaits(block.output)[0]?.targetKind
  return typeof outputTargetKind === 'string' ? outputTargetKind : null
}

const isDelegationWithSuspendedOutput = (block: ToolInteractionBlock): boolean =>
  readSuspendedWaits(block.output).length > 0

export const isReplyWaitBlock = (block: Block): boolean => {
  if (block.type === 'thinking') {
    return block.title === 'Waiting for reply'
  }

  if (block.type !== 'tool_interaction') {
    return false
  }

  if (block.name === 'delegate_to_agent') {
    return readSuspendedWaits(block.output).some((wait) => wait.targetKind === 'human_response')
  }

  if (block.name !== 'suspend_run' || block.status === 'error') {
    return false
  }

  const targetKind = readSuspendTargetKind(block)
  return targetKind == null || targetKind === 'human_response'
}

export const isSuspendedBlock = (block: Block): boolean => {
  if (isReplyWaitBlock(block)) {
    return true
  }

  if (block.type === 'thinking') {
    return block.title === 'Waiting'
  }

  if (block.type !== 'tool_interaction') {
    return false
  }

  if (block.name === 'delegate_to_agent') {
    return isDelegationWithSuspendedOutput(block)
  }

  return block.name === 'suspend_run' && block.status !== 'error'
}

export const isActiveDelegationParentBlock = (block: Block): block is ToolInteractionBlock =>
  block.type === 'tool_interaction' &&
  block.name === 'delegate_to_agent' &&
  (block.status === 'running' || isDelegationWithSuspendedOutput(block) || !block.finishedAt)

export const getDelegationStatus = (
  parent: ToolInteractionBlock,
  children: Block[],
): DelegationStatus => {
  if (parent.status === 'error') {
    return 'failed'
  }

  if (isSuspendedBlock(parent) || children.some((child) => isSuspendedBlock(child))) {
    return 'suspended'
  }

  const hasAwaitingConfirmation = children.some(
    (child) => child.type === 'tool_interaction' && child.status === 'awaiting_confirmation',
  )
  if (hasAwaitingConfirmation) {
    return 'awaiting'
  }

  if (parent.status !== 'complete' && children.length === 0) {
    return 'pending'
  }

  if (parent.status === 'complete') {
    return 'completed'
  }

  return 'running'
}

const dedupeAgentAliases = (aliases: string[]): string[] => {
  const seen = new Set<string>()
  const deduped: string[] = []

  for (const alias of aliases) {
    if (alias.length === 0 || seen.has(alias)) {
      continue
    }

    seen.add(alias)
    deduped.push(alias)
  }

  return deduped
}

const resolveAgentAliasForBlock = (block: ToolInteractionBlock): string =>
  typeof block.args?.agentAlias === 'string' ? block.args.agentAlias.trim() : ''

const hasChildAwaitingConfirmation = (blocks: Block[]): boolean =>
  blocks.some(
    (block) =>
      block.type === 'tool_interaction' &&
      block.status === 'awaiting_confirmation' &&
      block.name !== 'delegate_to_agent',
  )

const findAgentsWithPendingConfirmation = (blocks: Block[]): string[] => {
  const agents: string[] = []

  for (const block of blocks) {
    if (!isActiveDelegationParentBlock(block) || !block.childRunId) {
      continue
    }

    const hasConfirmationChild = blocks.some(
      (child) =>
        child.type === 'tool_interaction' &&
        child.status === 'awaiting_confirmation' &&
        child.sourceRunId === block.childRunId,
    )

    if (hasConfirmationChild) {
      const alias = resolveAgentAliasForBlock(block)
      if (alias.length > 0) {
        agents.push(alias)
      }
    }
  }

  return dedupeAgentAliases(agents)
}

export const getWaitingFooterState = (blocks: Block[]): WaitingFooterState => {
  const activeAgents = dedupeAgentAliases(
    blocks
      .filter((block) => isActiveDelegationParentBlock(block))
      .map((block) => resolveAgentAliasForBlock(block)),
  )

  if (blocks.some((block) => isReplyWaitBlock(block))) {
    return {
      kind: 'reply',
      label:
        activeAgents.length > 0
          ? `Waiting for your reply before ${activeAgents.join(', ')} can continue.`
          : 'Waiting for your reply.',
    }
  }

  if (blocks.some((block) => isSuspendedBlock(block))) {
    return {
      kind: 'suspended',
      label:
        activeAgents.length > 0
          ? `Waiting for ${activeAgents.join(', ')} to resume.`
          : 'Waiting for delegated work to resume.',
    }
  }

  if (hasChildAwaitingConfirmation(blocks)) {
    const agentsNeedingApproval = findAgentsWithPendingConfirmation(blocks)

    return {
      kind: 'pending',
      label:
        agentsNeedingApproval.length > 0
          ? `Waiting for your approval on ${agentsNeedingApproval.join(', ')}.`
          : 'Waiting for your approval.',
    }
  }

  return {
    kind: 'pending',
    label:
      activeAgents.length > 0
        ? `Waiting for ${activeAgents.join(', ')} to finish.`
        : 'Waiting for a pending tool result.',
  }
}

export const getWaitingFooterLabel = (blocks: Block[]): string =>
  getWaitingFooterState(blocks).label
