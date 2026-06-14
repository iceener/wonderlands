import assert from 'node:assert/strict'
import { test } from 'vitest'

import { toItemMessages } from '../src/application/interactions/build-run-interaction-request'
import type { ItemRecord } from '../src/domain/runtime/item-repository'
import { asItemId, asRunId, asTenantId } from '../src/shared/ids'

const createReasoningItem = (id: string, providerPayload: unknown): ItemRecord => ({
  arguments: null,
  callId: null,
  content: null,
  createdAt: '2026-03-30T12:00:00.000Z',
  id: asItemId(id),
  name: null,
  output: null,
  providerPayload,
  role: null,
  runId: asRunId('run_1'),
  sequence: 1,
  summary: [{ text: 'Need tool output first.', type: 'summary_text' }],
  tenantId: asTenantId('ten_1'),
  type: 'reasoning',
})

const createFunctionCallItem = (
  id: string,
  input: {
    argumentsJson: string
    callId: string
    name: string
    providerPayload?: unknown
  },
): ItemRecord => ({
  arguments: input.argumentsJson,
  callId: input.callId,
  content: null,
  createdAt: '2026-03-30T12:00:00.000Z',
  id: asItemId(id),
  name: input.name,
  output: null,
  providerPayload: input.providerPayload ?? null,
  role: null,
  runId: asRunId('run_1'),
  sequence: 1,
  summary: null,
  tenantId: asTenantId('ten_1'),
  type: 'function_call',
})

const createFunctionCallOutputItem = (
  id: string,
  input: {
    callId: string
    name: string
    outputJson: string
  },
): ItemRecord => ({
  arguments: null,
  callId: input.callId,
  content: null,
  createdAt: '2026-03-30T12:00:01.000Z',
  id: asItemId(id),
  name: null,
  output: input.outputJson,
  providerPayload: {
    isError: false,
    name: input.name,
  },
  role: null,
  runId: asRunId('run_1'),
  sequence: 2,
  summary: null,
  tenantId: asTenantId('ten_1'),
  type: 'function_call_output',
})

test('toItemMessages replays reasoning items using provider item ids', () => {
  const messages = toItemMessages(
    [
      createReasoningItem('itm_local_reasoning', {
        encryptedContent: 'enc_reasoning',
        provider: 'openai',
        providerItemId: 'rs_reasoning_123',
      }),
    ],
    { provider: 'openai' },
  )

  assert.deepEqual(messages, [
    {
      content: [
        {
          encryptedContent: 'enc_reasoning',
          id: 'rs_reasoning_123',
          summary: [{ text: 'Need tool output first.', type: 'summary_text' }],
          type: 'reasoning',
        },
      ],
      role: 'assistant',
    },
  ])
})

test('toItemMessages skips legacy reasoning items without provider ids', () => {
  const messages = toItemMessages(
    [
      createReasoningItem('itm_legacy_reasoning', {
        encryptedContent: 'enc_reasoning',
        provider: 'openai',
      }),
    ],
    { provider: 'openai' },
  )

  assert.deepEqual(messages, [])
})

test('toItemMessages omits reasoning replay for non-openai providers', () => {
  const messages = toItemMessages(
    [
      createReasoningItem('itm_google_reasoning', {
        encryptedContent: 'enc_reasoning',
        provider: 'openai',
        providerItemId: 'rs_reasoning_123',
      }),
    ],
    { provider: 'google' },
  )

  assert.deepEqual(messages, [])
})

test('toItemMessages replays Gemini thought signatures for google providers', () => {
  const messages = toItemMessages(
    [
      createReasoningItem('itm_google_reasoning', {
        provider: 'google',
        providerItemId: 'thought_sig_123',
      }),
    ],
    { provider: 'google' },
  )

  assert.deepEqual(messages, [
    {
      content: [
        {
          id: 'thought_sig_123',
          summary: [{ text: 'Need tool output first.', type: 'summary_text' }],
          text: 'Need tool output first.',
          thought: true,
          type: 'reasoning',
        },
      ],
      role: 'assistant',
    },
  ])
})

test('toItemMessages maps delegated child-run envelopes to compact parent replay output', () => {
  const messages = toItemMessages([
    createFunctionCallItem('itm_delegate_call', {
      argumentsJson: '{"agentAlias":"jenny","task":"Ask how she is"}',
      callId: 'call_delegate_1',
      name: 'delegate_to_agent',
    }),
    createFunctionCallOutputItem('itm_delegate_output', {
      callId: 'call_delegate_1',
      name: 'delegate_to_agent',
      outputJson: JSON.stringify({
        childRunId: 'run_child_1',
        kind: 'completed',
        result: {
          assistantMessageId: null,
          model: 'gpt-5.4-2026-03-05',
          outputText: "I'm good, thanks - how about you?",
          provider: 'openai',
          providerRequestId: null,
          responseId: 'resp_child_1',
          usage: {
            cachedTokens: 0,
            inputTokens: 172,
            outputTokens: 14,
            reasoningTokens: 0,
            totalTokens: 186,
          },
        },
        summary: "I'm good, thanks - how about you?",
      }),
    }),
  ])

  assert.deepEqual(messages, [
    {
      content: [
        {
          argumentsJson: '{"agentAlias":"jenny","task":"Ask how she is"}',
          callId: 'call_delegate_1',
          name: 'delegate_to_agent',
          type: 'function_call',
        },
      ],
      role: 'assistant',
    },
    {
      content: [
        {
          callId: 'call_delegate_1',
          isError: false,
          name: 'delegate_to_agent',
          outputJson: JSON.stringify({
            kind: 'completed',
            summary: "I'm good, thanks - how about you?",
          }),
          type: 'function_result',
        },
      ],
      role: 'tool',
    },
  ])
})

