import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  buildConfig,
  buildCreateInteractionParams,
  buildInputForRequest,
  ensureGoogleCompatibleRequest,
} from '../src/adapters/ai/google/google-request'
import { createRequestBody } from '../src/adapters/ai/openai/openai-request'
import { createRequestBody as createOpenRouterRequestBody } from '../src/adapters/ai/openrouter/openrouter-request'
import type { ResolvedAiInteractionRequest } from '../src/domain/ai/types'

const openAiConfig = {
  defaultServiceTier: null,
  maxRetries: 2,
  timeoutMs: 60_000,
} as const

const googleConfig = {
  defaultHttpTimeoutMs: 60_000,
  maxRetries: 2,
} as const

const openRouterConfig = {
  appCategories: null,
  appTitle: null,
  httpReferer: null,
  maxRetries: 2,
  timeoutMs: 60_000,
} as const

test('OpenAI request replays assistant history as output_text messages', () => {
  const request: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
      {
        content: [{ text: 'API check passed', type: 'text' }],
        phase: 'final_answer',
        providerMessageId: 'msg_assistant_prev',
        role: 'assistant',
      },
    ],
    model: 'gpt-5.4',
    provider: 'openai',
  }

  const body = createRequestBody(request, openAiConfig, false)

  assert.ok(Array.isArray(body.input))
  assert.deepEqual(body.input?.[1], {
    content: [
      {
        annotations: [],
        text: 'API check passed',
        type: 'output_text',
      },
    ],
    id: 'msg_assistant_prev',
    phase: 'final_answer',
    role: 'assistant',
    status: 'completed',
    type: 'message',
  })
})

test('Google Interactions request omits legacy metadata labels', () => {
  const request: ResolvedAiInteractionRequest = {
    maxOutputTokens: 32,
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    metadata: {
      runId: 'run_123',
    },
    model: 'gemini-2.5-flash',
    provider: 'google',
  }

  const params = buildCreateInteractionParams(request, googleConfig, false)

  assert.equal(Object.hasOwn(params, 'metadata'), false)
  assert.equal(Object.hasOwn(params, 'previous_interaction_id'), false)
})

test('Google Interactions request sanitizes empty arrays in function results', () => {
  const request: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'search the vault', type: 'text' }],
        role: 'user',
      },
      {
        content: [
          {
            argumentsJson: '{"garden":"overment","script":"grep -r \\"Nora\\" . || true"}',
            callId: 'call_execute',
            name: 'execute',
            type: 'function_call',
          },
        ],
        role: 'assistant',
      },
      {
        content: [
          {
            callId: 'call_execute',
            name: 'execute',
            outputJson: JSON.stringify({
              files: [],
              packages: [],
              status: 'completed',
              stdout: 'music/deep-house/nora.md:title: Nora En Pure\n',
              writebacks: [],
            }),
            type: 'function_result',
          },
        ],
        role: 'tool',
      },
    ],
    model: 'gemini-2.5-flash',
    provider: 'google',
  }

  const input = buildInputForRequest(request.messages)

  assert.deepEqual(input, [
    {
      content: [
        {
          text: 'search the vault',
          type: 'text',
        },
      ],
      role: 'user',
    },
    {
      content: [
        {
          arguments: {
            garden: 'overment',
            script: 'grep -r "Nora" . || true',
          },
          id: 'call_execute',
          name: 'execute',
          type: 'function_call',
        },
      ],
      role: 'model',
    },
    {
      content: [
        {
          call_id: 'call_execute',
          name: 'execute',
          result: {
            files: null,
            packages: null,
            status: 'completed',
            stdout: 'music/deep-house/nora.md:title: Nora En Pure\n',
            writebacks: null,
          },
          type: 'function_result',
        },
      ],
      role: 'user',
    },
  ])
})

