import assert from 'node:assert/strict'
import type { Response } from 'openai/resources/responses/responses'
import { test } from 'vitest'

import { normalizeResponse } from '../src/adapters/ai/openai/openai-response'

test('OpenAI response normalization preserves aggregated web search activity and citations', () => {
  const response = {
    id: 'resp_openai_1',
    model: 'gpt-5.4',
    output: [
      {
        action: {
          queries: ['cursor ide web search'],
          query: 'cursor ide web search',
          sources: [
            {
              type: 'url',
              url: 'https://platform.openai.com/docs/guides/tools-web-search',
            },
          ],
          type: 'search',
        },
        id: 'ws_1',
        status: 'completed',
        type: 'web_search_call',
      },
      {
        content: [
          {
            annotations: [
              {
                end_index: 20,
                start_index: 0,
                title: 'OpenAI web search guide',
                type: 'url_citation',
                url: 'https://platform.openai.com/docs/guides/tools-web-search',
              },
            ],
            text: 'According to the docs',
            type: 'output_text',
          },
        ],
        id: 'msg_1',
        phase: null,
        role: 'assistant',
        status: 'completed',
        type: 'message',
      },
    ],
    output_text: 'According to the docs',
    status: 'completed',
    usage: {
      input_tokens: 120,
      input_tokens_details: {
        cached_tokens: 0,
      },
      output_tokens: 32,
      output_tokens_details: {
        reasoning_tokens: 0,
      },
      total_tokens: 152,
    },
  } as unknown as Response

  const normalized = normalizeResponse(response, 'req_openai_1')

  assert.equal(normalized.providerRequestId, 'req_openai_1')
  assert.equal(normalized.outputText, 'According to the docs')
  assert.deepEqual(normalized.webSearches, [
    {
      id: 'ws_1',
      patterns: [],
      provider: 'openai',
      queries: ['cursor ide web search'],
      references: [
        {
          domain: 'platform.openai.com',
          title: 'OpenAI web search guide',
          url: 'https://platform.openai.com/docs/guides/tools-web-search',
        },
      ],
      responseId: 'resp_openai_1',
      status: 'completed',
      targetUrls: [],
    },
  ])
})

test('OpenAI response normalization preserves separate web search calls per output item id', () => {
  const response = {
    id: 'resp_openai_2',
    model: 'gpt-5.4',
    output: [
      {
        action: {
          queries: ['airpods max 2 apple official'],
          query: 'airpods max 2 apple official',
          sources: [],
          type: 'search',
        },
        id: 'ws_apple_1',
        status: 'completed',
        type: 'web_search_call',
      },
      {
        action: {
          type: 'open_page',
          url: 'https://www.apple.com/newsroom/2026/03/apple-introduces-airpods-max-2-powered-by-h2/',
        },
        id: 'ws_apple_2',
        status: 'completed',
        type: 'web_search_call',
      },
    ],
    output_text: '',
    status: 'completed',
  } as unknown as Response

  const normalized = normalizeResponse(response, null)

  assert.deepEqual(
    normalized.webSearches.map((activity) => ({
      id: activity.id,
      queries: activity.queries,
      targetUrls: activity.targetUrls,
    })),
    [
      {
        id: 'ws_apple_1',
        queries: ['airpods max 2 apple official'],
        targetUrls: [],
      },
      {
        id: 'ws_apple_2',
        queries: [],
        targetUrls: [
          'https://www.apple.com/newsroom/2026/03/apple-introduces-airpods-max-2-powered-by-h2/',
        ],
      },
    ],
  )
})

test('OpenAI response normalization fails explicitly on unsupported output item types', () => {
  const response = {
    id: 'resp_openai_unsupported_item_1',
    model: 'gpt-5.4',
    output: [
      {
        id: 'fs_1',
        queries: ['adapter coverage'],
        status: 'completed',
        type: 'file_search_call',
      },
    ],
    output_text: '',
    status: 'completed',
  } as unknown as Response

  const normalized = normalizeResponse(response, null)

  assert.equal(normalized.status, 'failed')
  assert.deepEqual(
    (
      normalized.raw as {
        unsupportedOutputItemTypes?: string[]
      }
    ).unsupportedOutputItemTypes,
    ['file_search_call'],
  )
})

test('OpenAI response normalization fails explicitly on unsupported message annotations', () => {
  const response = {
    id: 'resp_openai_unsupported_annotation_1',
    model: 'gpt-5.4',
    output: [
      {
        content: [
          {
            annotations: [
              {
                file_id: 'file_1',
                filename: 'report.pdf',
                index: 0,
                type: 'file_citation',
              },
            ],
            text: 'See the attached report.',
            type: 'output_text',
          },
        ],
        id: 'msg_unsupported_annotation_1',
        phase: null,
        role: 'assistant',
        status: 'completed',
        type: 'message',
      },
    ],
    output_text: 'See the attached report.',
    status: 'completed',
  } as unknown as Response

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
