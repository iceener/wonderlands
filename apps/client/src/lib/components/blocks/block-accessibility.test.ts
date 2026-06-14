import { asArtifactId, asToolCallId, type Block } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import {
  getAdjacentExpandableIndex,
  getBlockAnnouncement,
  getBlockLiveMode,
  getBlockRenderErrorMessage,
  getExpandablePanelId,
  getExpandableToggleLabel,
} from './block-accessibility'

const at = '2026-03-29T10:00:00.000Z'

describe('block accessibility helpers', () => {
  test('builds stable panel ids and toggle labels for expandable blocks', () => {
    const thinkingBlock: Block = {
      id: 'thinking:block-1',
      type: 'thinking',
      title: 'reasoning',
      content: 'Working',
      status: 'thinking',
      createdAt: at,
    }
    const toolBlock: Block = {
      id: 'tool:block-1',
      type: 'tool_interaction',
      toolCallId: asToolCallId('call-1'),
      name: 'lookup_sales',
      args: {},
      status: 'running',
      createdAt: at,
    }
    const artifactBlock: Block = {
      id: 'artifact:block-1',
      type: 'artifact',
      artifactId: asArtifactId('artifact-1'),
      kind: 'markdown',
      title: 'Report',
      preview: '# Report',
      createdAt: at,
    }

    expect(getExpandablePanelId(thinkingBlock)).toBe('block-panel-thinking-block-1')
    expect(getExpandableToggleLabel(thinkingBlock, false)).toBe('Expand reasoning details')
    expect(getExpandableToggleLabel(toolBlock, true)).toBe('Collapse lookup_sales details')
    expect(getExpandableToggleLabel(artifactBlock, false)).toBe('Expand Report preview')
  })

  test('maps block types to scoped live-region modes and fallback messages', () => {
    const cases: Array<{
      block: Block
      announcement: string | null
      liveMode: ReturnType<typeof getBlockLiveMode>
      renderError: string
    }> = [
      {
        block: {
          id: 'text-1',
          type: 'text',
          content: 'hello',
          streaming: true,
          createdAt: at,
          renderState: {
            committedSegments: [],
            liveTail: 'hello',
            processedContent: 'hello',
            nextSegmentIndex: 0,
          },
        },
        announcement: null,
        liveMode: 'off',
        renderError: 'Failed to render a text block.',
      },
      {
        block: {
          id: 'thinking-1',
          type: 'thinking',
          title: 'reasoning',
          content: '',
          status: 'thinking',
          createdAt: at,
        },
        announcement: 'reasoning in progress.',
        liveMode: 'polite',
        renderError: 'Failed to render the reasoning block.',
      },
      {
        block: {
          id: 'tool-1',
          type: 'tool_interaction',
          toolCallId: asToolCallId('call-2'),
          name: 'lookup_sales',
          args: {},
          status: 'error',
          createdAt: at,
        },
        announcement: 'lookup_sales failed.',
        liveMode: 'assertive',
        renderError: 'Failed to render the lookup_sales tool block.',
      },
      {
        block: {
          id: 'artifact-1',
          type: 'artifact',
          artifactId: asArtifactId('artifact-2'),
          kind: 'markdown',
          title: 'Quarterly report',
          preview: '# Report',
          createdAt: at,
        },
        announcement: 'Artifact Quarterly report available.',
        liveMode: 'polite',
        renderError: 'Failed to render the Quarterly report artifact preview.',
      },
      {
        block: {
          id: 'error-1',
          type: 'error',
          message: 'Boom',
          createdAt: at,
        },
        announcement: 'Boom',
        liveMode: 'assertive',
        renderError: 'Failed to render an error block.',
      },
    ]

    for (const entry of cases) {
      expect(getBlockAnnouncement(entry.block)).toBe(entry.announcement)
      expect(getBlockLiveMode(entry.block)).toBe(entry.liveMode)
      expect(getBlockRenderErrorMessage(entry.block)).toBe(entry.renderError)
    }
  })

  test('computes adjacent expandable toggle indexes for arrow and edge keys', () => {
    expect(getAdjacentExpandableIndex(0, 3, 'ArrowDown')).toBe(1)
    expect(getAdjacentExpandableIndex(2, 3, 'ArrowDown')).toBe(0)
    expect(getAdjacentExpandableIndex(0, 3, 'ArrowUp')).toBe(2)
    expect(getAdjacentExpandableIndex(1, 3, 'ArrowLeft')).toBe(0)
    expect(getAdjacentExpandableIndex(1, 3, 'ArrowRight')).toBe(2)
    expect(getAdjacentExpandableIndex(1, 3, 'Home')).toBe(0)
    expect(getAdjacentExpandableIndex(1, 3, 'End')).toBe(2)
    expect(getAdjacentExpandableIndex(1, 3, 'Enter')).toBe(null)
    expect(getAdjacentExpandableIndex(-1, 3, 'ArrowDown')).toBe(null)
  })
})
