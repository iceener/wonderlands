import assert from 'node:assert/strict'
import type { Interactions } from '@google/genai'
import { test } from 'vitest'

import { normalizeResponse } from '../src/adapters/ai/google/google-response'
import type { ResolvedAiInteractionRequest } from '../src/domain/ai/types'

const request: ResolvedAiInteractionRequest = {
  messages: [
    {
      content: [{ text: 'hello', type: 'text' }],
      role: 'user',
    },
  ],
  model: 'gemini-2.5-pro',
  provider: 'google',
}

type ContractCase = { name: string; run: () => void }
const contractCases: ContractCase[] = []
const contractCase = (name: string, run: () => void) => contractCases.push({ name, run })

contractCase(
  'Google Interactions normalization preserves thought signatures and function call steps',
  () => {
    const interaction = {
      created: '2026-04-06T09:00:00.000Z',
      id: 'int_google_1',
      model: 'gemini-2.5-pro',
      status: 'requires_action',
      steps: [
        {
          signature: 'sig_thought_1',
          summary: [
            {
              text: 'Need to inspect the tool result first.',
              type: 'text',
            },
          ],
          type: 'thought',
        },
        {
          arguments: { q: 'status' },
          id: 'call_1',
          name: 'lookup_status',
          type: 'function_call',
        },
        {
          content: [
            {
              text: 'The tool completed successfully.',
              type: 'text',
            },
          ],
          type: 'model_output',
        },
      ],
      updated: '2026-04-06T09:00:01.000Z',
      usage: {
        total_input_tokens: 20,
        total_output_tokens: 12,
        total_thought_tokens: 4,
        total_tokens: 36,
      },
    } as Interactions.Interaction

    const normalized = normalizeResponse(request, interaction)

    assert.equal(normalized.status, 'completed')
    assert.deepEqual(normalized.output, [
      {
        id: 'sig_thought_1',
        summary: [{ text: 'Need to inspect the tool result first.', type: 'summary_text' }],
        text: 'Need to inspect the tool result first.',
        thought: true,
        type: 'reasoning',
      },
      {
        arguments: { q: 'status' },
        argumentsJson: '{"q":"status"}',
        callId: 'call_1',
        name: 'lookup_status',
        type: 'function_call',
      },
      {
        content: [{ text: 'The tool completed successfully.', type: 'text' }],
        role: 'assistant',
        type: 'message',
      },
    ])
    assert.deepEqual(normalized.toolCalls, [
      {
        arguments: { q: 'status' },
        argumentsJson: '{"q":"status"}',
        callId: 'call_1',
        name: 'lookup_status',
      },
    ])
    assert.equal(normalized.responseId, 'int_google_1')
    assert.equal(normalized.providerRequestId, null)
  },
)

contractCase(
  'Google Interactions normalization preserves web search queries and URL citations',
  () => {
    const interaction = {
      created: '2026-04-06T09:00:00.000Z',
      id: 'int_google_2',
      model: 'gemini-2.5-pro',
      status: 'completed',
      steps: [
        {
          arguments: {
            queries: ['latest svelte docs'],
          },
          id: 'search_1',
          search_type: 'web_search',
          type: 'google_search_call',
        },
        {
          content: [
            {
              annotations: [
                {
                  title: 'Svelte documentation',
                  type: 'url_citation',
                  url: 'https://svelte.dev/docs',
                },
              ],
              text: 'The latest Svelte docs are available on the official site.',
              type: 'text',
            },
          ],
          type: 'model_output',
        },
      ],
      updated: '2026-04-06T09:00:01.000Z',
    } as Interactions.Interaction

    const normalized = normalizeResponse(request, interaction)

    assert.deepEqual(normalized.webSearches, [
      {
        id: 'web_search:int_google_2',
        patterns: [],
        provider: 'google',
        queries: ['latest svelte docs'],
        references: [
          {
            domain: 'svelte.dev',
            title: 'Svelte documentation',
            url: 'https://svelte.dev/docs',
          },
        ],
        responseId: 'int_google_2',
        status: 'completed',
        targetUrls: [],
      },
    ])
  },
)

contractCase('Google Interactions normalization keeps failed status and error payloads', () => {
  const interaction = {
    created: '2026-04-06T09:00:00.000Z',
    id: 'int_google_failed_1',
    model: 'gemini-2.5-pro',
    status: 'failed',
    steps: [],
    updated: '2026-04-06T09:00:01.000Z',
  } as Interactions.Interaction

  const normalized = normalizeResponse(request, interaction, {
    error: {
      code: 'MALFORMED_FUNCTION_CALL',
      message: 'Google GenAI returned a malformed function call.',
    },
  })

  assert.equal(normalized.status, 'failed')
  assert.equal(
    (
      normalized.raw as {
        error?: {
          message?: string
        }
      }
    ).error?.message,
    'Google GenAI returned a malformed function call.',
  )
})

