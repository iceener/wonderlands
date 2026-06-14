import { asToolCallId, type Block } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { buildBlockRenderItems } from './render-items'

const at = '2026-03-31T08:00:00.000Z'

describe('buildBlockRenderItems', () => {
  test('keeps repeated completed tools flat when grouping is explicitly disabled', () => {
    const blocks: Block[] = [
      {
        args: { path: 'nicolas-cage/face-off.md' },
        createdAt: at,
        finishedAt: at,
        id: 'tool:write-1',
        name: 'files__fs_write',
        output: { bytes: 342 },
        status: 'complete',
        toolCallId: asToolCallId('call_write_1'),
        type: 'tool_interaction',
      },
      {
        args: { path: 'nicolas-cage/leaving-las-vegas.md' },
        createdAt: at,
        finishedAt: at,
        id: 'tool:write-2',
        name: 'files__fs_write',
        output: { bytes: 418 },
        status: 'complete',
        toolCallId: asToolCallId('call_write_2'),
        type: 'tool_interaction',
      },
      {
        args: { path: 'nicolas-cage/raising-arizona.md' },
        createdAt: at,
        finishedAt: at,
        id: 'tool:write-3',
        name: 'files__fs_write',
        output: { bytes: 385 },
        status: 'complete',
        toolCallId: asToolCallId('call_write_3'),
        type: 'tool_interaction',
      },
    ]

    const items = buildBlockRenderItems(blocks, { groupingEnabled: false })

    expect(items).toHaveLength(3)
    expect(items.map((item) => item.kind)).toEqual(['block', 'block', 'block'])
    expect(items.map((item) => (item.kind === 'block' ? item.block.id : item.id))).toEqual([
      'tool:write-1',
      'tool:write-2',
      'tool:write-3',
    ])
  })

  test('groups repeated completed tools before chaining', () => {
    const blocks: Block[] = [
      {
        args: { path: 'nicolas-cage/' },
        createdAt: at,
        finishedAt: at,
        id: 'tool:read',
        name: 'files__fs_read',
        output: { files: ['face-off.md'] },
        status: 'complete',
        toolCallId: asToolCallId('call_read'),
        type: 'tool_interaction',
      },
      {
        args: { action: 'mkdir', path: 'nicolas-cage/' },
        createdAt: at,
        finishedAt: at,
        id: 'tool:manage',
        name: 'files__fs_manage',
        output: { ok: true },
        status: 'complete',
        toolCallId: asToolCallId('call_manage'),
        type: 'tool_interaction',
      },
      {
        args: { path: 'nicolas-cage/face-off.md' },
        createdAt: at,
        finishedAt: at,
        id: 'tool:write-1',
        name: 'files__fs_write',
        output: { bytes: 342 },
        status: 'complete',
        toolCallId: asToolCallId('call_write_1'),
        type: 'tool_interaction',
      },
      {
        args: { path: 'nicolas-cage/leaving-las-vegas.md' },
        createdAt: at,
        finishedAt: at,
        id: 'tool:write-2',
        name: 'files__fs_write',
        output: { bytes: 418 },
        status: 'complete',
        toolCallId: asToolCallId('call_write_2'),
        type: 'tool_interaction',
      },
      {
        args: { path: 'nicolas-cage/raising-arizona.md' },
        createdAt: at,
        finishedAt: at,
        id: 'tool:write-3',
        name: 'files__fs_write',
        output: { bytes: 385 },
        status: 'complete',
        toolCallId: asToolCallId('call_write_3'),
        type: 'tool_interaction',
      },
    ]

    const items = buildBlockRenderItems(blocks, 'complete')

    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      kind: 'block',
      block: { id: 'tool:read', name: 'files__fs_read' },
    })
    expect(items[1]).toMatchObject({
      kind: 'block',
      block: { id: 'tool:manage', name: 'files__fs_manage' },
    })
    expect(items[2]).toMatchObject({
      kind: 'tool_group',
      blocks: [
        { id: 'tool:write-1', name: 'files__fs_write' },
        { id: 'tool:write-2', name: 'files__fs_write' },
        { id: 'tool:write-3', name: 'files__fs_write' },
      ],
    })
  })

  test('keeps mixed completed activity in a chain when no tool group applies', () => {
    const blocks: Block[] = [
      {
        content: 'Checking what to do next.',
        createdAt: at,
        id: 'thinking:1',
        status: 'done',
        title: 'reasoning',
        type: 'thinking',
      },
      {
        args: { query: 'AI safety' },
        createdAt: at,
        finishedAt: at,
        id: 'tool:web-search',
        name: 'web_search',
        output: { results: 5 },
        status: 'complete',
        toolCallId: asToolCallId('call_web_search'),
        type: 'tool_interaction',
      },
      {
        createdAt: at,
        finishedAt: at,
        id: 'web_search:1',
        patterns: [],
        provider: 'openai',
        queries: ['AI safety'],
        references: [],
        responseId: null,
        searchId: 'search-1',
        status: 'completed',
        targetUrls: [],
        type: 'web_search',
      },
    ]

    const items = buildBlockRenderItems(blocks, 'complete')

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'chain',
      blocks: [{ id: 'thinking:1' }, { id: 'tool:web-search' }, { id: 'web_search:1' }],
    })
  })

  test('groups nested delegated activity by source run id', () => {
    const blocks: Block[] = [
      {
        args: { agentAlias: 'tony', task: 'Switch the music' },
        childRunId: 'run_child',
        createdAt: at,
        finishedAt: at,
        id: 'tool:delegate_root',
        name: 'delegate_to_agent',
        output: { kind: 'completed', summary: 'Done, Tony switched it.' },
        status: 'complete',
        toolCallId: asToolCallId('call_delegate_root'),
        type: 'tool_interaction',
      },
      {
        content: 'Checking Spotify controls.',
        createdAt: at,
        id: 'thinking:child',
        sourceRunId: 'run_child',
        status: 'done',
        title: 'reasoning',
        type: 'thinking',
      },
      {
        args: { action: 'play_track', query: 'Nora En Pure - Pretoria' },
        createdAt: at,
        finishedAt: at,
        id: 'tool:child_control',
        name: 'spotify__spotify_control',
        output: { ok: true },
        sourceRunId: 'run_child',
        status: 'complete',
        toolCallId: asToolCallId('call_child_control'),
        type: 'tool_interaction',
      },
      {
        args: { agentAlias: 'jenny', task: 'Confirm the playlist' },
        childRunId: 'run_grandchild',
        createdAt: at,
        id: 'tool:child_delegate',
        name: 'delegate_to_agent',
        sourceRunId: 'run_child',
        status: 'running',
        toolCallId: asToolCallId('call_child_delegate'),
        type: 'tool_interaction',
      },
      {
        args: { value: 'hello' },
        confirmation: {
          ownerRunId: 'run_grandchild',
          targetRef: 'mcp.echo',
          waitId: 'wte_grandchild',
          description: 'Need approval before continuing.',
        },
        createdAt: at,
        id: 'tool:grandchild_confirm',
        name: 'mcp.echo',
        sourceRunId: 'run_grandchild',
        status: 'awaiting_confirmation',
        toolCallId: asToolCallId('call_grandchild_confirm'),
        type: 'tool_interaction',
      },
    ]

    const topLevelItems = buildBlockRenderItems(blocks, 'complete')
    expect(topLevelItems).toHaveLength(1)
    expect(topLevelItems[0]).toMatchObject({
      id: 'deleg-tool:delegate_root',
      kind: 'delegation',
      parent: { id: 'tool:delegate_root' },
    })

    if (topLevelItems[0]?.kind !== 'delegation') {
      throw new Error('expected top-level delegation render item')
    }

    expect(topLevelItems[0].children.map((child) => child.id)).toEqual([
      'thinking:child',
      'tool:child_control',
      'tool:child_delegate',
      'tool:grandchild_confirm',
    ])

    const nestedItems = buildBlockRenderItems(topLevelItems[0].children, 'complete')
    expect(nestedItems).toHaveLength(3)
    expect(nestedItems[2]).toMatchObject({
      id: 'deleg-tool:child_delegate',
      kind: 'delegation',
      parent: { id: 'tool:child_delegate' },
    })

    if (nestedItems[2]?.kind !== 'delegation') {
      throw new Error('expected nested delegation render item')
    }

    expect(nestedItems[2].children).toMatchObject([
      {
        id: 'tool:grandchild_confirm',
        status: 'awaiting_confirmation',
        type: 'tool_interaction',
      },
    ])
  })

  test('keeps delegated MCP app tool blocks inside the delegation', () => {
    const blocks: Block[] = [
      {
        args: { agentAlias: 'tony', task: 'Open the Linear dashboard' },
        childRunId: 'run_child',
        createdAt: at,
        finishedAt: at,
        id: 'tool:delegate_root',
        name: 'delegate_to_agent',
        output: { kind: 'completed', summary: 'Opened Linear.' },
        status: 'complete',
        toolCallId: asToolCallId('call_delegate_root'),
        type: 'tool_interaction',
      },
      {
        createdAt: at,
        id: 'thinking:child',
        sourceRunId: 'run_child',
        status: 'done',
        title: 'reasoning',
        content: 'Loading the UI.',
        type: 'thinking',
      },
      {
        appsMeta: {
          resourceUri: 'ui://linear/issues',
          serverId: 'mcs_linear',
        },
        args: {},
        createdAt: at,
        finishedAt: at,
        id: 'tool:child_linear',
        name: 'linear__show_issues_ui',
        output: {
          meta: {
            ui: {
              resourceUri: 'ui://linear/issues',
            },
          },
          ok: true,
        },
        sourceRunId: 'run_child',
        status: 'complete',
        toolCallId: asToolCallId('call_child_linear'),
        type: 'tool_interaction',
      },
    ]

    const items = buildBlockRenderItems(blocks, 'complete')

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'deleg-tool:delegate_root',
      kind: 'delegation',
      parent: { id: 'tool:delegate_root' },
    })

    if (items[0]?.kind !== 'delegation') {
      throw new Error('expected delegation item')
    }

    expect(items[0].children).toMatchObject([
      {
        id: 'thinking:child',
        type: 'thinking',
      },
      {
        appsMeta: {
          resourceUri: 'ui://linear/issues',
          serverId: 'mcs_linear',
        },
        id: 'tool:child_linear',
        name: 'linear__show_issues_ui',
        type: 'tool_interaction',
      },
    ])
  })

  test('orphaned child blocks with unmatched sourceRunId appear at the top level', () => {
    const blocks: Block[] = [
      {
        args: { agentAlias: 'tony', task: 'Do work' },
        childRunId: 'run_child',
        createdAt: at,
        finishedAt: at,
        id: 'tool:delegate_root',
        name: 'delegate_to_agent',
        output: { kind: 'completed', summary: 'Done.' },
        status: 'complete',
        toolCallId: asToolCallId('call_delegate_root'),
        type: 'tool_interaction',
      },
      {
        args: { query: 'test' },
        createdAt: at,
        finishedAt: at,
        id: 'tool:orphaned_tool',
        name: 'some_tool',
        output: { ok: true },
        sourceRunId: 'run_unknown_child',
        status: 'complete',
        toolCallId: asToolCallId('call_orphaned'),
        type: 'tool_interaction',
      },
      {
        content: 'Final text.',
        createdAt: at,
        id: 'text:final',
        renderState: {
          committedSegments: [],
          liveTail: 'Final text.',
          nextSegmentIndex: 0,
          processedContent: 'Final text.',
        },
        streaming: false,
        type: 'text',
      },
    ]

    const items = buildBlockRenderItems(blocks, 'complete')

    // delegation + orphaned tool + text = 3 top-level items
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      kind: 'delegation',
      parent: { id: 'tool:delegate_root' },
    })

    if (items[0]?.kind !== 'delegation') {
      throw new Error('expected delegation item')
    }

    // Delegation has no nested children — orphaned block doesn't match
    expect(items[0].children).toEqual([])

    // Orphaned block renders at top level
    expect(items[1]).toMatchObject({
      kind: 'block',
      block: { id: 'tool:orphaned_tool', sourceRunId: 'run_unknown_child' },
    })
    expect(items[2]).toMatchObject({
      kind: 'block',
      block: { id: 'text:final' },
    })
  })
})
