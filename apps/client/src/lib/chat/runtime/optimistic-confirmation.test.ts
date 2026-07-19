import { asRunId, asSessionId, asThreadId } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import { buildOptimisticConfirmationEvent } from './optimistic-confirmation'

const nowIso = () => '2026-03-29T12:00:00.000Z'

const wait = { callId: 'call_1', tool: 'mcp.echo', waitId: 'wte_1' }

const input = {
  runId: asRunId('run_1'),
  sessionId: asSessionId('ses_1'),
  threadId: asThreadId('thr_1'),
}

describe('buildOptimisticConfirmationEvent', () => {
  test('builds a tool.confirmation_granted event for approve', () => {
    const built = buildOptimisticConfirmationEvent(
      wait,
      { ...input, remembered: true, status: 'approved' },
      nowIso,
    )

    expect(built.type).toBe('tool.confirmation_granted')
    expect(built.createdAt).toBe(nowIso())
    expect(built.id).toBe('evt_local_confirmation_approved_wte_1')
    expect(built.eventNo).toBe(-1)
    expect(built.payload).toMatchObject({
      callId: 'call_1',
      remembered: true,
      runId: input.runId,
      sessionId: input.sessionId,
      threadId: input.threadId,
      tool: 'mcp.echo',
      waitId: 'wte_1',
    })
  })

  test('defaults remembered to false when omitted on approve', () => {
    const built = buildOptimisticConfirmationEvent(wait, { ...input, status: 'approved' }, nowIso)

    expect(built.payload).toMatchObject({ remembered: false })
  })

  test('builds a tool.confirmation_rejected event for reject, without a remembered field', () => {
    const built = buildOptimisticConfirmationEvent(wait, { ...input, status: 'rejected' }, nowIso)

    expect(built.type).toBe('tool.confirmation_rejected')
    expect(built.id).toBe('evt_local_confirmation_rejected_wte_1')
    expect(built.payload).not.toHaveProperty('remembered')
    expect(built.payload).toMatchObject({
      callId: 'call_1',
      runId: input.runId,
      sessionId: input.sessionId,
      threadId: input.threadId,
      tool: 'mcp.echo',
      waitId: 'wte_1',
    })
  })
})
