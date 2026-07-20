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

const streamDelta = event({
  aggregateId: 'run_1',
  aggregateType: 'run',
  createdAt: at,
  eventNo: 1,
  id: asEventId('evt_1'),
  payload: {
    delta: 'hi',
    runId: asRunId('run_1'),
    sessionId: 'ses_1',
    status: 'running',
  },
  type: 'stream.delta',
})

const naming = event({
  aggregateId: 'thr_1',
  aggregateType: 'thread',
  createdAt: at,
  eventNo: 1,
  id: asEventId('evt_naming'),
  payload: { threadId: asThreadId('thr_1'), trigger: 'auto' },
  type: 'thread.naming.requested',
})

const memoryStarted = event({
  aggregateId: 'run_1',
  aggregateType: 'run',
  createdAt: at,
  eventNo: 1,
  id: asEventId('evt_memory'),
  payload: { runId: asRunId('run_1') },
  type: 'memory.observation.started',
})

describe('event identity', () => {
  test.each([
    ['run id from payload', eventRunId, streamDelta, asRunId('run_1')],
    ['missing run id', eventRunId, naming, null],
    ['thread id from payload', eventThreadId, naming, asThreadId('thr_1')],
    ['missing thread id', eventThreadId, memoryStarted, null],
  ] as const)('resolves %s', (_label, resolve, backendEvent, expected) => {
    expect(resolve(backendEvent)).toBe(expected)
  })

  test.each([
    ['transcript events', ['stream.delta', 'tool.completed', 'run.cancelled'], true],
    ['lifecycle events', ['run.completed', 'run.waiting', 'thread.updated'], false],
  ] as const)('classifies %s for child transcripts', (_label, types, expected) => {
    for (const type of types) {
      expect(isChildTranscriptEvent(event({ type } as BackendEvent))).toBe(expected)
    }
  })

  test.each([
    [
      'delegation with child run',
      toolBlock({ childRunId: 'run_child_1', name: 'delegate_to_agent' }),
      true,
    ],
    [
      'invalid delegation variants',
      [
        toolBlock({ name: 'delegate_to_agent' }),
        toolBlock({ childRunId: '   ', name: 'delegate_to_agent' }),
        toolBlock({ childRunId: 'run_child_1', name: 'weather.lookup' }),
      ],
      false,
    ],
    [
      'non-tool block',
      {
        content: 'hi',
        createdAt: at,
        id: 'thinking:1',
        status: 'thinking',
        title: 'reasoning',
        type: 'thinking',
      } satisfies Block,
      false,
    ],
  ] as const)('classifies %s as a delegation parent', (_label, blocks, expected) => {
    for (const block of Array.isArray(blocks) ? blocks : [blocks]) {
      expect(isDelegationParentBlock(block)).toBe(expected)
    }
  })

  test.each([
    [
      'terminal events',
      [
        'generation.completed',
        'stream.done',
        'run.cancelled',
        'run.completed',
        'run.failed',
        'run.waiting',
      ],
      true,
    ],
    ['mid-stream events', ['stream.delta', 'tool.called', 'run.started'], false],
  ] as const)('classifies %s for attachment settlement', (_label, types, expected) => {
    for (const type of types) {
      expect(doesEventSettleAssistantAttachments(event({ type } as BackendEvent))).toBe(expected)
    }
  })
})
