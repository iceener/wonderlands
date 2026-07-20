import type { BackendEvent } from '@wonderlands/contracts/chat'
import { asEventId, asRunId, asSessionId, asThreadId } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { resolveForeignPendingWaitAction } from './pending-wait-sync'

const at = '2026-03-29T12:00:00.000Z'
const runId = asRunId('run_child_1')

const toolEvent = (type: BackendEvent['type'], payload: Record<string, unknown>): BackendEvent =>
  ({
    aggregateId: 'call_1',
    aggregateType: 'tool_execution',
    createdAt: at,
    eventNo: 1,
    id: asEventId(`evt_${type}`),
    payload: {
      runId,
      sessionId: asSessionId('ses_1'),
      threadId: asThreadId('thr_1'),
      ...payload,
    },
    type,
  }) as BackendEvent

const confirmationRequested = toolEvent('tool.confirmation_requested', {
  args: { value: 'hello' },
  callId: 'call_1',
  description: 'Confirm the echo tool',
  tool: 'mcp.echo',
  waitId: 'wte_1',
  waitTargetKind: 'human_response',
  waitTargetRef: 'mcp.echo',
  waitType: 'human',
})

const humanWaiting = toolEvent('tool.waiting', {
  args: null,
  callId: 'call_2',
  description: 'Need input',
  tool: 'suspend_run',
  waitId: 'wte_2',
  waitTargetKind: 'human_response',
  waitTargetRef: 'user_response',
  waitType: 'human',
})

const childRunWaiting = toolEvent('tool.waiting', {
  args: null,
  callId: 'call_3',
  description: null,
  tool: 'delegate_to_agent',
  waitId: 'wte_3',
  waitTargetKind: 'child_run',
  waitTargetRef: 'run_child_2',
  waitType: 'child_run',
})

describe('resolveForeignPendingWaitAction', () => {
  test.each([
    {
      backendEvent: confirmationRequested,
      expected: {
        kind: 'upsert',
        wait: {
          callId: 'call_1',
          ownerRunId: 'run_child_1',
          requiresApproval: true,
          waitId: 'wte_1',
        },
      },
      name: 'upserts owned approval waits',
    },
    {
      backendEvent: humanWaiting,
      expected: {
        kind: 'upsert',
        wait: {
          callId: 'call_2',
          ownerRunId: 'run_child_1',
          requiresApproval: false,
          waitId: 'wte_2',
        },
      },
      name: 'upserts owned human-response waits',
    },
    {
      backendEvent: childRunWaiting,
      expected: null,
      name: 'ignores child-run waits',
    },
    ...(['tool.confirmation_granted', 'tool.confirmation_rejected', 'wait.timed_out'] as const).map(
      (type) => ({
        backendEvent: toolEvent(type, {
          callId: 'call_1',
          tool: 'mcp.echo',
          waitId: 'wte_1',
        }),
        expected: { kind: 'removeByWaitId', waitId: 'wte_1' },
        name: `removes by wait id on ${type}`,
      }),
    ),
    ...(['tool.completed', 'tool.failed'] as const).map((type) => ({
      backendEvent: toolEvent(type, { callId: 'call_1', tool: 'mcp.echo' }),
      expected: { callId: 'call_1', kind: 'removeByCallId' },
      name: `removes by call id on ${type}`,
    })),
    {
      backendEvent: { type: 'stream.delta' } as BackendEvent,
      expected: null,
      name: 'ignores unrelated events',
    },
  ])('$name', ({ backendEvent, expected }) => {
    const action = resolveForeignPendingWaitAction(backendEvent)

    if (expected === null) {
      expect(action).toBeNull()
    } else {
      expect(action).toMatchObject(expected)
    }
  })
})
