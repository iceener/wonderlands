import assert from 'node:assert/strict'
import type { OpenResponsesResult } from '@openrouter/sdk/models'
import { test } from 'vitest'

import { normalizeResponse } from '../src/adapters/ai/openrouter/openrouter-response'

test('OpenRouter response normalization falls back to assistant message text when outputText is missing', () => {
  const response = {
    id: 'resp_openrouter_json_1',
    model: 'openai/gpt-5.4',
    output: [
      {
        content: [
          {
            annotations: [],
            text: '{"title":"Sprint planning"}',
            type: 'output_text',
          },
        ],
        id: 'msg_openrouter_json_1',
        phase: 'final_answer',
        role: 'assistant',
        status: 'completed',
        type: 'message',
      },
    ],
    status: 'completed',
    usage: null,
  } as unknown as OpenResponsesResult

  const normalized = normalizeResponse(response, null)

  assert.equal(normalized.outputText, '{"title":"Sprint planning"}')
  assert.deepEqual(normalized.messages, [
    {
      content: [{ text: '{"title":"Sprint planning"}', type: 'text' }],
      phase: 'final_answer',
      providerMessageId: 'msg_openrouter_json_1',
      role: 'assistant',
    },
  ])
})

test('OpenRouter response normalization fails explicitly on unsupported output item types', () => {
  const response = {
    completedAt: 0,
    createdAt: 0,
    error: null,
    id: 'resp_openrouter_unsupported_item_1',
    incompleteDetails: null,
    instructions: null,
    metadata: null,
    model: 'openai/gpt-5.4',
    object: 'response',
    output: [
      {
        id: 'tool_1',
        status: 'completed',
        type: 'openrouter:datetime',
      },
    ],
    parallelToolCalls: false,
    presencePenalty: null,
    frequencyPenalty: null,
    status: 'completed',
    temperature: null,
    toolChoice: 'auto',
    tools: [],
    topP: null,
    usage: null,
  } as unknown as OpenResponsesResult

  const normalized = normalizeResponse(response, null)

  assert.equal(normalized.status, 'failed')
  assert.deepEqual(
    (
      normalized.raw as {
        unsupportedOutputItemTypes?: string[]
      }
    ).unsupportedOutputItemTypes,
    ['openrouter:datetime'],
  )
})

test('OpenRouter response normalization fails explicitly on unsupported message annotations', () => {
  const response = {
    completedAt: 0,
    createdAt: 0,
    error: null,
    id: 'resp_openrouter_unsupported_annotation_1',
    incompleteDetails: null,
    instructions: null,
    metadata: null,
    model: 'openai/gpt-5.4',
    object: 'response',
    output: [
      {
        content: [
          {
            annotations: [
              {
                fileId: 'file_1',
                filename: 'report.pdf',
                index: 0,
                type: 'file_citation',
              },
            ],
            text: 'See the attached report.',
            type: 'output_text',
          },
        ],
        id: 'msg_openrouter_unsupported_annotation_1',
        phase: 'final_answer',
        role: 'assistant',
        status: 'completed',
        type: 'message',
      },
    ],
    parallelToolCalls: false,
    presencePenalty: null,
    frequencyPenalty: null,
    status: 'completed',
    temperature: null,
    toolChoice: 'auto',
    tools: [],
    topP: null,
    usage: null,
  } as unknown as OpenResponsesResult

  const normalized = normalizeResponse(response, null)

  assert.equal(normalized.status, 'failed')
  assert.deepEqual(
    (
      normalized.raw as {
        unsupportedMessageAnnotationTypes?: string[]
      }
    ).unsupportedMessageAnnotationTypes,
    ['file_citation'],
  )
})
