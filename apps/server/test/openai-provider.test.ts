import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

import type { ResolvedAiInteractionRequest } from '../src/domain/ai/types'

const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
}))

vi.mock('openai', () => {
  class MockOpenAiError extends Error {}

  return {
    __esModule: true,
    APIConnectionError: MockOpenAiError,
    APIConnectionTimeoutError: MockOpenAiError,
    APIError: MockOpenAiError,
    APIUserAbortError: MockOpenAiError,
    AuthenticationError: MockOpenAiError,
    BadRequestError: MockOpenAiError,
    ConflictError: MockOpenAiError,
    NotFoundError: MockOpenAiError,
    PermissionDeniedError: MockOpenAiError,
    RateLimitError: MockOpenAiError,
    default: vi.fn().mockImplementation(function MockOpenAI() {
      return {
        responses: {
          cancel: vi.fn(),
          create: createMock,
        },
      }
    }),
  }
})

import { createOpenAiProvider } from '../src/adapters/ai/openai/openai-provider'

beforeEach(() => {
  createMock.mockReset()
})

test('OpenAI stream ignores message and reasoning output item lifecycle events', async () => {
  createMock.mockResolvedValue(
    (async function* () {
      yield {
        response: {
          id: 'resp_openai_output_item_lifecycle_1',
          model: 'gpt-5.4',
        },
        type: 'response.created',
      }
      yield {
        item: {
          content: [],
          id: 'msg_openai_output_item_lifecycle_1',
          role: 'assistant',
          status: 'in_progress',
          type: 'message',
        },
        output_index: 0,
        sequence_number: 2,
        type: 'response.output_item.added',
      }
      yield {
        item: {
          id: 'rs_openai_output_item_lifecycle_1',
          summary: [],
          type: 'reasoning',
        },
        output_index: 1,
        sequence_number: 3,
        type: 'response.output_item.added',
      }
      yield {
        item: {
          content: [],
          id: 'msg_openai_output_item_lifecycle_1',
          role: 'assistant',
          status: 'completed',
          type: 'message',
        },
        output_index: 0,
        sequence_number: 4,
        type: 'response.output_item.done',
      }
      yield {
        item: {
          id: 'rs_openai_output_item_lifecycle_1',
          summary: [],
          type: 'reasoning',
        },
        output_index: 1,
        sequence_number: 5,
        type: 'response.output_item.done',
      }
      yield {
        response: {
          id: 'resp_openai_output_item_lifecycle_1',
          model: 'gpt-5.4',
          output: [
            {
              content: [
                {
                  annotations: [],
                  text: 'Hello',
                  type: 'output_text',
                },
              ],
              id: 'msg_openai_output_item_lifecycle_1',
              phase: 'final_answer',
              role: 'assistant',
              status: 'completed',
              type: 'message',
            },
          ],
          output_text: 'Hello',
          status: 'completed',
        },
        type: 'response.completed',
      }
    })(),
  )

  const provider = createOpenAiProvider({
    apiKey: 'openai_test_key',
    baseUrl: null,
    defaultServiceTier: null,
    maxRetries: 2,
    organization: null,
    project: null,
    timeoutMs: 60_000,
    webhookSecret: null,
  })

  const request: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'gpt-5.4',
    provider: 'openai',
  }

  const streamed = await provider.stream(request)
  assert.equal(streamed.ok, true)

  if (!streamed.ok) {
    return
  }

  const events = []
  for await (const event of streamed.value) {
    events.push(event)
  }

  assert.deepEqual(
    events.map((event) => event.type),
    ['response.started', 'response.completed'],
  )

  const completedEvent = events[1]
  assert.equal(completedEvent?.type, 'response.completed')

  if (completedEvent?.type !== 'response.completed') {
    return
  }

  assert.equal(completedEvent.response.status, 'completed')
  assert.equal(
    (
      completedEvent.response.raw as {
        unsupportedStreamItemTypes?: string[]
      }
    ).unsupportedStreamItemTypes,
    undefined,
  )
})

