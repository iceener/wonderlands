import type { BackendEvent, Block, ToolInteractionBlock } from '@wonderlands/contracts/chat'
import { asEventId, asRunId, asThreadId, asToolCallId } from '@wonderlands/contracts/chat'
import { describe, expect, test } from 'vitest'
import {
  doesEventSettleAssistantAttachments,
  eventRunId,
  eventThreadId,
  isChildTranscriptEvent,
  isDelegationParentBlock,
} from './event-identity'

const at = '2026-03-29T12:00:00.000Z'

const event = <TEvent extends BackendEvent>(value: TEvent): TEvent => value

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

describe('eventRunId', () => {
  test('reads a string runId from the event payload', () => {
    const streamDelta = event({
      aggregateId: 'run_1',
      aggregateType: 'run',
      createdAt: at,
      eventNo: 1,
      id: asEventId('evt_1'),
      payload: { delta: 'hi', runId: asRunId('run_1'), sessionId: 'ses_1', status: 'running' },
      type: 'stream.delta',
    })

    expect(eventRunId(streamDelta)).toBe(asRunId('run_1'))
  })

  test('returns null when the payload has no runId field', () => {
    const naming = event({
      aggregateId: 'thr_1',
      aggregateType: 'thread',
      createdAt: at,
      eventNo: 1,
      id: asEventId('evt_naming'),
      payload: { threadId: asThreadId('thr_1'), trigger: 'auto' },
      type: 'thread.naming.requested',
    })

    expect(eventRunId(naming)).toBeNull()
  })
})

describe('eventThreadId', () => {
  test('reads a string threadId from the event payload', () => {
    const naming = event({
      aggregateId: 'thr_1',
      aggregateType: 'thread',
      createdAt: at,
      eventNo: 1,
      id: asEventId('evt_naming'),
      payload: { threadId: asThreadId('thr_1'), trigger: 'auto' },
      type: 'thread.naming.requested',
    })

    expect(eventThreadId(naming)).toBe(asThreadId('thr_1'))
  })

  test('returns null when the payload has no threadId field', () => {
    const memoryStarted = event({
      aggregateId: 'run_1',
      aggregateType: 'run',
      createdAt: at,
      eventNo: 1,
      id: asEventId('evt_memory'),
      payload: { runId: asRunId('run_1') },
      type: 'memory.observation.started',
    })

    expect(eventThreadId(memoryStarted)).toBeNull()
  })
})

describe('isChildTranscriptEvent', () => {
  test('treats transcript-shaped event types as child-transcript eligible', () => {
    expect(isChildTranscriptEvent(event({ type: 'stream.delta' } as BackendEvent))).toBe(true)
    expect(isChildTranscriptEvent(event({ type: 'tool.completed' } as BackendEvent))).toBe(true)
    expect(isChildTranscriptEvent(event({ type: 'run.cancelled' } as BackendEvent))).toBe(true)
  })

  test('rejects run lifecycle and non-transcript event types', () => {
    expect(isChildTranscriptEvent(event({ type: 'run.completed' } as BackendEvent))).toBe(false)
    expect(isChildTranscriptEvent(event({ type: 'run.waiting' } as BackendEvent))).toBe(false)
    expect(isChildTranscriptEvent(event({ type: 'thread.updated' } as BackendEvent))).toBe(false)
  })
})

describe('isDelegationParentBlock', () => {
  test('identifies a delegate_to_agent tool block with a non-empty childRunId', () => {
    const block: Block = toolBlock({ childRunId: 'run_child_1', name: 'delegate_to_agent' })

    expect(isDelegationParentBlock(block)).toBe(true)
  })

  test('rejects blocks missing childRunId, a blank childRunId, or the wrong tool name', () => {
    expect(isDelegationParentBlock(toolBlock({ name: 'delegate_to_agent' }))).toBe(false)
    expect(
      isDelegationParentBlock(toolBlock({ name: 'delegate_to_agent', childRunId: '   ' })),
    ).toBe(false)
    expect(
      isDelegationParentBlock(toolBlock({ name: 'weather.lookup', childRunId: 'run_child_1' })),
    ).toBe(false)
  })

  test('rejects non tool_interaction blocks', () => {
    const thinking: Block = {
      content: 'hi',
      createdAt: at,
      id: 'thinking:1',
      status: 'thinking',
      title: 'reasoning',
      type: 'thinking',
    }

    expect(isDelegationParentBlock(thinking)).toBe(false)
  })
})

describe('doesEventSettleAssistantAttachments', () => {
  test('flags terminal/settling event types', () => {
    for (const type of [
      'generation.completed',
      'stream.done',
      'run.cancelled',
      'run.completed',
      'run.failed',
      'run.waiting',
    ] as const) {
      expect(doesEventSettleAssistantAttachments(event({ type } as BackendEvent))).toBe(true)
    }
  })

  test('does not flag mid-stream event types', () => {
    for (const type of ['stream.delta', 'tool.called', 'run.started'] as const) {
      expect(doesEventSettleAssistantAttachments(event({ type } as BackendEvent))).toBe(false)
    }
  })
})
