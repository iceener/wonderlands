import type { MessageStatus } from '@wonderlands/contracts/chat'

export const shouldShowTextBlockCaret = (input: {
  blockStreaming: boolean
  messageStatus: MessageStatus
  shouldAnimate: boolean
}): boolean => input.shouldAnimate || (input.messageStatus === 'streaming' && input.blockStreaming)

export type TextBlockCaretPlacement =
  | 'committed_tail'
  | 'hidden'
  | 'live_tail'
  | 'partial_markdown'
  | 'standalone'

export const resolveTextBlockCaretPlacement = (input: {
  blockStreaming: boolean
  committedSegmentCount: number
  hasPartialMarkdown: boolean
  hasVisibleLiveTail: boolean
  messageStatus: MessageStatus
  shouldAnimate: boolean
}): TextBlockCaretPlacement => {
  if (!shouldShowTextBlockCaret(input)) {
    return 'hidden'
  }

  if (input.hasPartialMarkdown) {
    return 'partial_markdown'
  }

  if (input.hasVisibleLiveTail) {
    return 'live_tail'
  }

  if (input.committedSegmentCount > 0) {
    return 'committed_tail'
  }

  return 'standalone'
}
