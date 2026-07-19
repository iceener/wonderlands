import type { BackendEvent } from '@wonderlands/contracts/chat'
import { asEventId, asRunId, asSessionId, asThreadId } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { resolveForeignPendingWaitAction } from './pending-wait-sync'

const at = '2026-03-29T12:00:00.000Z'
const runId = asRunId('run_child_1')

const event = <TEvent extends BackendEvent>(value: TEvent): TEvent => value

describe('resolveForeignPendingWaitAction', () => {
  test('upserts a confirmation-required pending wait, tagged with the event runId as owner', () => {
    const action = resolveForeignPendingWaitAction(
      event({
        aggregateId: 'call_1',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_1'),
        payload: {
          args: { value: 'hello' },
          callId: 'call_1',
          description: 'Confirm the echo tool',
          runId,
          sessionId: asSessionId('ses_1'),
          threadId: asThreadId('thr_1'),
          tool: 'mcp.echo',
          waitId: 'wte_1',
          waitTargetKind: 'human_response',
          waitTargetRef: 'mcp.echo',
          waitType: 'human',
        },
        type: 'tool.confirmation_requested',
      }),
    )

    expect(action).toEqual({
      kind: 'upsert',
      wait: expect.objectContaining({
        callId: 'call_1',
        ownerRunId: 'run_child_1',
        requiresApproval: true,
        waitId: 'wte_1',
      }),
    })
  })

  test('upserts a human-response tool.waiting event as a non-approval pending wait', () => {
    const action = resolveForeignPendingWaitAction(
      event({
        aggregateId: 'call_2',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_2'),
        payload: {
          args: null,
          callId: 'call_2',
          description: 'Need input',
          runId,
          sessionId: asSessionId('ses_1'),
          threadId: asThreadId('thr_1'),
          tool: 'suspend_run',
          waitId: 'wte_2',
          waitTargetKind: 'human_response',
          waitTargetRef: 'user_response',
          waitType: 'human',
        },
        type: 'tool.waiting',
      }),
    )

    expect(action).toEqual({
      kind: 'upsert',
      wait: expect.objectContaining({
        callId: 'call_2',
        ownerRunId: 'run_child_1',
        requiresApproval: false,
        waitId: 'wte_2',
      }),
    })
  })

  test('ignores tool.waiting events that are not human-response waits', () => {
    const action = resolveForeignPendingWaitAction(
      event({
        aggregateId: 'call_3',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_3'),
        payload: {
          args: null,
          callId: 'call_3',
          description: null,
          runId,
          sessionId: asSessionId('ses_1'),
          threadId: asThreadId('thr_1'),
          tool: 'delegate_to_agent',
          waitId: 'wte_3',
          waitTargetKind: 'child_run',
          waitTargetRef: 'run_child_2',
          waitType: 'child_run',
        },
        type: 'tool.waiting',
      }),
    )

    expect(action).toBeNull()
  })

  test.each([
    'tool.confirmation_granted',
    'tool.confirmation_rejected',
    'wait.timed_out',
  ] as const)('removes the pending wait by waitId on %s', (type) => {
    const action = resolveForeignPendingWaitAction(
      event({
        aggregateId: 'call_1',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_1'),
        payload: {
          callId: 'call_1',
          runId,
          sessionId: asSessionId('ses_1'),
          threadId: asThreadId('thr_1'),
          tool: 'mcp.echo',
          waitId: 'wte_1',
        },
        type,
      } as unknown as BackendEvent),
    )

    expect(action).toEqual({ kind: 'removeByWaitId', waitId: 'wte_1' })
  })

  test.each([
    'tool.completed',
    'tool.failed',
  ] as const)('removes the pending wait by callId on %s', (type) => {
    const action = resolveForeignPendingWaitAction(
      event({
        aggregateId: 'call_1',
        aggregateType: 'tool_execution',
        createdAt: at,
        eventNo: 1,
        id: asEventId('evt_1'),
        payload: {
          callId: 'call_1',
          runId,
          sessionId: asSessionId('ses_1'),
          threadId: asThreadId('thr_1'),
          tool: 'mcp.echo',
        },
        type,
      } as unknown as BackendEvent),
    )

    expect(action).toEqual({ kind: 'removeByCallId', callId: 'call_1' })
  })

  test('returns null for unrelated event types', () => {
    expect(
      resolveForeignPendingWaitAction(event({ type: 'stream.delta' } as BackendEvent)),
    ).toBeNull()
  })
})
