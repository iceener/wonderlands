import { describe, expect, test } from 'vitest'
import { resolveTextBlockCaretPlacement, shouldShowTextBlockCaret } from './text-block-caret'

describe('shouldShowTextBlockCaret', () => {
  test('keeps the caret visible while the text block is still streaming even after local typing catches up', () => {
    expect(
      shouldShowTextBlockCaret({
        blockStreaming: true,
        messageStatus: 'streaming',
        shouldAnimate: false,
      }),
    ).toBe(true)
  })

  test('shows the caret while the local typewriter is still animating', () => {
    expect(
      shouldShowTextBlockCaret({
        blockStreaming: false,
        messageStatus: 'complete',
        shouldAnimate: true,
      }),
    ).toBe(true)
    expect(
      shouldShowTextBlockCaret({
        blockStreaming: true,
        messageStatus: 'streaming',
        shouldAnimate: true,
      }),
    ).toBe(true)
  })

  test('hides the caret once the stream is no longer active', () => {
    expect(
      shouldShowTextBlockCaret({
        blockStreaming: false,
        messageStatus: 'streaming',
        shouldAnimate: false,
      }),
    ).toBe(false)
    expect(
      shouldShowTextBlockCaret({
        blockStreaming: true,
        messageStatus: 'complete',
        shouldAnimate: false,
      }),
    ).toBe(false)
  })
})

describe('resolveTextBlockCaretPlacement', () => {
  test('attaches the caret to the last committed markdown segment when it is the last visible content', () => {
    expect(
      resolveTextBlockCaretPlacement({
        blockStreaming: true,
        committedSegmentCount: 2,
        hasPartialMarkdown: false,
        hasVisibleLiveTail: false,
        messageStatus: 'streaming',
        shouldAnimate: false,
      }),
    ).toBe('committed_tail')
  })

  test('attaches the caret to partial markdown before later live-tail content exists', () => {
    expect(
      resolveTextBlockCaretPlacement({
        blockStreaming: true,
        committedSegmentCount: 1,
        hasPartialMarkdown: true,
        hasVisibleLiveTail: false,
        messageStatus: 'streaming',
        shouldAnimate: false,
      }),
    ).toBe('partial_markdown')
  })

  test('attaches the caret to the live tail when that is the last visible content', () => {
    expect(
      resolveTextBlockCaretPlacement({
        blockStreaming: true,
        committedSegmentCount: 1,
        hasPartialMarkdown: false,
        hasVisibleLiveTail: true,
        messageStatus: 'streaming',
        shouldAnimate: false,
      }),
    ).toBe('live_tail')
  })

  test('falls back to a standalone caret when the stream is active but no text is visible yet', () => {
    expect(
      resolveTextBlockCaretPlacement({
        blockStreaming: true,
        committedSegmentCount: 0,
        hasPartialMarkdown: false,
        hasVisibleLiveTail: false,
        messageStatus: 'streaming',
        shouldAnimate: false,
      }),
    ).toBe('standalone')
  })

  test('hides the caret once the stream and animation are both inactive', () => {
    expect(
      resolveTextBlockCaretPlacement({
        blockStreaming: false,
        committedSegmentCount: 2,
        hasPartialMarkdown: false,
        hasVisibleLiveTail: false,
        messageStatus: 'complete',
        shouldAnimate: false,
      }),
    ).toBe('hidden')
  })
})
