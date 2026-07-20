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
  test.each([
    {
      expectedId: 'evt_local_confirmation_approved_wte_1',
      expectedRemembered: true,
      input: { remembered: true, status: 'approved' as const },
      type: 'tool.confirmation_granted',
    },
    {
      expectedId: 'evt_local_confirmation_approved_wte_1',
      expectedRemembered: false,
      input: { status: 'approved' as const },
      type: 'tool.confirmation_granted',
    },
    {
      expectedId: 'evt_local_confirmation_rejected_wte_1',
      expectedRemembered: undefined,
      input: { status: 'rejected' as const },
      type: 'tool.confirmation_rejected',
    },
  ])('builds $type with the expected remembered state', (scenario) => {
    const built = buildOptimisticConfirmationEvent(wait, { ...input, ...scenario.input }, nowIso)

    expect(built.type).toBe(scenario.type)
    expect(built.createdAt).toBe(nowIso())
    expect(built.id).toBe(scenario.expectedId)
    expect(built.eventNo).toBe(-1)
    expect(built.payload).toMatchObject({
      callId: 'call_1',
      runId: input.runId,
      sessionId: input.sessionId,
      threadId: input.threadId,
      tool: 'mcp.echo',
      waitId: 'wte_1',
    })

    if (scenario.expectedRemembered === undefined) {
      expect(built.payload).not.toHaveProperty('remembered')
    } else {
      expect(built.payload).toMatchObject({ remembered: scenario.expectedRemembered })
    }
  })
})