test('provider request shapes pass through reasoning configuration', () => {
  const openAiRequest: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'gpt-5.4',
    provider: 'openai',
    reasoning: {
      effort: 'high',
      summary: 'detailed',
    },
  }
  const googleRequest: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'gemini-2.5-flash',
    provider: 'google',
    reasoning: {
      effort: 'minimal',
      summary: 'concise',
    },
  }

  const openAiBody = createRequestBody(openAiRequest, openAiConfig, false)
  const googleBody = buildConfig(googleRequest, googleConfig)

  assert.deepEqual(openAiBody.reasoning, {
    effort: 'high',
    summary: 'detailed',
  })
  assert.equal(googleBody.thinking_level, 'minimal')
  assert.equal(googleBody.thinking_summaries, 'auto')
})

test('provider request shapes default reasoning summary transport correctly', () => {
  const openAiRequest: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'gpt-5.4',
    provider: 'openai',
    reasoning: {
      effort: 'medium',
    },
  }
  const googleRequest: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'gemini-2.5-flash',
    provider: 'google',
    reasoning: {
      effort: 'low',
    },
  }

  const openAiBody = createRequestBody(openAiRequest, openAiConfig, false)
  const googleBody = buildConfig(googleRequest, googleConfig)

  assert.deepEqual(openAiBody.reasoning, {
    effort: 'medium',
    summary: 'auto',
  })
  assert.deepEqual(openAiBody.include, ['reasoning.encrypted_content'])
  assert.equal(googleBody.thinking_level, 'low')
  assert.equal(googleBody.thinking_summaries, 'auto')
})

test('Google request maps reasoning none to thinking disabled', () => {
  const googleRequest: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'gemini-2.5-flash',
    provider: 'google',
    reasoning: {
      effort: 'none',
    },
  }

  const googleBody = buildConfig(googleRequest, googleConfig)

  assert.equal(googleBody.thinking_level, 'minimal')
  assert.equal(googleBody.thinking_summaries, 'none')
})

test('OpenAI request uses the stable native web_search tool shape', () => {
  const request: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'Search the web', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'gpt-5.4',
    nativeTools: ['web_search'],
    provider: 'openai',
  }

  const body = createRequestBody(request, openAiConfig, false)

  assert.deepEqual(body.include, ['web_search_call.action.sources'])
  assert.deepEqual(body.tools, [
    {
      search_context_size: 'medium',
      type: 'web_search',
    },
  ])
})

test('OpenAI request rejects includes for unsupported response surfaces', () => {
  const request: ResolvedAiInteractionRequest = {
    include: ['file_search_call.results'],
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'gpt-5.4',
    provider: 'openai',
  }

  assert.throws(
    () => createRequestBody(request, openAiConfig, false),
    /not supported by this adapter/,
  )
})

test('OpenRouter request rejects includes for unsupported response surfaces', () => {
  const request: ResolvedAiInteractionRequest = {
    include: ['file_search_call.results'],
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'openai/gpt-5.4',
    provider: 'openrouter',
  }

  assert.throws(
    () => createOpenRouterRequestBody(request, openRouterConfig, false),
    /not supported by this adapter/,
  )
})

test('OpenAI request maps shared replay and cache fields from the root request', () => {
  const request: ResolvedAiInteractionRequest = {
    include: ['reasoning.encrypted_content'],
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'gpt-5.4',
    previousResponseId: 'resp_prev_1',
    promptCacheKey: 'thread:1',
    provider: 'openai',
    safetyIdentifier: 'user_123',
  }

  const body = createRequestBody(request, openAiConfig, false)

  assert.deepEqual(body.include, ['reasoning.encrypted_content'])
  assert.equal(body.previous_response_id, 'resp_prev_1')
  assert.equal(body.prompt_cache_key, 'thread:1')
  assert.equal(body.safety_identifier, 'user_123')
})

test('OpenRouter request maps shared replay and cache fields from the root request', () => {
  const request: ResolvedAiInteractionRequest = {
    include: ['reasoning.encrypted_content'],
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'openai/gpt-5.4',
    previousResponseId: 'resp_prev_1',
    promptCacheKey: 'thread:1',
    provider: 'openrouter',
    safetyIdentifier: 'user_123',
  }

  const body = createOpenRouterRequestBody(request, openRouterConfig, false)

  assert.deepEqual(body.responsesRequest.include, ['reasoning.encrypted_content'])
  assert.equal(body.responsesRequest.previousResponseId, 'resp_prev_1')
  assert.equal(body.responsesRequest.promptCacheKey, 'thread:1')
  assert.equal(body.responsesRequest.safetyIdentifier, 'user_123')
})

