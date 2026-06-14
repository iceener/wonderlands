import { asToolCallId, type ToolInteractionBlock } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { getSuspendedToolLabel, isSuspendedToolBlock } from './tool-state'

const at = '2026-04-03T00:00:00.000Z'

const toolBlock = (overrides: Partial<ToolInteractionBlock> = {}): ToolInteractionBlock => ({
  args: null,
  createdAt: at,
  id: 'tool:1',
  name: 'suspend_run',
  status: 'running',
  toolCallId: asToolCallId('call_1'),
  type: 'tool_interaction',
  ...overrides,
})

describe('tool-state', () => {
  test('recognizes active suspend_run blocks as suspended', () => {
    expect(isSuspendedToolBlock(toolBlock())).toBe(true)
    expect(isSuspendedToolBlock(toolBlock({ status: 'complete' }))).toBe(false)
    expect(isSuspendedToolBlock(toolBlock({ name: 'other_tool' }))).toBe(false)
  })

  test('derives human response label for suspended tools', () => {
    expect(
      getSuspendedToolLabel(
        toolBlock({
          args: {
            targetKind: 'human_response',
          },
        }),
      ),
    ).toBe('Awaiting reply')
  })
})
