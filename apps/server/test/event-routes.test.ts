import assert from 'node:assert/strict'
import { test } from 'vitest'
import { domainEvents } from '../src/db/schema'
import type { AiInteractionResponse } from '../src/domain/ai/types'
import { ok } from '../src/shared/result'
import { seedApiKeyAuth } from './helpers/api-key-auth'
import { createTestHarness } from './helpers/create-test-app'

const parseSse = (body: string) => {
  return body
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => {
      const event = chunk
        .split('\n')
        .find((line) => line.startsWith('event: '))
        ?.slice('event: '.length)
      const id = chunk
        .split('\n')
        .find((line) => line.startsWith('id: '))
        ?.slice('id: '.length)
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '))

      return {
        data: dataLine ? JSON.parse(dataLine.slice('data: '.length)) : null,
        event,
        id,
      }
    })
}

test('event stream replays durable domain events by default and can include telemetry on demand', async () => {
  const { app, runtime } = createTestHarness({
    AUTH_MODE: 'api_key',
    NODE_ENV: 'test',
  })
  const { headers } = seedApiKeyAuth(runtime)

  const bootstrapResponse = await app.request('http://local/v1/sessions/bootstrap', {
    body: JSON.stringify({
      initialMessage: 'Plan the next milestone for the API backend',
      title: 'Milestone planning',
    }),
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    method: 'POST',
  })
  const bootstrap = await bootstrapResponse.json()
  const bootstrapCursor =
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .sort((left, right) => left.eventNo - right.eventNo)
      .at(-1)?.eventNo ?? 0

  runtime.services.ai.interactions.generate = async () =>
    ok<AiInteractionResponse>({
      messages: [
        {
          content: [{ text: 'Start with run execution.', type: 'text' }],
          role: 'assistant',
        },
      ],
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'Start with run execution.', type: 'text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      outputText: 'Start with run execution.',
      provider: 'openai',
      providerRequestId: 'req_sse_1',
      raw: { stub: true },
      responseId: 'resp_sse_1',
      status: 'completed',
      toolCalls: [],
      usage: null,
    })

  const executeResponse = await app.request(
    `http://local/v1/runs/${bootstrap.data.runId}/execute`,
    {
      body: JSON.stringify({}),
      headers: {
        ...headers,
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  )

  assert.equal(executeResponse.status, 200)

  const sseResponse = await app.request(
    `http://local/v1/events/stream?follow=false&cursor=${bootstrapCursor}&threadId=${bootstrap.data.threadId}`,
    {
      headers,
      method: 'GET',
    },
  )

  assert.equal(sseResponse.status, 200)
  assert.match(sseResponse.headers.get('content-type') ?? '', /text\/event-stream/)

  const events = parseSse(await sseResponse.text())

  assert.deepEqual(
    events.map((event) => event.event),
    ['run.started', 'message.posted', 'run.completed', 'job.completed'],
  )
  assert.deepEqual(
    events.map((event) => event.id),
    runtime.db
      .select()
      .from(domainEvents)
      .all()
      .filter((event) => event.eventNo > bootstrapCursor && event.category === 'domain')
      .map((event) => String(event.eventNo)),
  )
  assert.equal(events[0]?.data.payload.threadId, bootstrap.data.threadId)
  assert.deepEqual(
    events.map((event) => event.data?.category),
    ['domain', 'domain', 'domain', 'domain'],
  )

  const runScopedResponse = await app.request(
    `http://local/v1/events/stream?follow=false&cursor=${bootstrapCursor}&runId=${bootstrap.data.runId}`,
    {
      headers,
      method: 'GET',
    },
  )

  assert.equal(runScopedResponse.status, 200)

  const runScopedEvents = parseSse(await runScopedResponse.text())

  assert.deepEqual(
    runScopedEvents.map((event) => event.event),
    ['run.started', 'message.posted', 'run.completed', 'job.completed'],
  )

  const allSseResponse = await app.request(
    `http://local/v1/events/stream?follow=false&cursor=${bootstrapCursor}&threadId=${bootstrap.data.threadId}&category=all`,
    {
      headers,
      method: 'GET',
    },
  )

  assert.equal(allSseResponse.status, 200)

  const allEvents = parseSse(await allSseResponse.text())

  assert.deepEqual(
    allEvents.map((event) => event.event),
    [
      'run.started',
      'turn.started',
      'progress.reported',
      'generation.started',
      'progress.reported',
      'stream.delta',
      'stream.done',
      'generation.completed',
      'turn.completed',
      'progress.reported',
      'message.posted',
      'run.completed',
      'job.completed',
      'progress.reported',
    ],
  )
  assert.equal(
    allEvents.some((event) => event.data?.category === 'telemetry'),
    true,
  )
})
