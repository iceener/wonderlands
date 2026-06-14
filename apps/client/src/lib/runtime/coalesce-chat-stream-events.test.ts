import {
  asEventId,
  asRunId,
  asSessionId,
  asThreadId,
  type BackendEvent,
} from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'

import { coalesceChatStreamEvents } from './coalesce-chat-stream-events'

const threadId = asThreadId('thr_1')
const runId = asRunId('run_1')
const sessionId = asSessionId('ses_1')

const runEvent = (
  eventNo: number,
  type: BackendEvent['type'],
  payload: Record<string, unknown>,
): BackendEvent => ({
  aggregateId: String(runId),
  aggregateType: 'run',
  createdAt: `2026-04-05T12:00:${String(eventNo).padStart(2, '0')}.000Z`,
  eventNo,
  id: asEventId(`evt_${eventNo}`),
  payload: {
    runId,
    sessionId,
    threadId,
    ...payload,
  },
  type,
})

describe('coalesceChatStreamEvents', () => {
  test('merges consecutive stream.delta events for the same run', () => {
    const events = coalesceChatStreamEvents([
      {
        ...runEvent(1, 'stream.delta', { delta: 'Hel' }),
        createdAt: '2026-04-05T12:00:00.000Z',
      },
      {
        ...runEvent(2, 'stream.delta', { delta: 'lo' }),
        createdAt: '2026-04-05T12:00:00.050Z',
      },
      {
        ...runEvent(3, 'stream.delta', { delta: ' world' }),
        createdAt: '2026-04-05T12:00:00.100Z',
      },
    ])

    expect(events).toHaveLength(1)
    expect(events[0]?.eventNo).toBe(3)
    expect(events[0]?.payload).toMatchObject({
      delta: 'Hello world',
    })
  })

  test('merges consecutive reasoning.summary.delta events by item id and keeps latest text', () => {
    const events = coalesceChatStreamEvents([
      {
        ...runEvent(4, 'reasoning.summary.delta', {
          delta: 'Need',
          itemId: 'rs_1',
          text: 'Need',
        }),
        createdAt: '2026-04-05T12:00:01.000Z',
      },
      {
        ...runEvent(5, 'reasoning.summary.delta', {
          delta: ' more',
          itemId: 'rs_1',
          text: 'Need more',
        }),
        createdAt: '2026-04-05T12:00:01.070Z',
      },
      {
        ...runEvent(6, 'reasoning.summary.delta', {
          delta: ' checks',
          itemId: 'rs_1',
          text: 'Need more checks',
        }),
        createdAt: '2026-04-05T12:00:01.140Z',
      },
    ])

    expect(events).toHaveLength(1)
    expect(events[0]?.eventNo).toBe(6)
    expect(events[0]?.payload).toMatchObject({
      delta: 'Need more checks',
      itemId: 'rs_1',
      text: 'Need more checks',
    })
  })

  test('keeps reasoning deltas separate when item ids differ', () => {
    const events = coalesceChatStreamEvents([
      runEvent(7, 'reasoning.summary.delta', {
        delta: 'Need',
        itemId: 'rs_1',
        text: 'Need',
      }),
      runEvent(8, 'reasoning.summary.delta', {
        delta: 'Other',
        itemId: 'rs_2',
        text: 'Other',
      }),
    ])

    expect(events).toHaveLength(2)
  })

  test('does not merge deltas across distant timestamps', () => {
    const events = coalesceChatStreamEvents([
      {
        ...runEvent(12, 'stream.delta', { delta: 'old ' }),
        createdAt: '2026-04-05T12:00:00.000Z',
      },
      {
        ...runEvent(13, 'stream.delta', { delta: 'new' }),
        createdAt: '2026-04-05T12:00:05.000Z',
      },
    ])

    expect(events).toHaveLength(2)
  })

  test('keeps only the latest consecutive progress.reported event for the same run', () => {
    const events = coalesceChatStreamEvents([
      {
        ...runEvent(9, 'progress.reported', {
          detail: 'Queued',
          percent: 10,
          stage: 'queued',
        }),
        createdAt: '2026-04-05T12:00:02.000Z',
      },
      {
        ...runEvent(10, 'progress.reported', {
          detail: 'Generating',
          percent: 40,
          stage: 'generating',
        }),
        createdAt: '2026-04-05T12:00:02.050Z',
      },
      {
        ...runEvent(11, 'stream.delta', { delta: 'Hi' }),
        createdAt: '2026-04-05T12:00:02.100Z',
      },
    ])

    expect(events).toHaveLength(2)
    expect(events[0]?.eventNo).toBe(10)
    expect(events[0]?.payload).toMatchObject({
      detail: 'Generating',
      percent: 40,
      stage: 'generating',
    })
  })
})