test('toItemMessages replays Gemini function result signatures from the originating function call', () => {
  const messages = toItemMessages([
    createFunctionCallItem('itm_google_call', {
      argumentsJson: '{"q":"status"}',
      callId: 'call_google_1',
      name: 'lookup_status',
      providerPayload: {
        providerSignature: 'sig_call_google_1',
      },
    }),
    createFunctionCallOutputItem('itm_google_output', {
      callId: 'call_google_1',
      name: 'lookup_status',
      outputJson: '{"ok":true}',
    }),
  ])

  assert.deepEqual(messages, [
    {
      content: [
        {
          argumentsJson: '{"q":"status"}',
          callId: 'call_google_1',
          name: 'lookup_status',
          providerSignature: 'sig_call_google_1',
          type: 'function_call',
        },
      ],
      role: 'assistant',
    },
    {
      content: [
        {
          callId: 'call_google_1',
          isError: false,
          name: 'lookup_status',
          outputJson: '{"ok":true}',
          providerSignature: 'sig_call_google_1',
          type: 'function_result',
        },
      ],
      role: 'tool',
    },
  ])
})

test('toItemMessages preserves suspended delegated child metadata for parent replay', () => {
  const messages = toItemMessages([
    createFunctionCallItem('itm_resume_call', {
      argumentsJson:
        '{"childRunId":"run_child_1","waitId":"wte_child_1","output":{"kind":"human_response","text":"step 7 failed"}}',
      callId: 'call_resume_1',
      name: 'resume_delegated_run',
    }),
    createFunctionCallOutputItem('itm_resume_output', {
      callId: 'call_resume_1',
      name: 'resume_delegated_run',
      outputJson: JSON.stringify({
        childRunId: 'run_child_1',
        kind: 'suspended',
        summary: 'Which migration step failed?',
        waits: [
          {
            args: {
              details: {
                question: 'Which migration step failed?',
              },
            },
            description: 'Need the exact failing migration step.',
            targetKind: 'human_response',
            targetRef: 'user_response',
            tool: 'suspend_run',
            type: 'human',
            waitId: 'wte_child_1',
          },
        ],
      }),
    }),
  ])

  assert.deepEqual(messages, [
    {
      content: [
        {
          argumentsJson:
            '{"childRunId":"run_child_1","waitId":"wte_child_1","output":{"kind":"human_response","text":"step 7 failed"}}',
          callId: 'call_resume_1',
          name: 'resume_delegated_run',
          type: 'function_call',
        },
      ],
      role: 'assistant',
    },
    {
      content: [
        {
          callId: 'call_resume_1',
          isError: false,
          name: 'resume_delegated_run',
          outputJson: JSON.stringify({
            childRunId: 'run_child_1',
            kind: 'suspended',
            summary: 'Which migration step failed?',
            waits: [
              {
                args: {
                  details: {
                    question: 'Which migration step failed?',
                  },
                },
                description: 'Need the exact failing migration step.',
                targetKind: 'human_response',
                targetRef: 'user_response',
                tool: 'suspend_run',
                type: 'human',
                waitId: 'wte_child_1',
              },
            ],
          }),
          type: 'function_result',
        },
      ],
      role: 'tool',
    },
  ])
})

test('toItemMessages compacts failed delegated child output for provider-safe replay', () => {
  const messages = toItemMessages([
    createFunctionCallItem('itm_delegate_call', {
      argumentsJson: '{"agentAlias":"tony","task":"inspect"}',
      callId: 'call_delegate_1',
      name: 'delegate_to_agent',
    }),
    createFunctionCallOutputItem('itm_delegate_output', {
      callId: 'call_delegate_1',
      name: 'delegate_to_agent',
      outputJson: JSON.stringify({
        childRunId: 'run_child_1',
        error: {
          message:
            'OpenAI Responses adapter does not support response semantics for stream events: keepalive',
          provider: 'openai',
          transcript: {
            webSearchBlocks: [
              {
                references: [],
              },
            ],
          },
          type: 'provider',
        },
        kind: 'failed',
      }),
    }),
  ])

  assert.equal(messages.length, 2)
  assert.deepEqual(messages[0], {
    content: [
      {
        argumentsJson: '{"agentAlias":"tony","task":"inspect"}',
        callId: 'call_delegate_1',
        name: 'delegate_to_agent',
        type: 'function_call',
      },
    ],
    role: 'assistant',
  })
  assert.deepEqual(messages[1], {
    content: [
      {
        callId: 'call_delegate_1',
        isError: false,
        name: 'delegate_to_agent',
        outputJson:
          messages[1]?.content[0]?.type === 'function_result'
            ? messages[1].content[0].outputJson
            : '',
        type: 'function_result',
      },
    ],
    role: 'tool',
  })

  const toolResult = messages[1]?.content[0]
  assert.equal(toolResult?.type, 'function_result')

  if (toolResult?.type !== 'function_result') {
    return
  }

  assert.deepEqual(JSON.parse(toolResult.outputJson), {
    error: {
      message:
        'OpenAI Responses adapter does not support response semantics for stream events: keepalive',
      provider: 'openai',
      type: 'provider',
    },
    kind: 'failed',
  })
})
