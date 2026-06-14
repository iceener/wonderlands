import { describe, expect, test } from 'vitest'
import {
  createIncrementalMarkdownView,
  rebuildIncrementalMarkdownView,
  syncIncrementalMarkdownView,
} from './streaming-markdown'

const blockId = 'text:block-1'

describe('syncIncrementalMarkdownView', () => {
  test('appends deltas onto the live tail without rebuilding committed segments', () => {
    const initial = rebuildIncrementalMarkdownView({
      blockId,
      content: 'Alpha\n\nBeta',
      streaming: true,
    })

    const next = syncIncrementalMarkdownView(initial, {
      blockId,
      content: 'Alpha\n\nBeta gamma',
      streaming: true,
      allowCompaction: true,
    })

    expect(next.committedSegments).toEqual([
      { id: `${blockId}:segment:0`, source: 'Alpha' },
      { id: `${blockId}:segment:1`, source: '\n\n' },
    ])
    expect(next.liveTail).toBe('Beta gamma')
    expect(next.processedContent).toBe('Alpha\n\nBeta gamma')
    expect(next.nextSegmentIndex).toBe(2)
    expect(next.compactionDeferred).toBe(false)
  })

  test('rebuilds from scratch when the next content shrinks', () => {
    const initial = rebuildIncrementalMarkdownView({
      blockId,
      content: 'Alpha\n\nBeta gamma',
      streaming: true,
    })

    const next = syncIncrementalMarkdownView(initial, {
      blockId,
      content: 'Alpha',
      streaming: true,
      allowCompaction: true,
    })

    expect(next).toEqual({
      committedSegments: [],
      liveTail: 'Alpha',
      processedContent: 'Alpha',
      nextSegmentIndex: 0,
      compactionDeferred: false,
    })
  })

  test('defers compaction when finalized sources appear before they are allowed', () => {
    const next = syncIncrementalMarkdownView(createIncrementalMarkdownView(), {
      blockId,
      content: 'Alpha\n\nBeta',
      streaming: true,
      allowCompaction: false,
    })

    expect(next.committedSegments).toEqual([])
    expect(next.liveTail).toBe('Alpha\n\nBeta')
    expect(next.processedContent).toBe('Alpha\n\nBeta')
    expect(next.nextSegmentIndex).toBe(0)
    expect(next.compactionDeferred).toBe(true)
  })

  test('compacts deferred finalized blocks on a later allowed pass', () => {
    const deferred = syncIncrementalMarkdownView(createIncrementalMarkdownView(), {
      blockId,
      content: 'Alpha\n\nBeta',
      streaming: true,
      allowCompaction: false,
    })

    const next = syncIncrementalMarkdownView(deferred, {
      blockId,
      content: 'Alpha\n\nBeta',
      streaming: true,
      allowCompaction: true,
    })

    expect(next.committedSegments).toEqual([
      { id: `${blockId}:segment:0`, source: 'Alpha' },
      { id: `${blockId}:segment:1`, source: '\n\n' },
    ])
    expect(next.liveTail).toBe('Beta')
    expect(next.processedContent).toBe('Alpha\n\nBeta')
    expect(next.nextSegmentIndex).toBe(2)
    expect(next.compactionDeferred).toBe(false)
  })

  test('keeps streaming list tails intact so nested lists do not lose parent context', () => {
    const content = [
      'Nested example:',
      '',
      '- Parent item',
      '  - Child item A',
      '  - Child item B',
      '- Another parent item',
    ].join('\n')

    let state = createIncrementalMarkdownView()

    for (let index = 1; index <= content.length; index += 1) {
      state = syncIncrementalMarkdownView(state, {
        blockId,
        content: content.slice(0, index),
        streaming: true,
        allowCompaction: true,
      })
    }

    expect(state.committedSegments).toEqual([
      { id: `${blockId}:segment:0`, source: 'Nested example:' },
      { id: `${blockId}:segment:1`, source: '\n\n' },
    ])
    expect(state.liveTail).toBe(
      '- Parent item\n  - Child item A\n  - Child item B\n- Another parent item',
    )

    const complete = syncIncrementalMarkdownView(state, {
      blockId,
      content,
      streaming: false,
      allowCompaction: true,
    })

    expect(complete.committedSegments).toEqual([
      { id: `${blockId}:segment:0`, source: 'Nested example:' },
      { id: `${blockId}:segment:1`, source: '\n\n' },
      {
        id: `${blockId}:segment:2`,
        source: '- Parent item\n  - Child item A\n  - Child item B\n- Another parent item',
      },
    ])
    expect(complete.liveTail).toBe('')
  })
})
