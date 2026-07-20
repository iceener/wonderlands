import type { Block } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { buildVisibleBlocks } from './block-visibility'

const textBlock = (id: string): Block => ({
  content: id,
  createdAt: '2026-04-02T00:00:00.000Z',
  id,
  renderState: {
    committedSegments: [],
    liveTail: '',
    nextSegmentIndex: 0,
    processedContent: id,
  },
  streaming: true,
  type: 'text',
})

const toolBlock = (id: string): Block => ({
  args: null,
  createdAt: '2026-04-02T00:00:00.000Z',
  id,
  name: 'delegate_to_agent',
  status: 'running',
  toolCallId: id,
  type: 'tool_interaction',
})

describe('buildVisibleBlocks', () => {
  test('gates later text while preserving interleaved activity', () => {
    const blocks = [textBlock('text_1'), toolBlock('tool_1'), textBlock('text_2')]
    const visibleIds = (gatingActive: boolean) =>
      buildVisibleBlocks(blocks, {
        completedTextIds: new Set(),
        delegationChildIds: new Set(),
        gatingActive,
      }).map((block) => block.id)

    expect(visibleIds(true)).toEqual(['text_1', 'tool_1'])
    expect(visibleIds(false)).toEqual(['text_1', 'tool_1', 'text_2'])

    const activityOnlyTail = [textBlock('text_1'), toolBlock('tool_1'), toolBlock('tool_2')]
    expect(
      buildVisibleBlocks(activityOnlyTail, {
        completedTextIds: new Set(),
        delegationChildIds: new Set(),
        gatingActive: true,
      }).map((block) => block.id),
    ).toEqual(['text_1', 'tool_1', 'tool_2'])
  })
})