test('OpenRouter request rejects provider routing controls in vendorOptions.openrouter', () => {
  const request: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'openai/gpt-5.4',
    provider: 'openrouter',
    vendorOptions: {
      openrouter: {
        provider: {
          allowFallbacks: false,
        },
      },
    },
  }

  assert.throws(
    () => createOpenRouterRequestBody(request, openRouterConfig, false),
    /provider routing controls are not supported/,
  )
})

test('OpenAI request disables strict mode for function tools with optional properties', () => {
  const request: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'Generate an image', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'gpt-5.4',
    provider: 'openai',
    tools: [
      {
        description: 'Generate an image',
        kind: 'function',
        name: 'generate_image',
        parameters: {
          additionalProperties: false,
          properties: {
            aspectRatio: { enum: ['1:1', '16:9'], type: 'string' },
            prompt: { type: 'string' },
          },
          required: ['prompt'],
          type: 'object',
        },
      },
    ],
  }

  const body = createRequestBody(request, openAiConfig, false)

  assert.deepEqual(body.tools, [
    {
      description: 'Generate an image',
      name: 'generate_image',
      parameters: {
        additionalProperties: false,
        properties: {
          aspectRatio: { enum: ['1:1', '16:9'], type: 'string' },
          prompt: { type: 'string' },
        },
        required: ['prompt'],
        type: 'object',
      },
      strict: null,
      type: 'function',
    },
  ])
})

test('OpenAI request keeps strict mode for fully-required function schemas', () => {
  const request: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'Summarize', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'gpt-5.4',
    provider: 'openai',
    tools: [
      {
        description: 'Summarize text',
        kind: 'function',
        name: 'summarize',
        parameters: {
          additionalProperties: false,
          properties: {
            text: { type: 'string' },
          },
          required: ['text'],
          type: 'object',
        },
      },
    ],
  }

  const body = createRequestBody(request, openAiConfig, false)

  assert.deepEqual(body.tools, [
    {
      description: 'Summarize text',
      name: 'summarize',
      parameters: {
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
        type: 'object',
      },
      strict: true,
      type: 'function',
    },
  ])
})

test('OpenAI request rejects invalid function tool names before sending the request', () => {
  const request: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'gpt-5.4',
    provider: 'openai',
    tools: [
      {
        kind: 'function',
        name: 'valid_tool',
        parameters: { type: 'object' },
      },
      {
        kind: 'function',
        name: 'legacy.tool',
        parameters: { type: 'object' },
      },
    ],
  }

  assert.throws(
    () => createRequestBody(request, openAiConfig, false),
    /OpenAI function tool name at index 1 is invalid: "legacy\.tool"/,
  )
})

test('Google Interactions request replay preserves signatures on thoughts, function calls, and thought parts', () => {
  const request: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [
          {
            text: 'Need to reason first.',
            thought: true,
            thoughtSignature: 'sig_reason_1',
            type: 'text',
          },
          {
            text: 'Final answer',
            thoughtSignature: 'sig_text_1',
            type: 'text',
          },
        ],
        role: 'assistant',
      },
      {
        content: [
          {
            argumentsJson: '{"q":"status"}',
            callId: 'call_1',
            name: 'lookup_status',
            thoughtSignature: 'sig_call_1',
            type: 'function_call',
          },
        ],
        role: 'assistant',
      },
      {
        content: [
          {
            id: 'sig_reasoning_item_1',
            summary: [{ text: 'Internal thought replay.', type: 'summary_text' }],
            text: 'Internal thought replay.',
            thought: true,
            type: 'reasoning',
          },
        ],
        role: 'assistant',
      },
    ],
    model: 'gemini-2.5-flash',
    provider: 'google',
  }

  const input = buildInputForRequest(request.messages)

  assert.deepEqual(input, [
    {
      content: [
        {
          signature: 'sig_reason_1',
          summary: [
            {
              text: 'Need to reason first.',
              type: 'text',
            },
          ],
          type: 'thought',
        },
        {
          text: 'Final answer',
          type: 'text',
        },
      ],
      role: 'model',
    },
    {
      content: [
        {
          arguments: { q: 'status' },
          id: 'call_1',
          name: 'lookup_status',
          signature: 'sig_call_1',
          type: 'function_call',
        },
        {
          signature: 'sig_reasoning_item_1',
          summary: [
            {
              text: 'Internal thought replay.',
              type: 'text',
            },
          ],
          type: 'thought',
        },
      ],
      role: 'model',
    },
  ])
})

