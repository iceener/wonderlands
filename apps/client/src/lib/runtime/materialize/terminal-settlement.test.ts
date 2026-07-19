import type {
  Block,
  TextBlock,
  ThinkingBlock,
  ToolInteractionBlock,
  WebSearchBlock,
} from '@wonderlands/contracts/chat'
import { asToolCallId } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { rebuildIncrementalMarkdownView } from '../streaming-markdown'
import { settleBlocksForRunTerminalState } from './terminal-settlement'

const at = '2026-03-29T12:00:00.000Z'

const toolBlock = (overrides: Partial<ToolInteractionBlock> = {}): ToolInteractionBlock => ({
  args: null,
  createdAt: at,
  id: 'tool:call_1',
  name: 'weather.lookup',
  status: 'running',
  toolCallId: asToolCallId('call_1'),
  type: 'tool_interaction',
  ...overrides,
})

const webSearchBlock = (overrides: Partial<WebSearchBlock> = {}): WebSearchBlock => ({
  createdAt: at,
  id: 'web_search:s1',
  patterns: [],
  provider: 'openai',
  queries: [],
  references: [],
  responseId: null,
  searchId: 's1',
  status: 'in_progress',
  targetUrls: [],
  type: 'web_search',
  ...overrides,
})

const thinkingBlock = (overrides: Partial<ThinkingBlock> = {}): ThinkingBlock => ({
  content: 'thinking...',
  createdAt: at,
  id: 'thinking:1',
  status: 'thinking',
  title: 'reasoning',
  type: 'thinking',
  ...overrides,
})

const textBlock = (overrides: Partial<TextBlock> = {}): TextBlock => ({
  content: 'hello',
  createdAt: at,
  id: 'text:1',
  renderState: rebuildIncrementalMarkdownView({
    blockId: 'text:1',
    content: 'hello',
    streaming: true,
  }),
  streaming: true,
  type: 'text',
  ...overrides,
})

describe('settleBlocksForRunTerminalState', () => {
  test('marks running tool blocks as complete on a completed run', () => {
    const blocks: Block[] = [toolBlock()]

    settleBlocksForRunTerminalState(blocks, { createdAt: at, runId: null, status: 'completed' })

    expect(blocks[0]).toMatchObject({ status: 'complete', confirmation: undefined })
    expect((blocks[0] as ToolInteractionBlock).finishedAt).toBe(at)
  })

  test('marks running tool blocks as error on a failed or cancelled run', () => {
    const failed: Block[] = [toolBlock()]
    settleBlocksForRunTerminalState(failed, { createdAt: at, runId: null, status: 'failed' })
    expect(failed[0]).toMatchObject({ status: 'error' })

    const cancelled: Block[] = [toolBlock({ status: 'awaiting_confirmation' })]
    settleBlocksForRunTerminalState(cancelled, { createdAt: at, runId: null, status: 'cancelled' })
    expect(cancelled[0]).toMatchObject({ status: 'error' })
  })

  test('does not settle tool or web_search blocks when the run status is waiting', () => {
    const blocks: Block[] = [toolBlock(), webSearchBlock()]

    settleBlocksForRunTerminalState(blocks, { createdAt: at, runId: null, status: 'waiting' })

    expect(blocks[0]).toMatchObject({ status: 'running' })
    expect(blocks[1]).toMatchObject({ status: 'in_progress' })
  })

  test('settles in-progress and searching web_search blocks based on run status', () => {
    const blocks: Block[] = [
      webSearchBlock({ id: 'web_search:s1', status: 'in_progress' }),
      webSearchBlock({ id: 'web_search:s2', searchId: 's2', status: 'searching' }),
    ]

    settleBlocksForRunTerminalState(blocks, { createdAt: at, runId: null, status: 'completed' })

    expect(blocks[0]).toMatchObject({ status: 'completed', finishedAt: at })
    expect(blocks[1]).toMatchObject({ status: 'completed', finishedAt: at })
  })

  test('closes open thinking blocks and streaming text blocks regardless of tool/search status ranks', () => {
    const blocks: Block[] = [thinkingBlock(), textBlock()]

    settleBlocksForRunTerminalState(blocks, { createdAt: at, runId: null, status: 'waiting' })

    expect(blocks[0]).toMatchObject({ status: 'done' })
    expect((blocks[1] as TextBlock).streaming).toBe(false)
  })

  test('preserves an already-set finishedAt instead of overwriting it', () => {
    const blocks: Block[] = [toolBlock({ finishedAt: '2020-01-01T00:00:00.000Z' })]

    settleBlocksForRunTerminalState(blocks, { createdAt: at, runId: null, status: 'completed' })

    expect((blocks[0] as ToolInteractionBlock).finishedAt).toBe('2020-01-01T00:00:00.000Z')
  })

  test('only settles blocks whose sourceRunId matches the terminal run when runId is provided', () => {
    const blocks: Block[] = [
      toolBlock({ id: 'tool:owned', sourceRunId: 'run_1', toolCallId: asToolCallId('owned') }),
      toolBlock({ id: 'tool:foreign', sourceRunId: 'run_2', toolCallId: asToolCallId('foreign') }),
      toolBlock({ id: 'tool:untagged', toolCallId: asToolCallId('untagged') }),
    ]

    settleBlocksForRunTerminalState(blocks, { createdAt: at, runId: 'run_1', status: 'completed' })

    expect(blocks[0]).toMatchObject({ status: 'complete' })
    expect(blocks[1]).toMatchObject({ status: 'running' })
    expect(blocks[2]).toMatchObject({ status: 'complete' })
  })
})
