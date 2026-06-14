import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

import type { ResolvedAiInteractionRequest } from '../src/domain/ai/types'

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}))

vi.mock('@openrouter/sdk', () => ({
  OpenRouter: vi.fn().mockImplementation(function MockOpenRouter() {
    return {
      beta: {
        responses: {
          send: sendMock,
        },
      },
    }
  }),
}))

import { createOpenRouterProvider } from '../src/adapters/ai/openrouter/openrouter-provider'

beforeEach(() => {
  sendMock.mockReset()
})

test('OpenRouter stream ignores message and reasoning output item lifecycle events', async () => {
  sendMock.mockResolvedValue(
    (async function* () {
      yield {
        response: {
          id: 'resp_openrouter_output_item_lifecycle_1',
          model: 'openai/gpt-5.4',
        },
        type: 'response.created',
      }
      yield {
        item: {
          content: [],
          id: 'msg_openrouter_output_item_lifecycle_1',
          role: 'assistant',
          status: 'in_progress',
          type: 'message',
        },
        outputIndex: 0,
        sequenceNumber: 2,
        type: 'response.output_item.added',
      }
      yield {
        item: {
          content: [],
          id: 'rs_openrouter_output_item_lifecycle_1',
          summary: [],
          type: 'reasoning',
        },
        outputIndex: 1,
        sequenceNumber: 3,
        type: 'response.output_item.added',
      }
      yield {
        item: {
          content: [],
          id: 'msg_openrouter_output_item_lifecycle_1',
          role: 'assistant',
          status: 'completed',
          type: 'message',
        },
        outputIndex: 0,
        sequenceNumber: 4,
        type: 'response.output_item.done',
      }
      yield {
        item: {
          content: [],
          id: 'rs_openrouter_output_item_lifecycle_1',
          summary: [],
          type: 'reasoning',
        },
        outputIndex: 1,
        sequenceNumber: 5,
        type: 'response.output_item.done',
      }
      yield {
        response: {
          completedAt: 0,
          createdAt: 0,
          error: null,
          id: 'resp_openrouter_output_item_lifecycle_1',
          incompleteDetails: null,
          instructions: null,
          metadata: null,
          model: 'openai/gpt-5.4',
          object: 'response',
          output: [
            {
              content: [
                {
                  annotations: [],
                  text: 'Hello',
                  type: 'output_text',
                },
              ],
              id: 'msg_openrouter_output_item_lifecycle_1',
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
        },
        type: 'response.completed',
      }
    })(),
  )

  const provider = createOpenRouterProvider({
    apiKey: 'or_test_key',
    appCategories: null,
    appTitle: null,
    baseUrl: null,
    httpReferer: null,
    maxRetries: 2,
    timeoutMs: 60_000,
  })

  const request: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'openai/gpt-5.4',
    provider: 'openrouter',
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

test('OpenRouter stream finalizes reasoning from the terminal response output', async () => {
  const reasoningText = 'Need to verify the saved note before answering.'

  sendMock.mockResolvedValue(
    (async function* () {
      yield {
        response: {
          id: 'resp_openrouter_reasoning_1',
          model: 'openai/gpt-5.4',
        },
        type: 'response.created',
      }
      yield {
        contentIndex: 0,
        delta: reasoningText,
        itemId: 'rs_openrouter_reasoning_1',
        type: 'response.reasoning_text.delta',
      }
      yield {
        response: {
          id: 'resp_openrouter_reasoning_1',
          model: 'openai/gpt-5.4',
          output: [
            {
              content: [],
              id: 'rs_openrouter_reasoning_1',
              summary: [{ text: reasoningText, type: 'summary_text' }],
              type: 'reasoning',
            },
          ],
          status: 'completed',
          usage: null,
        },
        type: 'response.completed',
      }
    })(),
  )

  const provider = createOpenRouterProvider({
    apiKey: 'or_test_key',
    appCategories: null,
    appTitle: null,
    baseUrl: null,
    httpReferer: null,
    maxRetries: 2,
    timeoutMs: 60_000,
  })

  const request: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'openai/gpt-5.4',
    provider: 'openrouter',
    reasoning: {
      effort: 'medium',
    },
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
    ['response.started', 'reasoning.summary.delta', 'reasoning.summary.done', 'response.completed'],
  )

  assert.deepEqual(events[2], {
    itemId: 'rs_openrouter_reasoning_1',
    text: reasoningText,
    type: 'reasoning.summary.done',
  })

  const completedEvent = events[3]
  assert.equal(completedEvent?.type, 'response.completed')

  if (completedEvent?.type !== 'response.completed') {
    return
  }

  assert.equal(completedEvent.response.output[0]?.type, 'reasoning')
  assert.equal(completedEvent.response.output[0]?.id, 'rs_openrouter_reasoning_1')
})

test('OpenRouter stream fails explicitly on unsupported streamed semantics', async () => {
  sendMock.mockResolvedValue(
    (async function* () {
      yield {
        response: {
          id: 'resp_openrouter_unsupported_stream_1',
          model: 'openai/gpt-5.4',
        },
        type: 'response.created',
      }
      yield {
        sequenceNumber: 2,
        type: 'response.image_generation_call.in_progress',
      }
      yield {
        response: {
          completedAt: 0,
          createdAt: 0,
          error: null,
          id: 'resp_openrouter_unsupported_stream_1',
          incompleteDetails: null,
          instructions: null,
          metadata: null,
          model: 'openai/gpt-5.4',
          object: 'response',
          output: [
            {
              content: [
                {
                  annotations: [],
                  text: 'Hello',
                  type: 'output_text',
                },
              ],
              id: 'msg_openrouter_unsupported_stream_1',
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
        },
        type: 'response.completed',
      }
    })(),
  )

  const provider = createOpenRouterProvider({
    apiKey: 'or_test_key',
    appCategories: null,
    appTitle: null,
    baseUrl: null,
    httpReferer: null,
    maxRetries: 2,
    timeoutMs: 60_000,
  })

  const request: ResolvedAiInteractionRequest = {
    messages: [
      {
        content: [{ text: 'hello', type: 'text' }],
        role: 'user',
      },
    ],
    model: 'openai/gpt-5.4',
    provider: 'openrouter',
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
