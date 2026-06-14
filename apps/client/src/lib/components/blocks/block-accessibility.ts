import type {
  ArtifactBlock,
  Block,
  ThinkingBlock,
  ToolInteractionBlock,
  WebSearchBlock,
} from '@wonderlands/contracts/chat'
import { getSuspendedToolLabel, isSuspendedToolBlock } from './tool-state'

export type ExpandableBlock = ThinkingBlock | ToolInteractionBlock | WebSearchBlock | ArtifactBlock

export const BLOCK_TOGGLE_SELECTOR = '[data-block-toggle="true"]'

const sanitizeDomId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '-')

const getExpandableBlockName = (block: ExpandableBlock): string => {
  switch (block.type) {
    case 'thinking':
      return 'reasoning details'
    case 'tool_interaction':
      return `${block.name} details`
    case 'web_search':
      return 'web search details'
    case 'artifact':
      return `${block.title} preview`
  }
}

export const getExpandablePanelId = (block: ExpandableBlock): string =>
  `block-panel-${sanitizeDomId(block.id)}`

export const getExpandableToggleLabel = (block: ExpandableBlock, expanded: boolean): string =>
  `${expanded ? 'Collapse' : 'Expand'} ${getExpandableBlockName(block)}`

export const getBlockLiveMode = (block: Block): 'off' | 'polite' | 'assertive' => {
  switch (block.type) {
    case 'text':
      return 'off'
    case 'thinking':
      return 'polite'
    case 'tool_interaction':
      return block.status === 'error' || block.approval?.status === 'rejected'
        ? 'assertive'
        : 'polite'
    case 'web_search':
      return block.status === 'failed' ? 'assertive' : 'polite'
    case 'artifact':
      return 'polite'
    case 'error':
      return 'assertive'
  }
}

export const getBlockAnnouncement = (block: Block): string | null => {
  switch (block.type) {
    case 'text':
      return null
    case 'thinking':
      return block.status === 'thinking'
        ? `${block.title} in progress.`
        : `${block.title} complete.`
    case 'tool_interaction':
      if (isSuspendedToolBlock(block)) {
        return `${block.name} ${getSuspendedToolLabel(block).toLowerCase()}.`
      }

      if (block.status === 'awaiting_confirmation') {
        return `${block.name} is waiting for confirmation.`
      }

      if (block.approval?.status === 'rejected') {
        return `${block.name} was rejected.`
      }

      if (block.approval?.status === 'approved' && block.status === 'complete') {
        return block.approval.remembered
          ? `${block.name} trusted and complete.`
          : `${block.name} approved once and complete.`
      }

      if (block.status === 'running') {
        return `${block.name} running.`
      }

      return block.status === 'error' ? `${block.name} failed.` : `${block.name} complete.`
    case 'web_search':
      if (block.status === 'in_progress' || block.status === 'searching') {
        return 'Web search in progress.'
      }

      return block.status === 'failed' ? 'Web search failed.' : 'Web search complete.'
    case 'artifact':
      return `Artifact ${block.title} available.`
    case 'error':
      return block.message
  }
}

export const getBlockRenderErrorMessage = (block: Block): string => {
  switch (block.type) {
    case 'text':
      return 'Failed to render a text block.'
    case 'thinking':
      return 'Failed to render the reasoning block.'
    case 'tool_interaction':
      return `Failed to render the ${block.name} tool block.`
    case 'web_search':
      return 'Failed to render the web search block.'
    case 'artifact':
      return `Failed to render the ${block.title} artifact preview.`
    case 'error':
      return 'Failed to render an error block.'
  }
}

export const getAdjacentExpandableIndex = (
  currentIndex: number,
  total: number,
  key: string,
): number | null => {
  if (currentIndex < 0 || currentIndex >= total || total <= 0) {
    return null
  }

  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return currentIndex === total - 1 ? 0 : currentIndex + 1
    case 'ArrowUp':
    case 'ArrowLeft':
      return currentIndex === 0 ? total - 1 : currentIndex - 1
    case 'Home':
      return 0
    case 'End':
      return total - 1
    default:
      return null
  }
}

export const focusAdjacentExpandableToggle = (
  currentTarget: HTMLButtonElement,
  key: string,
): boolean => {
  const root =
    currentTarget.closest<HTMLElement>('[data-block-toggle-root="true"]') ??
    currentTarget.ownerDocument

  const toggles = Array.from(
    root.querySelectorAll<HTMLButtonElement>(BLOCK_TOGGLE_SELECTOR),
  ).filter((toggle) => !toggle.disabled)
  const currentIndex = toggles.indexOf(currentTarget)
  const nextIndex = getAdjacentExpandableIndex(currentIndex, toggles.length, key)

  if (nextIndex == null) {
    return false
  }

  toggles[nextIndex]?.focus()
  return true
}