test('OpenAI stream fails explicitly on unsupported streamed semantics', async () => {
  createMock.mockResolvedValue(
    (async function* () {
      yield {
        response: {
          id: 'resp_openai_unsupported_stream_1',
          model: 'gpt-5.4',
        },
        type: 'response.created',
      }
      yield {
        sequence_number: 2,
        type: 'response.image_generation_call.in_progress',
      }
      yield {
        response: {
          id: 'resp_openai_unsupported_stream_1',
          model: 'gpt-5.4',
          output: [
            {
              content: [
                {
                  annotations: [],
                  text: 'Hello',
                  type: 'output_text',
                },
              ],
              id: 'msg_openai_unsupported_stream_1',
              phase: 'final_answer',
              role: 'assistant',
              status: 'completed',
              type: 'message',
            },
          ],
          output_text: 'Hello',
          status: 'completed',
        },
        type: 'response.completed',
      }
    })(),
  )

  const provider = createOpenAiProvider({
    apiKey: 'openai_test_key',
    baseUrl: null,
    defaultServiceTier: null,
    maxRetries: 2,
    organization: null,
    project: null,
    timeoutMs: 60_000,
    webhookSecret: null,
  })

  const request: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'gpt-5.4',
    provider: 'openai',
  }

  const streamed = await provider.stream(request)
  assert.equal(streamed.ok, true)

  if (!streamed.ok) {
    return
  }

  const events = []
  for await (const event of streamed.value) {
    events.push(event)
  }

  assert.deepEqual(
    events.map((event) => event.type),
    ['response.started', 'response.completed'],
  )

  const completedEvent = events[1]
  assert.equal(completedEvent?.type, 'response.completed')

  if (completedEvent?.type !== 'response.completed') {
    return
  }

  assert.equal(completedEvent.response.status, 'failed')
  assert.deepEqual(
    (
      completedEvent.response.raw as {
        unsupportedStreamEventTypes?: string[]
      }
    ).unsupportedStreamEventTypes,
    ['response.image_generation_call.in_progress'],
  )
})

test('OpenAI stream ignores keepalive events', async () => {
  createMock.mockResolvedValue(
    (async function* () {
      yield {
        response: {
          id: 'resp_openai_keepalive_1',
          model: 'gpt-5.4',
        },
        type: 'response.created',
      }
      yield {
        type: 'keepalive',
      }
      yield {
        response: {
          id: 'resp_openai_keepalive_1',
          model: 'gpt-5.4',
          output: [
            {
              content: [
                {
                  annotations: [],
                  text: 'Hello',
                  type: 'output_text',
                },
              ],
              id: 'msg_openai_keepalive_1',
              phase: 'final_answer',
              role: 'assistant',
              status: 'completed',
              type: 'message',
            },
          ],
          output_text: 'Hello',
          status: 'completed',
        },
        type: 'response.completed',
      }
    })(),
  )

  const provider = createOpenAiProvider({
    apiKey: 'openai_test_key',
    baseUrl: null,
    defaultServiceTier: null,
    maxRetries: 2,
    organization: null,
    project: null,
    timeoutMs: 60_000,
    webhookSecret: null,
  })

  const request: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'gpt-5.4',
    provider: 'openai',
  }

  const streamed = await provider.stream(request)
  assert.equal(streamed.ok, true)

  if (!streamed.ok) {
    return
  }

  const events = []
  for await (const event of streamed.value) {
    events.push(event)
  }

  assert.deepEqual(
    events.map((event) => event.type),
    ['response.started', 'response.completed'],
  )

  const completedEvent = events[1]
  assert.equal(completedEvent?.type, 'response.completed')

  if (completedEvent?.type !== 'response.completed') {
    return
  }

  assert.equal(completedEvent.response.status, 'completed')
})
