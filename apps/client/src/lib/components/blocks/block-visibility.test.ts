import type { Block } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { buildVisibleBlocks } from './block-visibility'

const textBlock = (id: string, content: string): Block => ({
  content,
  createdAt: '2026-04-02T00:00:00.000Z',
  id,
  renderState: {
    committedSegments: [],
    liveTail: '',
    nextSegmentIndex: 0,
    processedContent: content,
  },
  streaming: true,
  type: 'text',
})

const toolBlock = (id: string, name: string): Block => ({
  args: null,
  createdAt: '2026-04-02T00:00:00.000Z',
  id,
  name,
  status: 'running',
  toolCallId: id,
  type: 'tool_interaction',
})

describe('buildVisibleBlocks', () => {
  test('keeps later non-text activity visible while the first unfinished text block is typing', () => {
    const blocks = [
      textBlock('text_1', 'Thinking aloud'),
      toolBlock('tool_1', 'delegate_to_agent'),
      toolBlock('tool_2', 'spotify__player_status'),
    ]

    expect(
      buildVisibleBlocks(blocks, {
        completedTextIds: new Set(),
        delegationChildIds: new Set(),
        gatingActive: true,
      }).map((block) => block.id),
    ).toEqual(['text_1', 'tool_1', 'tool_2'])
  })

  test('hides later unfinished text blocks until the current typed block completes', () => {
    const blocks = [
      textBlock('text_1', 'First'),
      toolBlock('tool_1', 'delegate_to_agent'),
      textBlock('text_2', 'Second'),
    ]

    expect(
      buildVisibleBlocks(blocks, {
        completedTextIds: new Set(),
        delegationChildIds: new Set(),
        gatingActive: true,
      }).map((block) => block.id),
    ).toEqual(['text_1', 'tool_1'])
  })

  test('returns all blocks when gating is disabled', () => {
    const blocks = [
      textBlock('text_1', 'First'),
      toolBlock('tool_1', 'delegate_to_agent'),
      textBlock('text_2', 'Second'),
    ]

    expect(
      buildVisibleBlocks(blocks, {
        completedTextIds: new Set(),
        delegationChildIds: new Set(),
        gatingActive: false,
      }).map((block) => block.id),
    ).toEqual(['text_1', 'tool_1', 'text_2'])
  })
})