test('Google Interactions request groups tool-call replay into logical model and user turns', () => {
  const request: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'ask both', type: 'text' }],
        role: 'user',
      },
      {
        content: [
          {
            id: 'thought_1',
            summary: [{ text: 'Need two lookups.', type: 'summary_text' }],
            text: 'Need two lookups.',
            thought: true,
            type: 'reasoning',
          },
        ],
        role: 'assistant',
      },
      {
        content: [
          {
            argumentsJson: '{"agentAlias":"tony"}',
            callId: 'call_tony',
            name: 'delegate_to_agent',
            type: 'function_call',
          },
        ],
        role: 'assistant',
      },
      {
        content: [
          {
            argumentsJson: '{"agentAlias":"nicky"}',
            callId: 'call_nicky',
            name: 'delegate_to_agent',
            type: 'function_call',
          },
        ],
        role: 'assistant',
      },
      {
        content: [
          {
            callId: 'call_tony',
            name: 'delegate_to_agent',
            outputJson: '{"kind":"completed","summary":"Tony ok"}',
            type: 'function_result',
          },
        ],
        role: 'tool',
      },
      {
        content: [
          {
            callId: 'call_nicky',
            name: 'delegate_to_agent',
            outputJson: '{"kind":"completed","summary":"Nicky ok"}',
            type: 'function_result',
          },
        ],
        role: 'tool',
      },
    ],
    model: 'gemini-2.5-flash',
    provider: 'google',
  }

  const input = buildInputForRequest(request.messages)

  assert.deepEqual(input, [
    {
      content: [
        {
          text: 'ask both',
          type: 'text',
        },
      ],
      role: 'user',
    },
    {
      content: [
        {
          signature: 'thought_1',
          summary: [
            {
              text: 'Need two lookups.',
              type: 'text',
            },
          ],
          type: 'thought',
        },
        {
          arguments: { agentAlias: 'tony' },
          id: 'call_tony',
          name: 'delegate_to_agent',
          type: 'function_call',
        },
        {
          arguments: { agentAlias: 'nicky' },
          id: 'call_nicky',
          name: 'delegate_to_agent',
          type: 'function_call',
        },
      ],
      role: 'model',
    },
    {
      content: [
        {
          call_id: 'call_tony',
          name: 'delegate_to_agent',
          result: {
            kind: 'completed',
            summary: 'Tony ok',
          },
          type: 'function_result',
        },
        {
          call_id: 'call_nicky',
          name: 'delegate_to_agent',
          result: {
            kind: 'completed',
            summary: 'Nicky ok',
          },
          type: 'function_result',
        },
      ],
      role: 'user',
    },
  ])
})

test('Google Interactions request rejects previous interaction ids and requires full replay', () => {
  const request = {
    messages: [
      {
        content: [{ text: 'hello', type: 'text' as const }],
        role: 'user' as const,
      },
    ],
    model: 'gemini-2.5-flash',
    provider: 'google' as const,
    vendorOptions: {
      google: {
        previousInteractionId: 'int_prev_1',
      },
    },
  } as unknown as ResolvedAiInteractionRequest

  assert.throws(
    () => ensureGoogleCompatibleRequest(request),
    /forbids previousInteractionId; full durable replay is required/,
  )
})
