import type { BackendPendingWait, ToolInteractionBlock } from '@wonderlands/contracts/chat'
import { asToolCallId } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { mergePendingWaitBlocks } from './pending-wait-blocks'

const at = '2026-03-29T12:00:00.000Z'

const confirmationWait = (overrides: Partial<BackendPendingWait> = {}): BackendPendingWait => ({
  args: { value: 'hello' },
  callId: 'call_1',
  createdAt: at,
  description: 'Confirm the echo tool',
  requiresApproval: true,
  targetKind: 'human_response',
  targetRef: 'mcp.echo',
  tool: 'mcp.echo',
  type: 'human',
  waitId: 'wte_1',
  ...overrides,
})

const replyWait = (overrides: Partial<BackendPendingWait> = {}): BackendPendingWait => ({
  args: null,
  callId: 'call_ask_user',
  createdAt: at,
  description: 'Need the exact migration step from the user.',
  requiresApproval: false,
  targetKind: 'human_response',
  targetRef: 'user_response',
  tool: 'suspend_run',
  type: 'human',
  waitId: 'wte_reply_1',
  ...overrides,
})

const runningToolBlock = (toolCallId: string): ToolInteractionBlock => ({
  args: null,
  createdAt: at,
  id: `tool:${toolCallId}`,
  name: 'weather.lookup',
  sourceRunId: 'run_1',
  status: 'running',
  toolCallId: asToolCallId(toolCallId),
  type: 'tool_interaction',
})

describe('mergePendingWaitBlocks', () => {
  test('appends a new confirmation block when no matching block exists', () => {
    const blocks = mergePendingWaitBlocks([], [confirmationWait()])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      id: 'tool:call_1',
      status: 'awaiting_confirmation',
      type: 'tool_interaction',
    })
  })

  test('updates an existing block in place instead of duplicating it', () => {
    const existing = mergePendingWaitBlocks([], [confirmationWait()])
    const merged = mergePendingWaitBlocks(existing, [
      confirmationWait({ description: 'Updated description' }),
    ])

    expect(merged).toHaveLength(1)
    expect((merged[0] as ToolInteractionBlock).confirmation?.description).toBe(
      'Updated description',
    )
  })

  test('does not push a duplicate wait block for a tool call already running', () => {
    const blocks = mergePendingWaitBlocks([runningToolBlock('call_ask_user')], [replyWait()])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ status: 'running', type: 'tool_interaction' })
  })

  test('replaces a running tool block in place when a matching confirmation wait arrives', () => {
    const blocks = mergePendingWaitBlocks(
      [runningToolBlock('call_1')],
      [confirmationWait({ callId: 'call_1' })],
    )

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ id: 'tool:call_1', status: 'awaiting_confirmation' })
  })

  test('preserves unrelated existing blocks', () => {
    const unrelated = runningToolBlock('call_other')
    const blocks = mergePendingWaitBlocks([unrelated], [replyWait()])

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toBe(unrelated)
    expect(blocks[1]).toMatchObject({ id: 'waiting:wte_reply_1', type: 'thinking' })
  })
})