contractCase(
  'Google Interactions normalization preserves reasoning blocks without signatures',
  () => {
    const interaction = {
      created: '2026-04-06T09:00:00.000Z',
      id: 'int_google_reasoning_1',
      model: 'gemini-2.5-pro',
      status: 'completed',
      steps: [
        {
          summary: [
            {
              text: 'Need to check one more invariant.',
              type: 'text',
            },
          ],
          type: 'thought',
        },
        {
          content: [
            {
              text: 'The invariant still holds.',
              type: 'text',
            },
          ],
          type: 'model_output',
        },
      ],
      updated: '2026-04-06T09:00:01.000Z',
    } as Interactions.Interaction

    const normalized = normalizeResponse(request, interaction)

    assert.deepEqual(normalized.output, [
      {
        id: 'google_thought:0',
        summary: [{ text: 'Need to check one more invariant.', type: 'summary_text' }],
        text: 'Need to check one more invariant.',
        thought: true,
        type: 'reasoning',
      },
      {
        content: [{ text: 'The invariant still holds.', type: 'text' }],
        role: 'assistant',
        type: 'message',
      },
    ])
  },
)

contractCase('Google Interactions normalization ignores malformed empty text blocks', () => {
  const interaction = {
    created: '2026-04-06T09:00:00.000Z',
    id: 'int_google_text_1',
    model: 'gemini-2.5-pro',
    status: 'completed',
    steps: [
      {
        content: [
          {
            type: 'text',
          },
          {
            text: 'Hi Adam! It is good to hear from you.',
            type: 'text',
          },
        ],
        type: 'model_output',
      },
    ],
    updated: '2026-04-06T09:00:01.000Z',
  } as unknown as Interactions.Interaction

  const normalized = normalizeResponse(request, interaction)

  assert.equal(normalized.outputText, 'Hi Adam! It is good to hear from you.')
  assert.deepEqual(normalized.messages, [
    {
      content: [{ text: 'Hi Adam! It is good to hear from you.', type: 'text' }],
      role: 'assistant',
    },
  ])
})

contractCase('Google Interactions normalization skips user input steps from full timelines', () => {
  const interaction = {
    created: '2026-04-06T09:00:00.000Z',
    id: 'int_google_timeline_1',
    model: 'gemini-2.5-pro',
    status: 'completed',
    steps: [
      {
        content: [
          {
            text: 'hello',
            type: 'text',
          },
        ],
        type: 'user_input',
      },
      {
        content: [
          {
            text: 'Hello back!',
            type: 'text',
          },
        ],
        type: 'model_output',
      },
    ],
    updated: '2026-04-06T09:00:01.000Z',
  } as Interactions.Interaction

  const normalized = normalizeResponse(request, interaction)

  assert.equal(normalized.status, 'completed')
  assert.equal(normalized.outputText, 'Hello back!')
})

contractCase(
  'Google Interactions normalization fails explicitly on unsupported output content types',
  () => {
    const interaction = {
      created: '2026-04-06T09:00:00.000Z',
      id: 'int_google_image_1',
      model: 'gemini-2.5-pro',
      status: 'completed',
      steps: [
        {
          content: [
            {
              mime_type: 'image/png',
              type: 'image',
              uri: 'gs://bucket/example.png',
            },
          ],
          type: 'model_output',
        },
      ],
      updated: '2026-04-06T09:00:01.000Z',
    } as unknown as Interactions.Interaction

    const normalized = normalizeResponse(request, interaction)

    assert.equal(normalized.status, 'failed')
    assert.equal(
      (
        normalized.raw as {
          error?: {
            code?: string
            message?: string
          }
          unsupportedOutputContentTypes?: string[]
        }
      ).error?.code,
      'unsupported_output_content',
    )
    assert.deepEqual(
      (
        normalized.raw as {
          unsupportedOutputContentTypes?: string[]
        }
      ).unsupportedOutputContentTypes,
      ['image'],
    )
  },
)

contractCase(
  'Google Interactions normalization fails explicitly on unsupported thought summary parts',
  () => {
    const interaction = {
      created: '2026-04-06T09:00:00.000Z',
      id: 'int_google_thought_image_1',
      model: 'gemini-2.5-pro',
      status: 'completed',
      steps: [
        {
          summary: [
            {
              type: 'image',
              uri: 'gs://bucket/reasoning.png',
            },
          ],
          type: 'thought',
        },
      ],
      updated: '2026-04-06T09:00:01.000Z',
    } as unknown as Interactions.Interaction

    const normalized = normalizeResponse(request, interaction)

    assert.equal(normalized.status, 'failed')
    assert.deepEqual(
      (
        normalized.raw as {
          unsupportedOutputContentTypes?: string[]
        }
      ).unsupportedOutputContentTypes,
      ['thought.summary:image'],
    )
  },
)

const runResponseContracts = (unsupported: boolean) => {
  for (const contract of contractCases.filter(
    ({ name }) => name.includes('fails explicitly') === unsupported,
  )) {
    assert.doesNotThrow(contract.run, contract.name)
  }
}

test('Google supported response normalization contract matrix', () => {
  runResponseContracts(false)
})

test('Google unsupported response rejection contract matrix', () => {
  runResponseContracts(true)
})
